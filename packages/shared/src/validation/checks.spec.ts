import { describe, expect, it } from 'vitest';
import { createComponent, uuidv7, type ComponentDto } from '../drawing/drawing.js';
import { DEFAULT_CABLE, type CableDto, type WireDto } from '../drawing/wires.js';
import { DEFAULT_CIRCUIT, EMPTY_PROFILE, type CircuitDto, type FloorInstallationDto, type InstallationDto } from '../installation/installation.js';
import { EMPTY_COST_SETTINGS } from '../reports/settings.js';
import type { MaterialDto, MaterialRuleDto } from '../reports/materials.js';
import { COPPER_RESISTIVITY, applyIgnored, circuitVoltageDrops, runChecks, type CheckCode } from './checks.js';

const comp = (typeKey: string, x: number, y: number, patch: Partial<ComponentDto> = {}): ComponentDto => ({
  ...createComponent(typeKey, { x, y }, uuidv7(), []),
  mountHeightMm: null,
  ...patch,
});
const wire = (a: ComponentDto | null, b: ComponentDto | null, circuitId: string | null, cable: CableDto = DEFAULT_CABLE): WireDto => ({
  id: uuidv7(),
  label: null,
  from: { componentId: a?.id ?? null, portId: null, x: a?.x ?? 0, y: a?.y ?? 0 },
  to: { componentId: b?.id ?? null, portId: null, x: b?.x ?? 500, y: b?.y ?? 500 },
  points: [],
  cable,
  circuitId,
  description: null,
});
const circuit = (patch: Partial<CircuitDto>): CircuitDto => ({ ...DEFAULT_CIRCUIT, id: uuidv7(), projectId: 'p', rcdGroup: null, ...patch });
const floor = (patch: Partial<FloorInstallationDto>): FloorInstallationDto => ({
  floorId: uuidv7(),
  name: 'Ground floor',
  sortOrder: 0,
  metresPerUnit: 0.01,
  calibrationNeedsCheck: false,
  hasPlan: true,
  ceilingHeightMm: 2600,
  cableRouting: 'ceiling',
  components: [],
  wires: [],
  ...patch,
});
const project = (floors: FloorInstallationDto[], circuits: CircuitDto[] = [], patch: Partial<InstallationDto> = {}): InstallationDto => ({
  projectId: 'p',
  floors,
  circuits,
  links: [],
  profile: EMPTY_PROFILE,
  costSettings: EMPTY_COST_SETTINGS,
  ignoredIssues: [],
  ...patch,
});
const codes = (inst: InstallationDto) => runChecks(inst).map((i) => i.code);
const of = (inst: InstallationDto, code: CheckCode) => runChecks(inst).filter((i) => i.code === code);

/** A clean project: board → light on circuit 1, everything connected and assigned. */
function clean() {
  const board = comp('board.main', 0, 0, { label: 'MDB' });
  const c1 = circuit({ number: '1', name: 'Lights', boardComponentId: board.id, breakerRatingA: 10, crossSectionMm2: 1.5, rcdGroup: 'RCD 1' });
  const light = comp('light.ceiling', 1000, 0, { label: 'L1', circuitId: c1.id, properties: { powerW: 100 } });
  const f = floor({ components: [board, light], wires: [wire(board, light, c1.id)] });
  return { board, light, c1, f, inst: project([f], [c1]) };
}

