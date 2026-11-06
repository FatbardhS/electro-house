import { describe, expect, it } from 'vitest';
import { createComponent, uuidv7, type ComponentDto } from '../drawing/drawing.js';
import { DEFAULT_CABLE, type CableDto, type WireDto } from '../drawing/wires.js';
import { DEFAULT_CIRCUIT, EMPTY_PROFILE, type InstallationDto } from '../installation/installation.js';
import { parseSvgPath } from '../geometry/svg-path.js';
import { buildBom, costSummary, dropM, groupTakeoff, roundMoney, takeoff } from './bom.js';
import {
  cableTarget,
  materialsFromCsv,
  materialsToCsv,
  parseCsv,
  parseDecimal,
  rulesForCable,
  targetLabel,
  type MaterialDto,
  type MaterialRuleDto,
} from './materials.js';
import {
  DEFAULT_COST_NOTE,
  DEFAULT_ORGANIZATION_SETTINGS,
  EMPTY_COST_SETTINGS,
  effectiveCostSettings,
  readOrganizationSettings,
  type Allowances,
} from './settings.js';

const ALLOW: Allowances = { wastePct: 10, endReserveM: 0.2, boardTailM: 0.5 };

const comp = (typeKey: string, x: number, y: number, mountHeightMm: number | null = null, circuitId: string | null = null): ComponentDto => ({
  ...createComponent(typeKey, { x, y }, uuidv7(), []),
  mountHeightMm,
  circuitId,
});
const wire = (a: ComponentDto, b: ComponentDto, cable: CableDto = DEFAULT_CABLE, circuitId: string | null = null): WireDto => ({
  id: uuidv7(),
  label: null,
  from: { componentId: a.id, portId: null, x: a.x, y: a.y },
  to: { componentId: b.id, portId: null, x: b.x, y: b.y },
  points: [],
  cable,
  circuitId,
  description: null,
});
const material = (patch: Partial<MaterialDto>): MaterialDto => ({
  id: uuidv7(),
  code: null,
  name: 'Item',
  unit: 'pcs',
  unitPrice: 1,
  packSize: null,
  category: null,
  archived: false,
  updatedAt: '',
  ...patch,
});
const rule = (target: string, materialId: string, quantity = 1, labourMinutes = 0): MaterialRuleDto => ({
  id: uuidv7(),
  target,
  materialId,
  quantity,
  labourMinutes,
});

/**
 * Ground floor (calibrated, 0.01 m/unit, ceiling 2600): board at 1500 mm, outlet at 300 mm, ceiling light (no height).
 * Wires: board→outlet 1000 units (10 m), outlet→light 500 units (5 m). First floor: uncalibrated, one wire.
 */
function sample(): { inst: InstallationDto; board: ComponentDto; outlet: ComponentDto; light: ComponentDto; circuitId: string } {
  const circuitId = uuidv7();
  const board = comp('board.main', 0, 0, 1500);
  const outlet = comp('outlet.double', 1000, 0, 300, circuitId);
  const light = comp('light.ceiling', 1000, 500, null, circuitId);
  const up1 = comp('outlet.double', 0, 0, 300);
  const up2 = comp('outlet.double', 100, 0, 300);
  const note = comp('annotation.note', 50, 50);
  const inst: InstallationDto = {
    projectId: 'p',
    floors: [
      {
        floorId: 'g',
        name: 'Ground floor',
        sortOrder: 0,
        metresPerUnit: 0.01,
        ceilingHeightMm: 2600,
        cableRouting: 'ceiling',
        calibrationNeedsCheck: false,
        hasPlan: true,
        components: [board, outlet, light, note],
        wires: [wire(board, outlet, DEFAULT_CABLE, circuitId), wire(outlet, light, DEFAULT_CABLE, circuitId)],
      },
      {
        floorId: 'f',
        name: 'First floor',
        sortOrder: 1,
        metresPerUnit: null,
        ceilingHeightMm: 2600,
        cableRouting: 'ceiling',
        calibrationNeedsCheck: false,
        hasPlan: true,
        components: [up1, up2],
        wires: [wire(up1, up2)],
      },
    ],
    circuits: [{ ...DEFAULT_CIRCUIT, id: circuitId, projectId: 'p', number: '1', name: 'Sockets' }],
    links: [
      {
        id: uuidv7(),
        projectId: 'p',
        fromComponentId: board.id,
        toComponentId: up1.id,
        lengthM: 6,
        cable: { ...DEFAULT_CABLE, conductors: 5, crossSectionMm2: 6 },
        circuitId: null,
        description: null,
      },
    ],
    profile: EMPTY_PROFILE,
    costSettings: EMPTY_COST_SETTINGS,
    ignoredIssues: [],
  };
  return { inst, board, outlet, light, circuitId };
}

