import { computed, signal } from '@angular/core';
import type { FloorDto, FloorSettingsInput } from '@electro/shared';
import { ApiError, toApiError } from '../../../core/api-error';
import type { Journal } from './journal';

/** Floor fields the editor can change. */
export type FloorSettingsPatch = Omit<FloorSettingsInput, 'baseRevision'>;

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'error';

export interface FloorSettingsApi {
  updateFloorSettings(id: string, input: FloorSettingsInput): Promise<FloorDto>;
  getFloor(id: string): Promise<FloorDto>;
}

const DEBOUNCE_MS = 700;
const RETRY_MS = [2_000, 5_000, 10_000, 30_000];

/**
 * Autosave for one floor's settings.
 *  1. Every change is applied locally at once and written to the journal (IndexedDB).
 *  2. Changes are batched and sent with the floor's revision (optimistic concurrency).
 *  3. On 409 the latest floor is fetched and the pending changes are re-applied on top of it.
 *  4. On network/server failure the change stays in the journal and is retried with back-off.
 */
export class FloorSync {
  private server: FloorDto;
  private pending: FloorSettingsPatch = {};
  private inflight: Promise<void> | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private retryIndex = 0;
  private disposed = false;

  private readonly floorState: ReturnType<typeof signal<FloorDto>>;
  /** Floor as the user sees it: server state with unsaved changes applied. */
  readonly floor;
  readonly status = signal<SaveStatus>('saved');
  readonly message = signal<string | null>(null);
  readonly hasUnsaved = computed(() => this.status() !== 'saved');

  constructor(
    initial: FloorDto,
    private readonly api: FloorSettingsApi,
    private readonly journal: Journal,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.server = initial;
    this.floorState = signal(initial);
    this.floor = this.floorState.asReadonly();
  }

  private get key() {
    return `floor-settings:${this.server.id}`;
  }

  /** Replays changes left in the journal by a previous session (e.g. after a crash or refresh). */
  async recover(): Promise<boolean> {
    try {
      const entry = await this.journal.get<FloorSettingsPatch>(this.key);
      if (!entry || Object.keys(entry.patch).length === 0) return false;
      this.pending = { ...entry.patch, ...this.pending };
      this.applyLocal();
      this.status.set('pending');
      this.message.set('Restored changes that had not been saved yet.');
      await this.flush();
      return true;
    } catch {
      return false;
    }
  }

  update(patch: FloorSettingsPatch): void {
    if (this.disposed) return;
    this.message.set(null);
    this.pending = { ...this.pending, ...patch };
    this.applyLocal();
    this.status.set('pending');
    void this.writeJournal();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  /** Sends pending changes now. Resolves when the server has them or the attempt failed. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.inflight) {
      await this.inflight;
      if (Object.keys(this.pending).length === 0) return;
    }
    if (Object.keys(this.pending).length === 0) {
      this.status.set('saved');
      return;
    }
    this.inflight = this.send().finally(() => (this.inflight = null));
    await this.inflight;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private async send(conflictRetry = true): Promise<void> {
    const sending = this.pending;
    this.pending = {};
    this.status.set('saving');
    try {
      const saved = await this.api.updateFloorSettings(this.server.id, {
        baseRevision: this.server.revision,
        ...sending,
      });
      this.server = saved;
      this.retryIndex = 0;
      this.applyLocal();
      if (Object.keys(this.pending).length === 0) {
        await this.journal.delete(this.key).catch(() => undefined);
        this.status.set('saved');
        // Informational notices (restored / merged) stay visible until the next edit.
        if (this.status() === 'saved' && /^(Offline|Saving failed)/.test(this.message() ?? '')) this.message.set(null);
      } else {
        this.status.set('pending');
        void this.writeJournal();
        this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
      }
    } catch (err) {
      const e = toApiError(err);
      // Put the unsent changes back (newer edits made meanwhile win).
      this.pending = { ...sending, ...this.pending };

      if (e.status === 409 && conflictRetry) {
        // Someone else saved this floor: take their version and re-apply our changes on top.
        try {
          this.server = await this.api.getFloor(this.server.id);
          this.applyLocal();
          this.message.set('This floor was also changed elsewhere; your latest changes were applied on top.');
          return await this.send(false);
        } catch (inner) {
          return this.fail(toApiError(inner));
        }
      }
      if (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
        // The server rejected the change itself: retrying would fail forever. Revert to the saved state.
        this.pending = {};
        await this.journal.delete(this.key).catch(() => undefined);
        this.applyLocal();
        this.status.set('error');
        this.message.set(`Change not saved: ${e.message}`);
        return;
      }
      this.fail(e);
    }
  }

  private fail(e: ApiError): void {
    this.status.set(e.isNetwork ? 'offline' : 'error');
    this.message.set(
      e.isNetwork
        ? 'Offline: changes are kept on this device and will be saved when the connection returns.'
        : `Saving failed (${e.message}). Retrying automatically.`,
    );
    if (this.disposed) return;
    const delay = RETRY_MS[Math.min(this.retryIndex++, RETRY_MS.length - 1)]!;
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  private applyLocal(): void {
    const p = this.pending;
    const next: FloorDto = { ...this.server };
    if (p.planPage !== undefined) next.planPage = p.planPage;
    if (p.planRotation !== undefined) next.planRotation = p.planRotation;
    if (p.backgroundLocked !== undefined) next.backgroundLocked = p.backgroundLocked;
    if (p.calibration !== undefined) {
      next.calibration = p.calibration;
      next.calibrationNeedsCheck = p.calibrationNeedsCheck ?? false;
    } else if (p.calibrationNeedsCheck !== undefined) {
      next.calibrationNeedsCheck = p.calibrationNeedsCheck;
    }
    this.floorState.set(next);
  }

  private async writeJournal(): Promise<void> {
    try {
      await this.journal.put({
        key: this.key,
        baseRevision: this.server.revision,
        patch: this.pending,
        updatedAt: this.now().toISOString(),
      });
    } catch {
      // If even the journal fails we still hold the change in memory and keep trying to save it.
    }
  }
}