describe('validation checks', () => {
  it('finds nothing in a clean project', () => {
    expect(runChecks(clean().inst)).toEqual([]);
  });

  it('D1/D2: unconnected components and wire ends', () => {
    const { inst, f, c1 } = clean();
    const lonely = comp('outlet.double', 300, 300, { circuitId: c1.id });
    const sensor = comp('smart.relay', 600, 600, { circuitId: c1.id });
    f.components.push(lonely, sensor);
    f.wires.push(wire(lonely, null, c1.id));
    const d1 = of(inst, 'D1');
    expect(d1.map((i) => [i.componentIds[0], i.severity])).toEqual([[sensor.id, 'info']]);
    expect(of(inst, 'D2')).toHaveLength(1);
    expect(of(inst, 'D2')[0]!.message).toContain('an unconnected end');
  });

  it('D3/D4: stacked components and duplicate labels', () => {
    const { inst, f, light } = clean();
    f.components.push({ ...light, id: uuidv7(), x: light.x + 0.5 });
    const ids = runChecks(inst);
    expect(ids.filter((i) => i.code === 'D3')).toHaveLength(1);
    expect(ids.find((i) => i.code === 'D4')?.message).toContain('“L1” is used 2 times');
  });

  it('D5: floors without a scale or needing a check', () => {
    const { inst, f } = clean();
    f.metresPerUnit = null;
    expect(of(inst, 'D5')[0]).toMatchObject({ severity: 'error' });
    f.metresPerUnit = 0.01;
    f.calibrationNeedsCheck = true;
    expect(of(inst, 'D5')[0]).toMatchObject({ severity: 'warning', id: `D5:${f.floorId}|check` });
    expect(codes(project([floor({ hasPlan: false, metresPerUnit: null })]))).not.toContain('D5');
  });

  it('C1–C4: circuit assignment and cable consistency', () => {
    const { inst, f, board, light, c1 } = clean();
    const c2 = circuit({ number: '2', name: 'Sockets', boardComponentId: board.id, crossSectionMm2: 2.5, rcdGroup: 'RCD 1' });
    inst.circuits.push(c2);
    const outlet = comp('outlet.double', 0, 800, { circuitId: c2.id });
    const loose = comp('outlet.double', 800, 800);
    f.components.push(outlet, loose);
    f.wires.push(wire(board, outlet, c2.id, { ...DEFAULT_CABLE, crossSectionMm2: 1.5 })); // C4: thinner than circuit
    f.wires.push(wire(light, loose, null)); // C2
    f.wires.push(wire(light, outlet, c1.id)); // C3 if outlet on c2 and light on c1? light is on c1 → no C3
    f.wires.push(wire(outlet, outlet, c1.id)); // C3: both ends on c2
    const r = runChecks(inst);
    expect(r.filter((i) => i.code === 'C1').map((i) => i.componentIds[0])).toEqual([loose.id]);
    expect(r.filter((i) => i.code === 'C2')).toHaveLength(1);
    expect(r.filter((i) => i.code === 'C3')).toHaveLength(1);
    expect(r.find((i) => i.code === 'C4')?.message).toContain('1.5 mm² is smaller than');
  });

  it('C5–C7, C9 and B1 from circuit data and the rules profile', () => {
    const { inst, board } = clean();
    inst.circuits.push(circuit({ number: '3', name: 'Spare', boardComponentId: null, category: 'Other' }));
    inst.circuits[0]!.breakerRatingA = 0.2; // 100 W ≈ 0.43 A > 0.2 A
    inst.profile = { ...EMPTY_PROFILE, maxBreakerByCrossSection: { '1.5': 0.1 }, rcdRequiredCategories: ['Lighting'] };
    inst.circuits[0]!.rcdGroup = null;
    const r = runChecks(inst);
    expect(r.filter((i) => i.code === 'C5').map((i) => i.id.split('|')[1]).sort()).toEqual(['board', 'empty']);
    expect(r.find((i) => i.code === 'C6')?.severity).toBe('error');
    expect(r.find((i) => i.code === 'C7')?.severity).toBe('error');
    expect(r.filter((i) => i.code === 'C9').map((i) => i.circuitId)).toEqual([inst.circuits[0]!.id]);
    expect(r[0]!.severity).toBe('error'); // sorted by severity
    expect(board).toBeTruthy();
  });

  it('B1: only for boards that use more than one phase', () => {
    const { inst, f, board } = clean();
    expect(of(inst, 'B1')).toHaveLength(0); // single-phase house
    const c2 = circuit({ number: '2', name: 'Small', boardComponentId: board.id, phase: 'L2', rcdGroup: 'RCD 1' });
    inst.circuits.push(c2);
    const small = comp('light.ceiling', 0, 900, { circuitId: c2.id, properties: { powerW: 5 } });
    f.components.push(small);
    f.wires.push(wire(board, small, c2.id));
    expect(of(inst, 'B1')[0]).toMatchObject({ severity: 'info', componentIds: [board.id] });
  });

  it('M1/M2: unpriced items and zero prices', () => {
    const { inst } = clean();
    const zero: MaterialDto = { id: 'm1', code: null, name: 'Lamp', unit: 'pcs', unitPrice: 0, packSize: null, category: null, archived: false, updatedAt: '' };
    const rules: MaterialRuleDto[] = [{ id: 'r1', target: 'component:light.ceiling', materialId: 'm1', quantity: 1, labourMinutes: 0 }];
    const r = runChecks(inst, { materials: [zero], rules });
    expect(r.filter((i) => i.code === 'M2')).toHaveLength(1);
    expect(r.filter((i) => i.code === 'M1').map((i) => i.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('Main distribution board'), expect.stringContaining('NYM-J')]),
    );
  });

  it('keeps issue ids stable and separates ignored issues', () => {
    const { inst, f } = clean();
    f.wires.push(wire(null, null, null));
    const first = runChecks(inst).map((i) => i.id);
    expect(runChecks(inst).map((i) => i.id)).toEqual(first);
    const { open, ignored, summary } = applyIgnored(runChecks(inst), [{ id: first[0]! }]);
    expect(ignored).toHaveLength(1);
    expect(open.map((i) => i.id)).not.toContain(first[0]);
    expect(summary.ignored).toBe(1);
  });
});

