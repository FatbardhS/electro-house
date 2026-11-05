import { Injectable, computed, signal } from '@angular/core';
import {
  normalizeDegrees,
  type ComponentDto,
  type DrawingDto,
  type DrawingOp,
  type LayerKey,
  type LayerStateDto,
} from '@electro/shared';
import { applyOps, type DrawingSync } from './drawing-sync';

/** One component's state before and after a change (null = does not exist). */
export interface Change {
  id: string;
  before: ComponentDto | null;
  after: ComponentDto | null;
}

/** An undoable edit. Every drawing edit is expressed as a list of component changes. */
export interface Command {
  label: string;
  changes: Change[];
}

const MAX_HISTORY = 200;

/** Inverse of a command: undoing it means applying its "before" states. */
export function invertCommand(cmd: Command): Command {
  return { label: cmd.label, changes: cmd.changes.map((c) => ({ id: c.id, before: c.after, after: c.before })) };
}

/** Applies the "after" side of changes to a component list, keeping draw order (new items go on top). */
export function applyChanges(components: readonly ComponentDto[], changes: readonly Change[]): ComponentDto[] {
  const byId = new Map(changes.map((c) => [c.id, c]));
  const out: ComponentDto[] = [];
  for (const comp of components) {
    const ch = byId.get(comp.id);
    if (!ch) out.push(comp);
    else if (ch.after) out.push(ch.after);
    byId.delete(comp.id);
  }
  for (const ch of byId.values()) if (ch.after) out.push(ch.after);
  return out;
}

export function changesToOps(changes: readonly Change[]): DrawingOp[] {
  return changes.map((c) => (c.after ? { op: 'upsert', component: c.after } : { op: 'delete', id: c.id }));
}

/**
 * Drawing state of the floor open in the editor: components, layers, selection and undo history.
 * The SVG is rendered from this store; nothing is read back from the DOM.
 */
@Injectable()
export class DrawingStore {
  readonly components = signal<ComponentDto[]>([]);
  readonly layers = signal<LayerStateDto[]>([]);
  readonly selection = signal<ReadonlySet<string>>(new Set());
  readonly loaded = signal(false);

  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly historyVersion = signal(0);
  readonly canUndo = computed(() => (this.historyVersion(), this.undoStack.length > 0));
  readonly canRedo = computed(() => (this.historyVersion(), this.redoStack.length > 0));
  readonly undoLabel = computed(() => (this.historyVersion(), this.undoStack.at(-1)?.label ?? null));
  readonly redoLabel = computed(() => (this.historyVersion(), this.redoStack.at(-1)?.label ?? null));

  private sync: DrawingSync | null = null;

  readonly layerState = computed(() => new Map(this.layers().map((l) => [l.key, l])));
  /** Components on visible layers, in draw order. */
  readonly visible = computed(() => {
    const ls = this.layerState();
    return this.components().filter((c) => ls.get(c.layerKey)?.visible !== false);
  });
  /** Components that can be clicked / selected (visible and not locked). */
  readonly selectable = computed(() => {
    const ls = this.layerState();
    return this.visible().filter((c) => !ls.get(c.layerKey)?.locked);
  });
  readonly selected = computed(() => {
    const sel = this.selection();
    return this.components().filter((c) => sel.has(c.id));
  });
  readonly countsByLayer = computed(() => {
    const m = new Map<LayerKey, number>();
    for (const c of this.components()) m.set(c.layerKey, (m.get(c.layerKey) ?? 0) + 1);
    return m;
  });

  /** Loads a floor's drawing. Ops from the journal (unsaved earlier work) are re-applied on top. */
  load(drawing: DrawingDto, sync: DrawingSync | null, recovered: DrawingOp[] = []): void {
    this.sync = sync;
    this.components.set(applyOps(drawing.components, recovered));
    this.layers.set(applyLayerOps(drawing.layers, recovered));
    this.selection.set(new Set());
    this.undoStack = [];
    this.redoStack = [];
    this.historyVersion.update((v) => v + 1);
    this.loaded.set(true);
  }