describe('cable allowances', () => {
  it('computes drops from the routing level to the mounting height', () => {
    const c = comp('outlet.double', 0, 0, 300);
    expect(dropM(c, { ceilingHeightMm: 2600, cableRouting: 'ceiling' })).toBeCloseTo(2.3);
    expect(dropM(c, { ceilingHeightMm: 2600, cableRouting: 'floor' })).toBeCloseTo(0.3);
    expect(dropM(comp('light.ceiling', 0, 0, null), { ceilingHeightMm: 2600, cableRouting: 'ceiling' })).toBe(0);
  });

  it('keeps measured, drops, terminations and waste separate', () => {
    const { inst } = sample();
    const bom = buildBom(takeoff(inst, ALLOW), [], [], { allowances: ALLOW, roundToPacks: false });
    const nym = bom.cables.find((c) => c.key === 'NYM-J 3×1.5 mm²')!;
    expect(nym.runs).toBe(3);
    expect(nym.unknownRuns).toBe(1); // first floor is not calibrated
    expect(nym.measuredM).toBeCloseTo(15);
    // board(1.1) + outlet(2.3) for wire 1, outlet(2.3) + light(0) for wire 2
    expect(nym.dropsM).toBeCloseTo(5.7);
    // board tail 0.5 + 3 × end reserve 0.2
    expect(nym.terminationsM).toBeCloseTo(1.1);
    expect(nym.wasteM).toBeCloseTo((15 + 5.7 + 1.1) * 0.1);
    expect(nym.totalM).toBeCloseTo((15 + 5.7 + 1.1) * 1.1);
    expect(bom.unknownRuns).toBe(1);
  });

  it('uses the entered floor-connection length without drops', () => {
    const { inst } = sample();
    const bom = buildBom(takeoff(inst, ALLOW), [], [], { allowances: ALLOW, roundToPacks: false });
    const feed = bom.cables.find((c) => c.key === 'NYM-J 5×6 mm²')!;
    expect(feed.measuredM).toBe(6);
    expect(feed.dropsM).toBe(0);
    expect(feed.terminationsM).toBeCloseTo(0.7);
  });

  it('does not count annotations as material', () => {
    const { inst } = sample();
    const bom = buildBom(takeoff(inst, ALLOW), [], [], { allowances: ALLOW, roundToPacks: false });
    expect(bom.components.some((c) => c.typeKey.startsWith('annotation.'))).toBe(false);
    expect(bom.components.find((c) => c.typeKey === 'outlet.double')?.count).toBe(3);
  });
});

describe('material rules', () => {
  const nym315: CableDto = { ...DEFAULT_CABLE };

  it('prefers the most specific cable rule and applies all rules of that target', () => {
    const rules = [
      rule('cable:NYM-J|*|*', 'any-nym'),
      rule('cable:NYM-J|3|1.5', 'exact'),
      rule('cable:NYM-J|3|1.5', 'conduit'),
      rule('cable:*|*|1.5', 'any-15'),
    ];
    expect(rulesForCable(nym315, rules).map((r) => r.materialId)).toEqual(['exact', 'conduit']);
    expect(rulesForCable({ ...nym315, crossSectionMm2: 2.5 }, rules).map((r) => r.materialId)).toEqual(['any-nym']);
    expect(rulesForCable({ ...nym315, cableType: 'NYY-J' }, rules).map((r) => r.materialId)).toEqual(['any-15']);
    expect(rulesForCable({ ...nym315, cableType: 'Cat6', crossSectionMm2: undefined }, rules)).toEqual([]);
  });

  it('builds readable target names', () => {
    expect(targetLabel('component:outlet.double')).toBe('Double outlet');
    expect(targetLabel(cableTarget(nym315))).toBe('NYM-J 3×1.5 mm²');
    expect(targetLabel('cable:NYM-J|*|*')).toBe('NYM-J (any size)');
  });

  it('prices lines, rounds to packs and reports unmapped items', () => {
    const { inst } = sample();
    const box = material({ name: 'Box', unitPrice: 0.5 });
    const outlet = material({ name: 'Outlet', unitPrice: 8 });
    const cable = material({ name: 'NYM', unit: 'm', unitPrice: 0.6, packSize: 50 });
    const rules = [
      rule('component:outlet.double', box.id, 1, 10),
      rule('component:outlet.double', outlet.id, 1, 5),
      rule('cable:NYM-J|3|1.5', cable.id, 1, 1),
    ];
    const t = takeoff(inst, ALLOW);
    const bom = buildBom(t, [box, outlet, cable], rules, { allowances: ALLOW, roundToPacks: true });
    const cableLine = bom.lines.find((l) => l.material.id === cable.id)!;
    expect(cableLine.quantity).toBeCloseTo(23.98);
    expect(cableLine.packs).toBe(1);
    expect(cableLine.orderQuantity).toBe(50);
    expect(cableLine.total).toBe(30);
    expect(bom.lines.find((l) => l.material.id === box.id)!.total).toBe(1.5);
    expect(bom.materialsNet).toBe(roundMoney(30 + 1.5 + 24));
    expect(bom.labourMinutes).toBeCloseTo(3 * 15 + 23.98);
    expect(bom.unmapped.map((u) => u.label).sort()).toEqual(['Ceiling light', 'Main distribution board', 'NYM-J 5×6 mm²']);
  });
});

