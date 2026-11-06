import { signal } from '@angular/core';
import type { ComponentDto, DrawingDto, DrawingOp, DrawingPatchInput, LayerKey, WireDto } from '@electro/shared';
import { MAX_OPS_PER_PATCH } from '@electro/shared';
import { toApiError, type ApiError } from '../../../core/api-error';
import type { Journal } from './journal';
import type { SaveStatus } from './floor-sync';
import { t, tx } from '../../../core/i18n/i18n.service';

export interface DrawingApi {
  getDrawing(floorId: string): Promise<DrawingDto>;
  patchDrawing(floorId: string, input: DrawingPatchInput): Promise<{ revision: number }>;
}

/** Pending changes, keyed so that a later change to the same object replaces the earlier one. */
interface PendingOps {
  components: Record<string, DrawingOp>; // object id → upsert | delete | upsertWire | deleteWire
  layers: Partial<Record<LayerKey, { visible?: boolean; locked?: boolean }>>;
}

const DEBOUNCE_MS = 600;
const RETRY_MS = [2_000, 5_000, 10_000, 30_000];

/**
 * Autosave for a floor's drawing (components, layers). Same guarantees as FloorSync:
 * journal first, batched saves with the drawing revision, re-apply on 409, retry while offline.
 */
export class DrawingSync {
  /** The current notice is the offline / retrying one (cleared once a save succeeds). */
  private retryNotice = false;

  private setNotice(text: string | null): void {
    this.retryNotice = false;
    this.message.set(text);
  }

  readonly status = signal<SaveStatus>('saved');
  readonly message = signal<string | null>(null);

  private revision: number;
  private pending: PendingOps = { components: {}, layers: {} };
  private inflight: Promise<void> | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private retryIndex = 0;
  private disposed = false;

  constructor(
    private readonly floorId: string,
    initialRevision: number,
    private readonly api: DrawingApi,
    private readonly journal: Journal,
    /** Called when the server copy had to be reloaded (conflict or rejected change). */
    private readonly onServerState: (drawing: DrawingDto, reapply: DrawingOp[]) => void,
  ) {
    this.revision = initialRevision;
  }

  private get key() {
    return `drawing:${this.floorId}`;
  }

  /** Returns ops left in the journal by an earlier session (to re-apply locally), and schedules their save. */
  async recover(): Promise<DrawingOp[]> {
    try {
      const entry = await this.journal.get<PendingOps>(this.key);
      if (!entry) return [];
      this.pending = entry.patch;
      const ops = this.opsOf(this.pending);
      if (ops.length === 0) return [];
      this.status.set('pending');
      this.setNotice(t('Restored drawing changes that had not been saved yet.'));
      this.schedule(0);
      return ops;
    } catch {
      return [];
    }
  }

