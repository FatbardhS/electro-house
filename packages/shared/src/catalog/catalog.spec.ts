import { describe, expect, it } from 'vitest';
import { CATEGORIES, LAYER_KEYS } from './types.js';
import { COMPONENT_TYPES, componentType, propertiesSchema, searchCatalog } from './catalog.js';
import {
  createComponent,
  drawingPatchSchema,
  hitRadius,
  hitTest,
  insideRect,
  nextLabel,
  normalizeDegrees,
  snapToStep,
  uuidv7,
  validateComponent,
} from '../drawing/drawing.js';

describe('component catalog', () => {
  it('has unique, stable keys and covers every category from the brief', () => {
    const keys = COMPONENT_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const cat of CATEGORIES) expect(COMPONENT_TYPES.some((t) => t.category === cat)).toBe(true);
    expect(COMPONENT_TYPES.length).toBeGreaterThanOrEqual(55);
  });

  it('every type has a drawable symbol, a valid layer, ports and valid defaults', () => {
    for (const t of COMPONENT_TYPES) {
      expect(t.symbol.primitives.length, t.key).toBeGreaterThan(0);
      expect(t.symbol.hitRadiusMm, t.key).toBeGreaterThan(0);
      expect(LAYER_KEYS).toContain(t.defaultLayer);
      expect(t.ports.length, t.key).toBeGreaterThan(0);
      expect(t.labelPrefix, t.key).toMatch(/^[A-Z]{1,4}$/);
      const parsed = propertiesSchema(t).safeParse(t.defaults);
      expect(parsed.success, `${t.key} defaults: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      for (const p of t.symbol.primitives) {
        if (p.kind === 'path') expect(p.d, t.key).toMatch(/^M /);
      }
    }
  });

  it('finds components by name and keyword', () => {
    expect(searchCatalog('double').map((t) => t.key)).toContain('outlet.double');
    expect(searchCatalog('wallbox').map((t) => t.key)).toEqual(['energy.ev-charger']);
    expect(searchCatalog('')).toHaveLength(COMPONENT_TYPES.length);
  });

  it('validates properties against the type', () => {
    const t = componentType('dist.rcbo')!;
    expect(propertiesSchema(t).safeParse({ curve: 'C', ratedCurrentA: 20 }).success).toBe(true);
    expect(propertiesSchema(t).safeParse({ curve: 'X' }).success).toBe(false);
    expect(propertiesSchema(t).safeParse({ ratedCurrentA: -1 }).success).toBe(false);
  });
});

describe('drawing helpers', () => {
  const comp = (id: string, x: number, y: number, typeKey = 'switch.single', label: string | null = null) => ({
    ...createComponent(typeKey, { x, y }, id, []),
    label,
  });

  it('creates components with type defaults and sequential labels', () => {
    const existing = [{ label: 'S1' }, { label: 'S3' }, { label: 'L9' }, { label: null }];
    const c = createComponent('switch.double', { x: 10, y: 20 }, uuidv7(), existing);
    expect(c).toMatchObject({ label: 'S4', layerKey: 'switches', mountHeightMm: 1050, rotation: 0 });
    expect(nextLabel('MDB', [])).toBe('MDB1');
    expect(nextLabel('L', [{ label: 'LS2' }, { label: 'L2' }])).toBe('L3');
  });

  it('hit-tests the topmost component within its symbol radius', () => {
    const a = comp('a', 100, 100);
    const b = comp('b', 103, 100);
    const r = hitRadius(a);
    expect(hitTest([a, b], { x: 101, y: 100 })?.id).toBe('b'); // b drawn last
    expect(hitTest([a, b], { x: 100 - r + 0.1, y: 100 })?.id).toBe('a');
    expect(hitTest([a, b], { x: 100, y: 100 + r + 5 })).toBeNull();
  });

  it('box-selects regardless of drag direction', () => {
    const list = [comp('a', 10, 10), comp('b', 50, 50), comp('c', 90, 10)];
    expect(insideRect(list, { x: 60, y: 60 }, { x: 0, y: 0 }).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('snaps to the grid and normalises rotation', () => {
    expect(snapToStep({ x: 14.9, y: -14.9 }, 10)).toEqual({ x: 10, y: -10 });
    expect(snapToStep({ x: 3, y: 4 }, 0)).toEqual({ x: 3, y: 4 });
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(720)).toBe(0);
  });

  it('generates RFC 9562 version-7 UUIDs in time order', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it('rejects unknown types and invalid properties, normalises valid ones', () => {
    const c = comp(uuidv7(), 1, 2, 'light.ceiling');
    expect(validateComponent({ ...c, typeKey: 'nope' })).toEqual({ ok: false, error: 'Unknown component type "nope".' });
    expect(validateComponent({ ...c, properties: { powerW: -5 } }).ok).toBe(false);
    const ok = validateComponent({ ...c, rotation: -90, properties: { powerW: 12, junk: 1 } });
    expect(ok.ok && ok.value.rotation).toBe(270);
    expect(ok.ok && ok.value.properties).toEqual({ powerW: 12 });
  });

  it('limits and validates drawing patches', () => {
    expect(drawingPatchSchema.safeParse({ baseRevision: 0, ops: [] }).success).toBe(false);
    expect(drawingPatchSchema.safeParse({ baseRevision: 0, ops: [{ op: 'delete', id: 'x' }] }).success).toBe(false);
    expect(
      drawingPatchSchema.safeParse({ baseRevision: 0, ops: [{ op: 'layer', key: 'lighting', visible: false }] }).success,
    ).toBe(true);
  });
});

describe('relabelCopies', () => {
  it('gives copies the next free automatic label and keeps custom labels', async () => {
    const { relabelCopies, createComponent, uuidv7 } = await import('../drawing/drawing.js');
    const a = { ...createComponent('light.ceiling', { x: 0, y: 0 }, uuidv7(), []), label: 'L1' };
    const b = { ...createComponent('light.ceiling', { x: 0, y: 0 }, uuidv7(), []), label: 'L2' };
    const custom = { ...createComponent('light.ceiling', { x: 0, y: 0 }, uuidv7(), []), label: 'Kitchen pendant' };
    const out = relabelCopies([a, b, custom], [{ label: 'L1' }, { label: 'L2' }, { label: 'L3' }]);
    expect(out.map((c) => c.label)).toEqual(['L4', 'L5', 'Kitchen pendant']);
  });
});
