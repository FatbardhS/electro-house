import { describe, expect, it } from 'vitest';
import { calibratePaperScale } from '../calibration/calibration.js';
import { createComponent, uuidv7, type ComponentDto } from './drawing.js';
import {
  DEFAULT_CABLE,
  cableSummary,
  dashArray,
  detachEnds,
  distanceToPolyline,
  hitTestWire,
  syncEnds,
  wireLengthUnits,
  wireRoute,
  wireSchema,
  type WireDto,
} from './wires.js';

const comp = (typeKey: string, x: number, y: number): ComponentDto => createComponent(typeKey, { x, y }, uuidv7(), []);
const lookupOf = (list: ComponentDto[]) => {
  const m = new Map(list.map((c) => [c.id, c]));
  return (id: string) => m.get(id);
};
const wire = (from: ComponentDto | { x: number; y: number }, to: ComponentDto | { x: number; y: number }, points = [] as { x: number; y: number }[]): WireDto => ({
  id: uuidv7(),
  label: null,
  from: 'id' in from ? { componentId: from.id, portId: 'p', x: from.x, y: from.y } : { componentId: null, portId: null, ...from },
  to: 'id' in to ? { componentId: to.id, portId: 'p', x: to.x, y: to.y } : { componentId: null, portId: null, ...to },
  points,
  cable: { ...DEFAULT_CABLE },
  circuitId: null,
  description: null,
});

describe('wire geometry', () => {
  const sw = comp('switch.single', 0, 0);
  const lamp = comp('light.ceiling', 300, 400);
  const lookup = lookupOf([sw, lamp]);

  it('routes from port to port through bend points and measures the length', () => {
    const w = wire(sw, lamp, [{ x: 0, y: 400 }]);
    expect(wireRoute(w, lookup)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 400 }, { x: 300, y: 400 }]);
    expect(wireLengthUnits(w, lookup)).toBe(700);
    const cal = calibratePaperScale(50);
    expect(wireLengthUnits(w, lookup) * cal.metresPerUnit).toBeCloseTo(12.347, 3);
  });

  it('follows components when they move (ends are derived, not stored)', () => {
    const w = wire(sw, lamp);
    const moved = { ...lamp, x: 600 };
    const l2 = lookupOf([sw, moved]);
    expect(wireRoute(w, l2).at(-1)).toEqual({ x: 600, y: 400 });
    expect(wireLengthUnits(w, l2)).toBeCloseTo(Math.hypot(600, 400), 9);
    expect(syncEnds(w, l2).to).toMatchObject({ componentId: lamp.id, x: 600, y: 400 });
  });

  it('detaches ends from deleted components at their last position', () => {
    const w = wire(sw, lamp);
    const d = detachEnds(w, new Set([lamp.id]), lookup);
    expect(d.to).toEqual({ componentId: null, portId: null, x: 300, y: 400 });
    expect(d.from.componentId).toBe(sw.id);
  });

  it('hit-tests wires by distance to their segments', () => {
    const w = wire({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(hitTestWire([w], { x: 50, y: 3 }, 4, lookup)?.id).toBe(w.id);
    expect(hitTestWire([w], { x: 50, y: 6 }, 4, lookup)).toBeNull();
    expect(distanceToPolyline({ x: 120, y: 0 }, [{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe(20);
  });

  it('validates wire data and describes cables', () => {
    const w = wire(sw, lamp);
    expect(wireSchema.safeParse(w).success).toBe(true);
    expect(wireSchema.safeParse({ ...w, cable: { ...w.cable, color: 'red' } }).success).toBe(false);
    expect(wireSchema.safeParse({ ...w, cable: { ...w.cable, conductors: 0 } }).success).toBe(false);
    expect(cableSummary(DEFAULT_CABLE)).toBe('NYM-J 3×1.5 mm²');
    expect(dashArray('solid')).toBeNull();
    expect(dashArray('dashed')).toMatch(/^\d/);
  });
});
