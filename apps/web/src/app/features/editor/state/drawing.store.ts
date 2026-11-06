import { Injectable, computed, signal } from '@angular/core';
import {
  attachedTo,
  detachEnds,
  normalizeDegrees,
  syncEnds,
  type CircuitDto,
  type ComponentDto,
  type ComponentLookup,
  type DrawingDto,
  type DrawingOp,
  type LayerKey,
  type LayerStateDto,
  type WireDto,
} from '@electro/shared';
import { applyOps, applyWireOps, type DrawingSync } from './drawing-sync';
import { t } from '../../../core/i18n/i18n.service';

/** One object's state before and after a change (null = does not exist). */
export type Change =
  | { kind: 'component'; id: string; before: ComponentDto | null; after: ComponentDto | null }
  | { kind: 'wire'; id: string; before: WireDto | null; after: WireDto | null };

/** An undoable edit: a list of object changes applied together. */
export interface Command {
  label: string;
  changes: Change[];
}

const MAX_HISTORY = 200;

export function invertCommand(cmd: Command): Command {
  return { label: cmd.label, changes: cmd.changes.map((c) => ({ ...c, before: c.after, after: c.before }) as Change) };
}

/** Applies the "after" side of changes to a list, keeping draw order (new items go on top). */
export function applyChanges<T extends { id: string }>(list: readonly T[], changes: readonly { id: string; after: T | null }[]): T[] {
  const byId = new Map(changes.map((c) => [c.id, c]));
  const out: T[] = [];
  for (const item of list) {
    const ch = byId.get(item.id);
    if (!ch) out.push(item);
    else if (ch.after) out.push(ch.after);
    byId.delete(item.id);
  }
  for (const ch of byId.values()) if (ch.after) out.push(ch.after);
  return out;
}

export function changesToOps(changes: readonly Change[]): DrawingOp[] {
  return changes.map((c): DrawingOp => {
    if (c.kind === 'component') return c.after ? { op: 'upsert', component: c.after } : { op: 'delete', id: c.id };
    return c.after ? { op: 'upsertWire', wire: c.after } : { op: 'deleteWire', id: c.id };
  });
}

const compChanges = (cs: readonly Change[]) => cs.filter((c): c is Extract<Change, { kind: 'component' }> => c.kind === 'component');
const wireChanges = (cs: readonly Change[]) => cs.filter((c): c is Extract<Change, { kind: 'wire' }> => c.kind === 'wire');

/**
 * Drawing state of the floor open in the editor: components, wires, layers, selection and undo history.
 * The SVG is rendered from this store; nothing is read back from the DOM.
 */
@Injectable()
export class DrawingStore {
  readonly components = signal<ComponentDto[]>([]);
  readonly wires = signal<WireDto[]>([]);
  readonly layers = signal<LayerStateDto[]>([]);
  /** Selected component and wire ids. */
  readonly selection = signal<ReadonlySet<string>>(new Set());
  /** Circuits of the project (project-level; components and wires reference them by id). */
  readonly circuits = signal<CircuitDto[]>([]);
  /** Distribution boards anywhere in the project (circuits are fed from these). */
  readonly projectBoards = signal<{ id: string; label: string; floorName: string }[]>([]);
  /** When set, everything not on this circuit is dimmed on the plan. */
  readonly highlightCircuit = signal<string | null>(null);
  readonly loaded = signal(false);

  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly historyVersion = signal(0);
  readonly canUndo = computed(() => (this.historyVersion(), this.undoStack.length > 0));
  readonly canRedo = computed(() => (this.historyVersion(), this.redoStack.length > 0));
  readonly undoLabel = computed(() => (this.historyVersion(), this.undoStack.at(-1)?.label ?? null));
  readonly redoLabel = computed(() => (this.historyVersion(), this.redoStack.at(-1)?.label ?? null));

  private sync: DrawingSync | null = null;

