import { HttpErrorResponse } from '@angular/common/http';
import type { FloorDto, FloorSettingsInput } from '@electro/shared';
import { FloorSync, type FloorSettingsApi } from './floor-sync';
import { MemoryJournal } from './journal';

function floor(partial: Partial<FloorDto> = {}): FloorDto {
  return {
    id: 'f1',
    projectId: 'p1',
    name: 'Ground floor',
    sortOrder: 0,
    planFile: { id: 'file', originalName: 'a.pdf', sizeBytes: 1, pageCount: 3, createdAt: '' },
    planPage: 1,
    planRotation: 0,
    backgroundLocked: false,
    calibration: null,
    calibrationNeedsCheck: false,
    revision: 1,
    updatedAt: '',
    ...partial,
  };
}

/** Fake server that applies settings with the same revision rule as the API. */
class FakeServer implements FloorSettingsApi {
  state = floor();
  calls: FloorSettingsInput[] = [];
  failNext: 'network' | 'server' | 'invalid' | null = null;

  async updateFloorSettings(_id: string, input: FloorSettingsInput): Promise<FloorDto> {
    this.calls.push(input);
    const fail = this.failNext;
    this.failNext = null;
    if (fail === 'network') throw new HttpErrorResponse({ status: 0 });
    if (fail === 'server') throw new HttpErrorResponse({ status: 503, error: { message: 'down' } });
    if (fail === 'invalid') throw new HttpErrorResponse({ status: 400, error: { message: 'The plan has only 3 page(s).' } });
    if (input.baseRevision !== this.state.revision) {
      throw new HttpErrorResponse({ status: 409, error: { message: 'conflict' } });
    }
    const { baseRevision: _, ...patch } = input;
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 } as FloorDto;
    return this.state;
  }

  async getFloor(): Promise<FloorDto> {
    return this.state;
  }
}

describe('FloorSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('applies changes locally at once and batches them into one save', async () => {
    const server = new FakeServer();
    const sync = new FloorSync(server.state, server, new MemoryJournal());
    sync.update({ planRotation: 90 });
    sync.update({ planPage: 2 });
    expect(sync.floor()).toMatchObject({ planRotation: 90, planPage: 2 });
    expect(sync.status()).toBe('pending');

    await vi.runAllTimersAsync();
    expect(server.calls).toEqual([{ baseRevision: 1, planRotation: 90, planPage: 2 }]);
    expect(sync.status()).toBe('saved');
    expect(sync.floor().revision).toBe(2);
  });

  it('keeps changes in the journal until the server confirms them', async () => {
    const server = new FakeServer();
    const journal = new MemoryJournal();
    const sync = new FloorSync(server.state, server, journal);
    server.failNext = 'network';
    sync.update({ planRotation: 180 });
    await vi.advanceTimersByTimeAsync(800);
    expect(sync.status()).toBe('offline');
    expect((await journal.get('floor-settings:f1'))?.patch).toEqual({ planRotation: 180 });

    await vi.runAllTimersAsync(); // automatic retry
    expect(sync.status()).toBe('saved');
    expect(server.state.planRotation).toBe(180);
    expect(await journal.get('floor-settings:f1')).toBeUndefined();
  });

  it('recovers unsaved changes after a reload', async () => {
    const server = new FakeServer();
    const journal = new MemoryJournal();
    const first = new FloorSync(server.state, server, journal);
    server.failNext = 'network';
    first.update({ backgroundLocked: true });
    await vi.advanceTimersByTimeAsync(800);
    first.dispose(); // page closed before it could save

    const second = new FloorSync(server.state, server, journal);
    const recovering = second.recover();
    await vi.runAllTimersAsync();
    expect(await recovering).toBe(true);
    expect(server.state.backgroundLocked).toBe(true);
    expect(second.status()).toBe('saved');
  });

  it('re-applies local changes on top of a newer server version after a conflict', async () => {
    const server = new FakeServer();
    const sync = new FloorSync(server.state, server, new MemoryJournal());
    // Another session saves first: page 3, revision 2.
    server.state = { ...server.state, planPage: 3, revision: 2 };
    sync.update({ planRotation: 270 });
    await vi.runAllTimersAsync();

    expect(server.state).toMatchObject({ planPage: 3, planRotation: 270, revision: 3 });
    expect(sync.floor()).toMatchObject({ planPage: 3, planRotation: 270 });
    expect(sync.status()).toBe('saved');
    expect(sync.message()).toMatch(/changed elsewhere/);
  });

  it('reverts a change the server rejects instead of retrying forever', async () => {
    const server = new FakeServer();
    const journal = new MemoryJournal();
    const sync = new FloorSync(server.state, server, journal);
    server.failNext = 'invalid';
    sync.update({ planPage: 9 });
    await vi.runAllTimersAsync();
    expect(sync.status()).toBe('error');
    expect(sync.floor().planPage).toBe(1);
    expect(sync.message()).toContain('only 3 page');
    expect(server.calls).toHaveLength(1);
    expect(await journal.get('floor-settings:f1')).toBeUndefined();
  });

  it('retries server errors and keeps edits made in the meantime', async () => {
    const server = new FakeServer();
    const sync = new FloorSync(server.state, server, new MemoryJournal());
    server.failNext = 'server';
    sync.update({ planRotation: 90 });
    await vi.advanceTimersByTimeAsync(800);
    expect(sync.status()).toBe('error');
    sync.update({ planPage: 2 });
    await vi.runAllTimersAsync();
    expect(server.state).toMatchObject({ planRotation: 90, planPage: 2 });
    expect(sync.status()).toBe('saved');
  });

  it('a new calibration clears the "needs checking" flag locally', () => {
    const server = new FakeServer();
    server.state = floor({ calibrationNeedsCheck: true });
    const sync = new FloorSync(server.state, server, new MemoryJournal());
    sync.update({
      calibration: { method: 'paper-scale', paperScale: 50, metresPerUnit: 0.0176, calibratedAt: new Date().toISOString() },
    });
    expect(sync.floor().calibrationNeedsCheck).toBe(false);
    expect(sync.floor().calibration?.method).toBe('paper-scale');
  });
});