  /** Server copy replaced ours (conflict or rejected change): show it with our unsaved ops on top. */
  replaceFromServer(drawing: DrawingDto, reapply: DrawingOp[]): void {
    this.components.set(applyOps(drawing.components, reapply));
    this.layers.set(applyLayerOps(drawing.layers, reapply));
    const ids = new Set(this.components().map((c) => c.id));
    this.selection.update((s) => new Set([...s].filter((id) => ids.has(id))));
  }

  reset(): void {
    this.sync = null;
    this.components.set([]);
    this.layers.set([]);
    this.selection.set(new Set());
    this.undoStack = [];
    this.redoStack = [];
    this.historyVersion.update((v) => v + 1);
    this.loaded.set(false);
  }

  // ── editing ──

  /** Applies an edit, records it for undo and queues it for saving. */
  execute(cmd: Command): void {
    const changes = cmd.changes.filter((c) => !sameComponent(c.before, c.after));
    if (changes.length === 0) return;
    const real = { ...cmd, changes };
    this.components.update((list) => applyChanges(list, changes));
    this.undoStack.push(real);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.historyVersion.update((v) => v + 1);
    this.sync?.queue(changesToOps(changes));
  }

  undo(): string | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    const inv = invertCommand(cmd);
    this.components.update((list) => applyChanges(list, inv.changes));
    this.redoStack.push(cmd);
    this.afterHistoryMove(inv);
    return cmd.label;
  }

  redo(): string | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    this.components.update((list) => applyChanges(list, cmd.changes));
    this.undoStack.push(cmd);
    this.afterHistoryMove(cmd);
    return cmd.label;
  }

  private afterHistoryMove(applied: Command): void {
    this.historyVersion.update((v) => v + 1);
    const ids = new Set(this.components().map((c) => c.id));
    // Select what the undo/redo touched, so the user sees what changed.
    this.selection.set(new Set(applied.changes.filter((c) => c.after && ids.has(c.id)).map((c) => c.id)));
    this.sync?.queue(changesToOps(applied.changes));
  }

  /** Live preview during a drag: updates positions without history or saving. */
  preview(updated: readonly ComponentDto[]): void {
    const byId = new Map(updated.map((c) => [c.id, c]));
    this.components.update((list) => list.map((c) => byId.get(c.id) ?? c));
  }

  /** Ends a drag: turns the difference between the snapshot and the current state into one command. */
  commitPreview(label: string, before: readonly ComponentDto[]): void {
    const now = new Map(this.components().map((c) => [c.id, c]));
    const changes = before.map((b) => ({ id: b.id, before: b, after: now.get(b.id) ?? null }));
    // Put the original state back first so execute() records a clean before → after step.
    this.preview(before);
    this.execute({ label, changes });
  }

  add(components: ComponentDto[], label = components.length === 1 ? 'Add component' : `Add ${components.length} components`): void {
    this.execute({ label, changes: components.map((c) => ({ id: c.id, before: null, after: c })) });
    this.selection.set(new Set(components.map((c) => c.id)));
  }

  update(updated: ComponentDto[], label: string): void {
    const now = new Map(this.components().map((c) => [c.id, c]));
    this.execute({
      label,
      changes: updated.filter((u) => now.has(u.id)).map((u) => ({ id: u.id, before: now.get(u.id)!, after: u })),
    });
  }

  deleteSelected(): number {
    const sel = this.selected();
    if (sel.length === 0) return 0;
    this.execute({
      label: sel.length === 1 ? 'Delete component' : `Delete ${sel.length} components`,
      changes: sel.map((c) => ({ id: c.id, before: c, after: null })),
    });
    this.selection.set(new Set());
    return sel.length;
  }

  rotateSelected(degrees: number): void {
    const sel = this.selected();
    if (sel.length === 0) return;
    this.update(
      sel.map((c) => ({ ...c, rotation: normalizeDegrees(c.rotation + degrees) })),
      sel.length === 1 ? 'Rotate component' : `Rotate ${sel.length} components`,
    );
  }

  moveSelected(dx: number, dy: number, label = 'Move'): void {
    const sel = this.selected();
    if (sel.length === 0) return;
    this.update(
      sel.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy })),
      label,
    );
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
      const keep = new Set(this.selectable().map((c) => c.id));
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

function sameComponent(a: ComponentDto | null, b: ComponentDto | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