  readonly byId = computed(() => new Map(this.components().map((c) => [c.id, c])));
  readonly lookup = computed<ComponentLookup>(() => {
    const m = this.byId();
    return (id: string) => m.get(id);
  });
  readonly layerState = computed(() => new Map(this.layers().map((l) => [l.key, l])));
  readonly visible = computed(() => {
    const ls = this.layerState();
    return this.components().filter((c) => ls.get(c.layerKey)?.visible !== false);
  });
  readonly selectable = computed(() => {
    const ls = this.layerState();
    return this.visible().filter((c) => !ls.get(c.layerKey)?.locked);
  });
  readonly visibleWires = computed(() => (this.layerState().get('wiring')?.visible === false ? [] : this.wires()));
  readonly selectableWires = computed(() => (this.layerState().get('wiring')?.locked ? [] : this.visibleWires()));
  readonly selected = computed(() => {
    const sel = this.selection();
    return this.components().filter((c) => sel.has(c.id));
  });
  readonly selectedWires = computed(() => {
    const sel = this.selection();
    return this.wires().filter((w) => sel.has(w.id));
  });
  readonly selectionCount = computed(() => this.selected().length + this.selectedWires().length);
  readonly countsByLayer = computed(() => {
    const m = new Map<LayerKey, number>();
    for (const c of this.components()) m.set(c.layerKey, (m.get(c.layerKey) ?? 0) + 1);
    m.set('wiring', (m.get('wiring') ?? 0) + this.wires().length);
    return m;
  });

  load(drawing: DrawingDto, sync: DrawingSync | null, recovered: DrawingOp[] = []): void {
    this.sync = sync;
    this.components.set(applyOps(drawing.components, recovered));
    this.wires.set(applyWireOps(drawing.wires ?? [], recovered));
    this.layers.set(applyLayerOps(drawing.layers, recovered));
    this.selection.set(new Set());
    this.undoStack = [];
    this.redoStack = [];
    this.historyVersion.update((v) => v + 1);
    this.loaded.set(true);
  }

  replaceFromServer(drawing: DrawingDto, reapply: DrawingOp[]): void {
    this.components.set(applyOps(drawing.components, reapply));
    this.wires.set(applyWireOps(drawing.wires ?? [], reapply));
    this.layers.set(applyLayerOps(drawing.layers, reapply));
    const ids = new Set([...this.components().map((c) => c.id), ...this.wires().map((w) => w.id)]);
    this.selection.update((s) => new Set([...s].filter((id) => ids.has(id))));
  }

  reset(): void {
    this.sync = null;
    this.components.set([]);
    this.wires.set([]);
    this.layers.set([]);
    this.selection.set(new Set());
    this.undoStack = [];
    this.redoStack = [];
    this.historyVersion.update((v) => v + 1);
    this.loaded.set(false);
  }

  // ── editing ──

  /** True when the company's subscription is inactive: the drawing can be viewed but not changed. */
  readonly readOnly = signal(false);

  execute(cmd: Command): void {
    if (this.readOnly()) return;
    const changes = cmd.changes.filter((c) => !same(c.before, c.after));
    if (changes.length === 0) return;
    this.applyRaw(changes);
    this.undoStack.push({ ...cmd, changes });
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.historyVersion.update((v) => v + 1);
    this.sync?.queue(changesToOps(changes));
  }

  private applyRaw(changes: readonly Change[]): void {
    const cc = compChanges(changes);
    const wc = wireChanges(changes);
    if (cc.length) this.components.update((list) => applyChanges(list, cc));
    if (wc.length) this.wires.update((list) => applyChanges(list, wc));
  }

