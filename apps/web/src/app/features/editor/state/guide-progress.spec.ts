import { describe, expect, it } from 'vitest';
import { createComponent, DEFAULT_CABLE, type ComponentDto, type WireDto } from '@electro/shared';
import { firstOpenStep, guideProgress } from './guide-progress';

const comp = (typeKey: string, id: string): ComponentDto => createComponent(typeKey, { x: 0, y: 0 }, id, []);
const wire = (from: string, to: string): WireDto => ({
  id: `${from}-${to}`,
  label: null,
  from: { componentId: from, portId: 'p', x: 0, y: 0 },
  to: { componentId: to, portId: 'p', x: 0, y: 0 },
  points: [],
  cable: { ...DEFAULT_CABLE },
  circuitId: null,
  description: null,
});

describe('guideProgress', () => {
  it('starts at the scale step on an empty floor', () => {
    const p = guideProgress([], [], false, []);
    expect(firstOpenStep(p)).toBe('plan');
  });

  it('needs a switch once there are lights', () => {
    const p = guideProgress([comp('light.ceiling', 'l'), comp('outlet.single', 'o')], [], true, []);
    expect(p.steps.lights.done).toBe(true);
    expect(p.steps.outlets.done).toBe(false);
    expect(firstOpenStep(p)).toBe('outlets');
  });

  it('counts items without a wire and ignores notes', () => {
    const items = [comp('board.main', 'b'), comp('light.ceiling', 'l'), comp('switch.single', 's'), comp('outlet.single', 'o'), comp('annotation.note', 'n')];
    const p = guideProgress(items, [wire('b', 's'), wire('s', 'l')], true, []);
    expect(p.unconnected.map((c) => c.id)).toEqual(['o']);
    expect(p.steps.wires.done).toBe(false);
    const all = guideProgress(items, [wire('b', 's'), wire('s', 'l'), wire('b', 'o')], true, []);
    expect(all.steps.wires.done).toBe(true);
    expect(firstOpenStep(all)).toBe('check');
    expect(all.steps.check.done).toBe(true);
  });
});