  queue(ops: DrawingOp[]): void {
    if (this.disposed || ops.length === 0) return;
    for (const op of ops) {
      if (op.op === 'upsert') this.pending.components[op.component.id] = op;
      else if (op.op === 'delete' || op.op === 'deleteWire') this.pending.components[op.id] = op;
      else if (op.op === 'upsertWire') this.pending.components[op.wire.id] = op;
      else {
        const prev = this.pending.layers[op.key] ?? {};
        this.pending.layers[op.key] = {
          ...prev,
          ...(op.visible !== undefined ? { visible: op.visible } : {}),
          ...(op.locked !== undefined ? { locked: op.locked } : {}),
        };
      }
    }
    this.status.set('pending');
    this.setNotice(null);
    void this.writeJournal();
    this.schedule(DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.inflight) await this.inflight;
    if (this.opsOf(this.pending).length === 0) {
      if (!this.inflight) this.status.set('saved');
      return;
    }
    this.inflight = this.send().finally(() => (this.inflight = null));
    await this.inflight;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private opsOf(p: PendingOps): DrawingOp[] {
    const ops: DrawingOp[] = Object.values(p.components);
    for (const [key, v] of Object.entries(p.layers)) ops.push({ op: 'layer', key: key as LayerKey, ...v });
    return ops;
  }

  private async send(conflictRetry = true): Promise<void> {
    const sending = this.pending;
    this.pending = { components: {}, layers: {} };
    const all = this.opsOf(sending);
    // Large batches go in chunks; each chunk is its own atomic revision step.
    const chunk = all.slice(0, MAX_OPS_PER_PATCH);
    const rest = all.slice(MAX_OPS_PER_PATCH);
    this.status.set('saving');
    try {
      const { revision } = await this.api.patchDrawing(this.floorId, { baseRevision: this.revision, ops: chunk });
      this.revision = revision;
      this.retryIndex = 0;
      if (rest.length) this.mergeBack(rest);
      if (this.opsOf(this.pending).length === 0) {
        await this.journal.delete(this.key).catch(() => undefined);
        this.status.set('saved');
        if (this.retryNotice) this.setNotice(null);
      } else {
        this.status.set('pending');
        void this.writeJournal();
        this.schedule(rest.length ? 0 : DEBOUNCE_MS);
      }
    } catch (err) {
      const e = toApiError(err);
      this.mergeBack(all);
      if (e.status === 409 && conflictRetry) {
        try {
          const server = await this.api.getDrawing(this.floorId);
          this.revision = server.revision;
          this.onServerState(server, this.opsOf(this.pending));
          this.setNotice(t('This drawing was also changed elsewhere; your changes were applied on top.'));
          return await this.send(false);
        } catch (inner) {
          return this.fail(toApiError(inner));
        }
      }
      if (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
        // Rejected by the server: drop the change and show the saved drawing again.
        this.pending = { components: {}, layers: {} };
        await this.journal.delete(this.key).catch(() => undefined);
        this.status.set('error');
        this.setNotice(t('Change not saved: {reason}', { reason: tx(e.message) }));
        try {
          const server = await this.api.getDrawing(this.floorId);
          this.revision = server.revision;
          this.onServerState(server, []);
        } catch {
          /* the next successful save or reload will resync */
        }
        return;
      }
      this.fail(e);
    }
  }

  /** Puts unsent ops back, without overwriting newer edits made in the meantime. */
  private mergeBack(ops: DrawingOp[]): void {
    const newer = this.pending;
    this.pending = { components: {}, layers: {} };
    this.queueSilently(ops);
    this.queueSilently(this.opsOf(newer));
  }

  private queueSilently(ops: DrawingOp[]): void {
    for (const op of ops) {
      if (op.op === 'upsert') this.pending.components[op.component.id] = op;
      else if (op.op === 'delete' || op.op === 'deleteWire') this.pending.components[op.id] = op;
      else if (op.op === 'upsertWire') this.pending.components[op.wire.id] = op;
      else
        this.pending.layers[op.key] = {
          ...(this.pending.layers[op.key] ?? {}),
          ...(op.visible !== undefined ? { visible: op.visible } : {}),
          ...(op.locked !== undefined ? { locked: op.locked } : {}),
        };
    }
  }

  private fail(e: ApiError): void {
    this.retryNotice = true;
    this.status.set(e.isNetwork ? 'offline' : 'error');
    this.message.set(
      e.isNetwork
        ? t('Offline: drawing changes are kept on this device and will be saved when the connection returns.')
        : t('Saving failed ({reason}). Retrying automatically.', { reason: tx(e.message) }),
    );
    void this.writeJournal();
    if (this.disposed) return;
    this.schedule(RETRY_MS[Math.min(this.retryIndex++, RETRY_MS.length - 1)]!);
  }

  private async writeJournal(): Promise<void> {
    try {
      await this.journal.put({
        key: this.key,
        baseRevision: this.revision,
        patch: this.pending,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      /* in-memory pending changes are still retried */
    }
  }
}

/** Applies ops to a component list (used to re-apply local changes on top of a server copy). */
export function applyOps(components: ComponentDto[], ops: DrawingOp[]): ComponentDto[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  for (const op of ops) {
    if (op.op === 'upsert') byId.set(op.component.id, op.component as ComponentDto);
    else if (op.op === 'delete') byId.delete(op.id);
  }
  return [...byId.values()];
}

/** Applies wire ops to a wire list. */
export function applyWireOps(wires: WireDto[], ops: DrawingOp[]): WireDto[] {
  const byId = new Map(wires.map((w) => [w.id, w]));
  for (const op of ops) {
    if (op.op === 'upsertWire') byId.set(op.wire.id, op.wire as WireDto);
    else if (op.op === 'deleteWire') byId.delete(op.id);
  }
  return [...byId.values()];
}