  undo(): string | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    const inv = invertCommand(cmd);
    this.applyRaw(inv.changes);
    this.redoStack.push(cmd);
    this.afterHistoryMove(inv);
    return cmd.label;
  }

  redo(): string | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    this.applyRaw(cmd.changes);
    this.undoStack.push(cmd);
    this.afterHistoryMove(cmd);
    return cmd.label;
  }

  private afterHistoryMove(applied: Command): void {
    this.historyVersion.update((v) => v + 1);
    this.selection.set(new Set(applied.changes.filter((c) => c.after).map((c) => c.id)));
    this.sync?.queue(changesToOps(applied.changes));
  }

  // ── moving (live preview during drags, then one command) ──

  /** Snapshot of everything a move of these components affects. */
  moveSnapshot(componentIds: ReadonlySet<string>, extraWireIds: ReadonlySet<string> = new Set()): { components: ComponentDto[]; wires: WireDto[] } {
    return {
      components: this.components().filter((c) => componentIds.has(c.id)),
      wires: this.wires().filter((w) => {
        const a = attachedTo(w, componentIds);
        return a.from || a.to || extraWireIds.has(w.id);
      }),
    };
  }

  /** Positions after moving a snapshot by (dx, dy). Wires move entirely when selected or when both ends move. */
  movedBy(
    snap: { components: ComponentDto[]; wires: WireDto[] },
    dx: number,
    dy: number,
    selectedWireIds: ReadonlySet<string>,
  ): { components: ComponentDto[]; wires: WireDto[] } {
    const components = snap.components.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
    const moved = new Map(components.map((c) => [c.id, c]));
    const ids = new Set(moved.keys());
    const base = this.byId();
    const lookup: ComponentLookup = (id) => moved.get(id) ?? base.get(id);
    const shift = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
    const wires = snap.wires.map((w) => {
      const a = attachedTo(w, ids);
      const whole = selectedWireIds.has(w.id) || (a.from && a.to);
      let next: WireDto = whole
        ? {
            ...w,
            points: w.points.map(shift),
            from: w.from.componentId ? w.from : { ...w.from, ...shift(w.from) },
            to: w.to.componentId ? w.to : { ...w.to, ...shift(w.to) },
          }
        : w;
      next = syncEnds(next, lookup);
      return next;
    });
    return { components, wires };
  }

  preview(state: { components?: readonly ComponentDto[]; wires?: readonly WireDto[] }): void {
    if (state.components?.length) {
      const m = new Map(state.components.map((c) => [c.id, c]));
      this.components.update((list) => list.map((c) => m.get(c.id) ?? c));
    }
    if (state.wires?.length) {
      const m = new Map(state.wires.map((w) => [w.id, w]));
      this.wires.update((list) => list.map((w) => m.get(w.id) ?? w));
    }
  }

  /** Ends a drag: records the difference between the snapshot and the current state as one command. */
  commitPreview(label: string, before: { components: readonly ComponentDto[]; wires: readonly WireDto[] }): void {
    const nowC = this.byId();
    const nowW = new Map(this.wires().map((w) => [w.id, w]));
    const changes: Change[] = [
      ...before.components.map((b): Change => ({ kind: 'component', id: b.id, before: b, after: nowC.get(b.id) ?? null })),
      ...before.wires.map((b): Change => ({ kind: 'wire', id: b.id, before: b, after: nowW.get(b.id) ?? null })),
    ];
    this.preview({ components: before.components, wires: before.wires });
    this.execute({ label, changes });
  }

  // ── commands ──

  add(components: ComponentDto[], label = components.length === 1 ? t('Add component') : t('Add {n} components', { n: components.length }), wires: WireDto[] = []): void {
    this.execute({
      label,
      changes: [
        ...components.map((c): Change => ({ kind: 'component', id: c.id, before: null, after: c })),
        ...wires.map((w): Change => ({ kind: 'wire', id: w.id, before: null, after: w })),
      ],
    });
    this.selection.set(new Set([...components.map((c) => c.id), ...wires.map((w) => w.id)]));
  }

  addWire(w: WireDto): void {
    this.execute({ label: 'Draw wire', changes: [{ kind: 'wire', id: w.id, before: null, after: w }] });
    this.selection.set(new Set([w.id]));
  }

  update(updated: ComponentDto[], label: string): void {
    const now = this.byId();
    const comps = updated.filter((u) => now.has(u.id));
    const lookup: ComponentLookup = (id) => comps.find((c) => c.id === id) ?? now.get(id);
    const ids = new Set(comps.map((c) => c.id));
    // Keep the cached end positions of attached wires in sync (e.g. after a rotation).
    const wireCh: Change[] = this.wires()
      .filter((w) => {
        const a = attachedTo(w, ids);
        return a.from || a.to;
      })
      .map((w) => ({ kind: 'wire', id: w.id, before: w, after: syncEnds(w, lookup) }));
    this.execute({
      label,
      changes: [...comps.map((u): Change => ({ kind: 'component', id: u.id, before: now.get(u.id)!, after: u })), ...wireCh],
    });
  }

  updateWires(updated: WireDto[], label: string): void {
    const now = new Map(this.wires().map((w) => [w.id, w]));
    this.execute({
      label,
      changes: updated.filter((w) => now.has(w.id)).map((w): Change => ({ kind: 'wire', id: w.id, before: now.get(w.id)!, after: w })),
    });
  }

  /** Deletes selected components and wires. Wires still attached to deleted components keep a free end there. */
  deleteSelected(): number {
    const comps = this.selected();
    const selWires = this.selectedWires();
    const n = comps.length + selWires.length;
    if (n === 0) return 0;
    const delIds = new Set(comps.map((c) => c.id));
    const selWireIds = new Set(selWires.map((w) => w.id));
    const lookup = this.lookup();
    const detached: Change[] = this.wires()
      .filter((w) => !selWireIds.has(w.id))
      .map((w) => ({ kind: 'wire' as const, id: w.id, before: w, after: detachEnds(w, delIds, lookup) }))
      .filter((c) => c.before !== c.after);
    this.execute({
      label: n === 1 ? (comps.length ? t('Delete component') : t('Delete wire')) : t('Delete {n} objects', { n }),
      changes: [
        ...selWires.map((w): Change => ({ kind: 'wire', id: w.id, before: w, after: null })),
        ...detached,
        ...comps.map((c): Change => ({ kind: 'component', id: c.id, before: c, after: null })),
      ],
    });
    this.selection.set(new Set());
    return n;
  }

  rotateSelected(degrees: number): void {
    const sel = this.selected();
    if (sel.length === 0) return;
    this.update(
      sel.map((c) => ({ ...c, rotation: normalizeDegrees(c.rotation + degrees) })),
      sel.length === 1 ? t('Rotate component') : t('Rotate {n} components', { n: sel.length }),
    );
  }

  moveSelected(dx: number, dy: number, label = t('Move')): void {
    const compIds = new Set(this.selected().map((c) => c.id));
    const wireIds = new Set(this.selectedWires().map((w) => w.id));
    if (!compIds.size && !wireIds.size) return;
    const snap = this.moveSnapshot(compIds, wireIds);
    const moved = this.movedBy(snap, dx, dy, wireIds);
    this.preview(moved);
    this.commitPreview(label, snap);
  }

  /** Assigns (or with null, unassigns) every selected component and wire to a circuit. One undo step. */
  assignSelectionToCircuit(circuitId: string | null): number {
    const comps = this.selected();
    const wires = this.selectedWires();
    const changes: Change[] = [
      ...comps.map((c): Change => ({ kind: 'component', id: c.id, before: c, after: { ...c, circuitId } })),
      ...wires.map((w): Change => ({ kind: 'wire', id: w.id, before: w, after: { ...w, circuitId } })),
    ];
    this.execute({ label: circuitId ? t('Assign to circuit') : t('Remove from circuit'), changes });
    return changes.length;
  }

  // ── selection ──
  select(ids: Iterable<string>, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
    const next = mode === 'replace' ? new Set<string>() : new Set(this.selection());
    for (const id of ids) {
      if (mode === 'toggle' && next.has(id)) next.delete(id);
      else next.add(id);
    }
    this.selection.set(next);
  }

  clearSelection(): void {
    if (this.selection().size) this.selection.set(new Set());
  }

  // ── layers (saved, but not part of undo history) ──
  setLayer(key: LayerKey, patch: { visible?: boolean; locked?: boolean }): void {
    this.layers.update((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    if (patch.visible === false || patch.locked === true) {
      const keep = new Set([...this.selectable().map((c) => c.id), ...this.selectableWires().map((w) => w.id)]);
      this.selection.update((s) => new Set([...s].filter((id) => keep.has(id))));
    }
    this.sync?.queue([{ op: 'layer', key, ...patch }]);
  }
}

function applyLayerOps(layers: LayerStateDto[], ops: DrawingOp[]): LayerStateDto[] {
  return layers.map((l) => {
    let next = l;
    for (const op of ops) {
      if (op.op === 'layer' && op.key === l.key) {
        next = {
          ...next,
          ...(op.visible !== undefined ? { visible: op.visible } : {}),
          ...(op.locked !== undefined ? { locked: op.locked } : {}),
        };
      }
    }
    return next;
  });
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
