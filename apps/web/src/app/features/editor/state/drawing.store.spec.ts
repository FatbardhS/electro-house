import { TestBed } from '@angular/core/testing';
import { DEFAULT_CABLE, createComponent, uuidv7, wireRoute, type ComponentDto, type DrawingDto, type DrawingOp, type WireDto } from '@electro/shared';
import { DrawingStore, applyChanges, invertCommand, type Command } from './drawing.store';
import { DrawingSync } from './drawing-sync';
import { MemoryJournal } from './journal';

const comp = (typeKey: string, x: number, y: number) => createComponent(typeKey, { x, y }, uuidv7(), []);
const drawing = (components: ComponentDto[] = [], wires: WireDto[] = []): DrawingDto => ({
  floorId: 'f',
  revision: 0,
  layers: [
    { key: 'lighting', visible: true, locked: false },
    { key: 'switches', visible: true, locked: false },
    { key: 'outlets', visible: true, locked: false },
    { key: 'wiring', visible: true, locked: false },
  ],
  components,
  wires,
});

function setup(initial: ComponentDto[] = [], wires: WireDto[] = []) {
  TestBed.configureTestingModule({ providers: [DrawingStore] });
  const store = TestBed.inject(DrawingStore);
  store.load(drawing(initial, wires), null);
  return store;
}

describe('commands', () => {
  it('invert(apply(state)) restores the original state for adds, moves and deletes', () => {
    const a = comp('light.ceiling', 0, 0);
    const b = comp('switch.single', 10, 0);
    const start = [a, b];
    const cmd: Command = {
      label: 'mixed',
      changes: [
        { kind: 'component', id: a.id, before: a, after: { ...a, x: 50 } },
        { kind: 'component', id: b.id, before: b, after: null },
        { kind: 'component', id: 'new', before: null, after: { ...a, id: 'new' } },
      ],
    };
    const applied = applyChanges(start, cmd.changes as { id: string; after: ComponentDto | null }[]);
    expect(applied.map((c) => c.id)).toEqual([a.id, 'new']);
    expect(applyChanges(applied, invertCommand(cmd).changes as { id: string; after: ComponentDto | null }[])).toEqual([a, b]);
  });
});

describe('DrawingStore history', () => {
  it('undoes and redoes add, move, rotate and delete', () => {
    const store = setup();
    const a = comp('light.ceiling', 10, 10);
    store.add([a]);
    store.moveSelected(5, 0);
    store.rotateSelected(90);
    expect(store.components()[0]).toMatchObject({ x: 15, rotation: 90 });
    store.deleteSelected();
    expect(store.components()).toEqual([]);

    expect(store.undo()).toBe('Delete component');
    expect(store.components()[0]).toMatchObject({ x: 15, rotation: 90 });
    store.undo();
    store.undo();
    expect(store.components()[0]).toMatchObject({ x: 10, rotation: 0 });
    store.undo();
    expect(store.components()).toEqual([]);
    expect(store.canUndo()).toBe(false);

    store.redo();
    store.redo();
    expect(store.components()[0]).toMatchObject({ x: 15, rotation: 0 });
    expect(store.canRedo()).toBe(true);
  });

  it('a new edit clears redo; no-op edits are not recorded', () => {
    const store = setup();
    const a = comp('switch.single', 0, 0);
    store.add([a]);
    store.moveSelected(1, 1);
    store.undo();
    store.update([store.components()[0]!], 'nothing');
    expect(store.canRedo()).toBe(true); // no-op did not clear redo
    store.rotateSelected(90);
    expect(store.canRedo()).toBe(false);
  });

  it('a whole drag is one undo step', () => {
    const a = comp('outlet.single', 0, 0);
    const b = comp('outlet.single', 10, 0);
    const store = setup([a, b]);
    store.select([a.id, b.id]);
    const snap = store.moveSnapshot(new Set([a.id, b.id]));
    for (let i = 1; i <= 20; i++) store.preview(store.movedBy(snap, i, 0, new Set()));
    store.commitPreview('Move', snap);
    expect(store.components().map((c) => c.x)).toEqual([20, 30]);
    store.undo();
    expect(store.components().map((c) => c.x)).toEqual([0, 10]);
    expect(store.canUndo()).toBe(false);
  });

  it('hidden and locked layers are not selectable', () => {
    const light = comp('light.ceiling', 0, 0);
    const sw = comp('switch.single', 5, 5);
    const store = setup([light, sw]);
    store.select([light.id, sw.id]);
    store.setLayer('lighting', { locked: true });
    expect(store.selectable().map((c) => c.id)).toEqual([sw.id]);
    expect([...store.selection()]).toEqual([sw.id]);
    store.setLayer('switches', { visible: false });
    expect(store.visible().map((c) => c.id)).toEqual([light.id]);
    expect(store.selectable()).toEqual([]);
  });
});