describe('grouping', () => {
  it('splits by floor with a between-floors group', () => {
    const { inst } = sample();
    const groups = groupTakeoff(takeoff(inst, ALLOW), inst, 'floor');
    expect(groups.map((g) => g.name)).toEqual(['Ground floor', 'First floor', 'Between floors']);
    expect(groups[2]!.takeoff.components).toHaveLength(0);
  });

  it('splits by circuit with an unassigned group', () => {
    const { inst } = sample();
    const groups = groupTakeoff(takeoff(inst, ALLOW), inst, 'circuit');
    expect(groups.map((g) => g.name)).toEqual(['1 · Sockets', 'Not assigned to a circuit']);
    expect(groups[0]!.takeoff.runs).toHaveLength(2);
  });
});

describe('cost summary', () => {
  it('applies markup on materials, labour, extras and VAT', () => {
    const { inst } = sample();
    const m = material({ unitPrice: 10 });
    const bom = buildBom(takeoff(inst, ALLOW), [m], [rule('component:outlet.double', m.id, 1, 20)], { allowances: ALLOW, roundToPacks: false });
    const org = { ...DEFAULT_ORGANIZATION_SETTINGS, markupPct: 10, vatPct: 20, hourlyRate: 40 };
    const project = { ...EMPTY_COST_SETTINGS, extraHours: 2, extraLines: [{ text: 'Testing', amount: 50 }], vatPct: 18 };
    const s = costSummary(bom, effectiveCostSettings(org, project), project);
    expect(s.materialsNet).toBe(30);
    expect(s.markup).toBe(3);
    expect(s.ruleHours).toBe(1);
    expect(s.labour).toBe(120);
    expect(s.net).toBe(203);
    expect(s.vatPct).toBe(18);
    expect(s.vat).toBe(36.54);
    expect(s.gross).toBe(239.54);
    expect(s.note).toBe(DEFAULT_COST_NOTE);
  });

  it('reads stored settings leniently', () => {
    expect(readOrganizationSettings(null)).toEqual(DEFAULT_ORGANIZATION_SETTINGS);
    expect(readOrganizationSettings({ currency: 'CHF', allowances: { wastePct: 8 } }).allowances).toEqual({
      ...DEFAULT_ORGANIZATION_SETTINGS.allowances,
      wastePct: 8,
    });
  });
});

describe('CSV', () => {
  it('parses quoted fields and detects the delimiter', () => {
    expect(parseCsv('a;b\n"x;1";"say ""hi"""\r\n')).toEqual([['a', 'b'], ['x;1', 'say "hi"']]);
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('parses decimals in both conventions', () => {
    expect(parseDecimal('12,50')).toBe(12.5);
    expect(parseDecimal('1.234,50')).toBe(1234.5);
    expect(parseDecimal('1,234.50')).toBe(1234.5);
    expect(parseDecimal('abc')).toBeNaN();
  });

  it('imports a price list and reports bad rows with line numbers', () => {
    const csv = 'Code;Name;Unit;Price;Pack size\nA1;Flush box;pcs;0,45;\nA2;NYM-J 3×1.5;m;0,62;100\nA3;Broken;pcs;n/a;\nA1;Duplicate;pcs;1;';
    const r = materialsFromCsv(csv);
    expect(r.rows.map((x) => x.input.name)).toEqual(['Flush box', 'NYM-J 3×1.5']);
    expect(r.rows[1]!.input.packSize).toBe(100);
    expect(r.errors.map((e) => e.line)).toEqual([4, 5]);
    expect(materialsFromCsv('name;price\nx;1').errors[0]!.message).toContain('unit');
  });

  it('round-trips through export', () => {
    const list = [material({ code: 'X', name: 'Box, deep', unitPrice: 0.45, packSize: 10, category: 'Boxes' })];
    const back = materialsFromCsv(materialsToCsv(list));
    expect(back.errors).toEqual([]);
    expect(back.rows[0]!.input).toMatchObject({ code: 'X', name: 'Box, deep', unitPrice: 0.45, packSize: 10, category: 'Boxes' });
  });
});

describe('SVG path parsing', () => {
  it('converts H/V/Z and relative commands to absolute segments', () => {
    expect(parseSvgPath('M -1 -1 H 1 V 1 h -2 Z')).toEqual([
      { op: 'M', to: { x: -1, y: -1 } },
      { op: 'L', to: { x: 1, y: -1 } },
      { op: 'L', to: { x: 1, y: 1 } },
      { op: 'L', to: { x: -1, y: 1 } },
      { op: 'Z' },
    ]);
  });

  it('turns a half-circle arc into Béziers that end on the arc', () => {
    const segs = parseSvgPath('M -2 0 A 2 2 0 0 1 2 0');
    expect(segs).toHaveLength(3);
    const last = segs[2]!;
    expect(last.op).toBe('C');
    if (last.op === 'C') expect(last.to).toEqual({ x: 2, y: 0 });
    const mid = segs[1]!;
    if (mid.op === 'C') {
      expect(Math.hypot(mid.to.x, mid.to.y)).toBeCloseTo(2);
      expect(mid.to.y).toBeLessThan(0); // sweep=1 in y-down space goes through the top
    }
  });
});