describe('voltage drop', () => {
  it('follows the longest branch from the board, including drops to mounting height', () => {
    const board = comp('board.main', 0, 0, { mountHeightMm: 1600 });
    const c = circuit({ boardComponentId: board.id, crossSectionMm2: 1.5, voltage: 230, phase: 'L1' });
    const a = comp('outlet.double', 1000, 0, { circuitId: c.id, mountHeightMm: 300, properties: { loadW: 2300 } });
    const b = comp('outlet.double', 3000, 0, { circuitId: c.id, mountHeightMm: 300, properties: { loadW: 0 } });
    const f = floor({ components: [board, a, b], wires: [wire(board, a, c.id), wire(a, b, c.id)] });
    const inst = project([f], [c], { profile: { ...EMPTY_PROFILE, maxVoltageDropPct: 1 } });
    const [d] = circuitVoltageDrops(inst);
    // board→a: 10 m + 1.0 m drop at board + 2.3 m at a; a→b: 20 m + 2.3 + 2.3
    expect(d!.lengthM).toBeCloseTo(10 + 1.0 + 2.3 + 20 + 2.3 + 2.3, 6);
    const expected = ((2 * d!.lengthM! * 10 * COPPER_RESISTIVITY) / (1.5 * 230)) * 100;
    expect(d!.dropPct).toBeCloseTo(expected, 6);
    expect(of(inst, 'C8')[0]!.message).toContain('above your 1 % limit');
  });

  it('reports a broken path instead of guessing', () => {
    const board = comp('board.main', 0, 0);
    const c = circuit({ boardComponentId: board.id, crossSectionMm2: 1.5 });
    const a = comp('outlet.double', 1000, 0, { circuitId: c.id, properties: { loadW: 1000 } });
    const inst = project([floor({ components: [board, a], wires: [wire(board, a, null)] })], [c], { profile: { ...EMPTY_PROFILE, maxVoltageDropPct: 3 } });
    const [d] = circuitVoltageDrops(inst);
    expect(d).toMatchObject({ lengthM: null, dropPct: null, unreachable: [a.id] });
    expect(of(inst, 'C8')[0]).toMatchObject({ severity: 'info', componentIds: [a.id] });
  });

  it('uses floor connections and three-phase formula', () => {
    const board = comp('board.main', 0, 0);
    const sub = comp('board.sub', 0, 0);
    const c = circuit({ boardComponentId: board.id, crossSectionMm2: 6, voltage: 400, phase: 'L1+L2+L3' });
    const oven = comp('outlet.three-phase', 500, 0, { circuitId: c.id, properties: { loadW: 11000 } });
    const g = floor({ components: [board] });
    const up = floor({ name: 'First floor', components: [sub, oven], wires: [wire(sub, oven, c.id)] });
    const inst = project([g, up], [c], {
      links: [{ id: 'l', projectId: 'p', fromComponentId: board.id, toComponentId: sub.id, lengthM: 8, cable: DEFAULT_CABLE, circuitId: c.id, description: null }],
    });
    const [d] = circuitVoltageDrops(inst);
    // 8 m floor connection + 5 m wire + vertical drops at the sub-board and the outlet.
    expect(d!.lengthM).toBeGreaterThan(13);
    const ib = 11000 / (Math.sqrt(3) * 400);
    expect(d!.dropPct).toBeCloseTo(((Math.sqrt(3) * d!.lengthM! * ib * COPPER_RESISTIVITY) / (6 * 400)) * 100, 6);
    expect(d!.lengthM).toBeGreaterThanOrEqual(13);
  });
});
