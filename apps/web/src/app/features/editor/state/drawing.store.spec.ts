import { TestBed } from '@angular/core/testing';
import { createComponent, uuidv7, type ComponentDto, type DrawingDto, type DrawingOp } from '@electro/shared';
import { DrawingStore, applyChanges, invertCommand, type Command } from './drawing.store';
import { DrawingSync } from './drawing-sync';
import { MemoryJournal } from './journal';

const comp = (typeKey: string, x: number, y: number) => createComponent(typeKey, { x, y }, uuidv7(), []);
const drawing = (components: ComponentDto[] = []): DrawingDto => ({
  floorId: 'f',
  revision: 0,
  layers: [
    { key: 'lighting', visible: true, locked: false },
    { key: 'switches', visible: true, locked: false },
    { key: 'outlets', visible: true, locked: false },
  ],
  components,
});

function setup(initial: ComponentDto[] = []) {
  TestBed.configureTestingModule({ providers: [DrawingStore] });
  const store = TestBed.inject(DrawingStore);
  store.load(drawing(initial), null);
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
        { id: a.id, before: a, after: { ...a, x: 50 } },
        { id: b.id, before: b, after: null },
        { id: 'new', before: null, after: { ...a, id: 'new' } },
      ],
    };
    const applied = applyChanges(start, cmd.changes);
    expect(applied.map((c) => c.id)).toEqual([a.id, 'new']);
    expect(applyChanges(applied, invertCommand(cmd).changes)).toEqual([a, b]);
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
    const before = store.selected();
    for (let i = 1; i <= 20; i++) store.preview(before.map((c) => ({ ...c, x: c.x + i })));
    store.commitPreview('Move', before);
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