describe('DrawingStore + DrawingSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves edits in one batch and undo is saved too', async () => {
    const calls: DrawingOp[][] = [];
    let revision = 0;
    const api = {
      getDrawing: async () => drawing(),
      patchDrawing: async (_f: string, input: { baseRevision: number; ops: DrawingOp[] }) => {
        expect(input.baseRevision).toBe(revision);
        calls.push(input.ops);
        return { revision: ++revision };
      },
    };
    TestBed.configureTestingModule({ providers: [DrawingStore] });
    const store = TestBed.inject(DrawingStore);
    const sync = new DrawingSync('f', 0, api, new MemoryJournal(), (d, ops) => store.replaceFromServer(d, ops));
    store.load(drawing(), sync);
    const a = comp('light.ceiling', 1, 1);
    store.add([a]);
    store.moveSelected(4, 0);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([{ op: 'upsert', component: { ...a, x: 5 } }]);

    store.undo();
    store.undo();
    await vi.runAllTimersAsync();
    expect(calls[1]).toEqual([{ op: 'delete', id: a.id }]);
    expect(sync.status()).toBe('saved');
  });

  it('re-applies local changes on top of a newer server drawing after a conflict', async () => {
    const other = comp('switch.single', 50, 50);
    let serverRevision = 3; // someone else saved meanwhile
    const api = {
      getDrawing: async () => ({ ...drawing([other]), revision: serverRevision }),
      patchDrawing: async (_f: string, input: { baseRevision: number }) => {
        if (input.baseRevision !== serverRevision) throw Object.assign(new Error('conflict'), { status: 409 });
        return { revision: ++serverRevision };
      },
    };
    // toApiError reads HttpErrorResponse; emulate one
    const { HttpErrorResponse } = await import('@angular/common/http');
    const wrapped = {
      ...api,
      patchDrawing: async (f: string, input: { baseRevision: number; ops: DrawingOp[] }) => {
        try {
          return await api.patchDrawing(f, input);
        } catch {
          throw new HttpErrorResponse({ status: 409, error: { message: 'conflict' } });
        }
      },
    };
    TestBed.configureTestingModule({ providers: [DrawingStore] });
    const store = TestBed.inject(DrawingStore);
    const sync = new DrawingSync('f', 0, wrapped, new MemoryJournal(), (d, ops) => store.replaceFromServer(d, ops));
    store.load(drawing(), sync);
    const mine = comp('light.ceiling', 1, 1);
    store.add([mine]);
    await vi.runAllTimersAsync();
    expect(store.components().map((c) => c.id).sort()).toEqual([other.id, mine.id].sort());
    expect(serverRevision).toBe(4);
    expect(sync.status()).toBe('saved');
  });
});

describe('DrawingStore wires', () => {
  const wireBetween = (a: ComponentDto, b: ComponentDto, points = [{ x: a.x, y: b.y }]): WireDto => ({
    id: uuidv7(),
    label: null,
    from: { componentId: a.id, portId: 'p', x: a.x, y: a.y },
    to: { componentId: b.id, portId: 'p', x: b.x, y: b.y },
    points,
    cable: { ...DEFAULT_CABLE },
    circuitId: null,
    description: null,
  });

  it('deleting a component keeps its wires with a free end where it was; undo reconnects', () => {
    const sw = comp('switch.single', 0, 0);
    const lamp = comp('light.ceiling', 100, 100);
    const w = wireBetween(sw, lamp);
    const store = setup([sw, lamp], [w]);
    store.select([lamp.id]);
    store.deleteSelected();
    expect(store.components().map((c) => c.id)).toEqual([sw.id]);
    expect(store.wires()[0]!.to).toEqual({ componentId: null, portId: null, x: 100, y: 100 });
    store.undo();
    expect(store.wires()[0]!.to.componentId).toBe(lamp.id);
    expect(store.components()).toHaveLength(2);
  });

  it('moving both connected components moves the whole route; moving one keeps the bends', () => {
    const sw = comp('switch.single', 0, 0);
    const lamp = comp('light.ceiling', 100, 100);
    const w = wireBetween(sw, lamp);
    const store = setup([sw, lamp], [w]);
    store.select([sw.id, lamp.id]);
    store.moveSelected(10, 5);
    expect(wireRoute(store.wires()[0]!, store.lookup())).toEqual([{ x: 10, y: 5 }, { x: 10, y: 105 }, { x: 110, y: 105 }]);
    store.undo();
    store.select([lamp.id]);
    store.moveSelected(50, 0);
    expect(wireRoute(store.wires()[0]!, store.lookup())).toEqual([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 150, y: 100 }]);
    // stored end cache follows the component
    expect(store.wires()[0]!.to).toMatchObject({ x: 150, y: 100 });
  });

  it('draws, edits and deletes wires with undo', () => {
    const sw = comp('switch.single', 0, 0);
    const lamp = comp('light.ceiling', 100, 100);
    const store = setup([sw, lamp]);
    const w = wireBetween(sw, lamp);
    store.addWire(w);
    store.updateWires([{ ...w, cable: { ...w.cable, crossSectionMm2: 2.5 } }], 'Change cable');
    expect(store.wires()[0]!.cable.crossSectionMm2).toBe(2.5);
    store.select([w.id]);
    store.deleteSelected();
    expect(store.wires()).toEqual([]);
    store.undo();
    store.undo();
    expect(store.wires()[0]!.cable.crossSectionMm2).toBe(1.5);
  });
});
