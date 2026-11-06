import { describe, expect, it } from 'vitest';
import { createComponent, uuidv7, type ComponentDto } from '../drawing/drawing.js';
import { DEFAULT_CABLE, type WireDto } from '../drawing/wires.js';
import { EMPTY_COST_SETTINGS } from '../reports/settings.js';
import {
  DEFAULT_CIRCUIT,
  EMPTY_PROFILE,
  boardSchedules,
  circuitLoads,
  componentPowerW,
  designCurrentA,
  installationTotals,
  nextCircuitNumber,
  type CircuitDto,
  type InstallationDto,
} from './installation.js';

const comp = (typeKey: string, x: number, y: number, props: Record<string, unknown> = {}, circuitId: string | null = null): ComponentDto => {
  const c = createComponent(typeKey, { x, y }, uuidv7(), []);
  return { ...c, properties: { ...c.properties, ...props }, circuitId };
};
const circuit = (patch: Partial<CircuitDto>): CircuitDto => ({ ...DEFAULT_CIRCUIT, id: uuidv7(), projectId: 'p', ...patch });
const wire = (a: ComponentDto, b: ComponentDto, circuitId: string | null, cable = DEFAULT_CABLE): WireDto => ({
  id: uuidv7(),
  label: null,
  from: { componentId: a.id, portId: 'p', x: a.x, y: a.y },
  to: { componentId: b.id, portId: 'p', x: b.x, y: b.y },
  points: [],
  cable,
  circuitId,
  description: null,
});

function sample(): InstallationDto {
  const board = comp('board.main', 0, 0);
  const lighting = circuit({ number: '1', name: 'Lights', boardComponentId: board.id, breakerRatingA: 10, crossSectionMm2: 1.5 });
  const kitchen = circuit({ number: '2', name: 'Oven', phase: 'L1+L2+L3', voltage: 400, boardComponentId: board.id, breakerRatingA: 16, crossSectionMm2: 2.5, category: 'Kitchen' });
  const unassigned = circuit({ number: '3', name: 'Spare', boardComponentId: null, manualLoadW: 500, phase: 'L2' });
  const l1 = comp('light.ceiling', 100, 0, { powerW: 60 }, lighting.id);
  const l2 = comp('light.ceiling', 100, 100, { powerW: 40 }, lighting.id);
  const sw = comp('switch.single', 0, 100, {}, lighting.id);
  const oven = comp('outlet.three-phase', 200, 0, { loadW: 7000 }, kitchen.id);
  const upstairsLamp = comp('light.wall', 0, 0, { powerW: 2500 }, lighting.id);
  return {
    projectId: 'p',
    floors: [
      { floorId: 'g', name: 'Ground floor', sortOrder: 0, metresPerUnit: 0.01, ceilingHeightMm: 2600, cableRouting: 'ceiling', components: [board, l1, l2, sw, oven], wires: [wire(board, l1, lighting.id), wire(l1, l2, lighting.id), wire(board, oven, kitchen.id, { ...DEFAULT_CABLE, conductors: 5, crossSectionMm2: 2.5 })] },
      { floorId: 'f', name: 'First floor', sortOrder: 1, metresPerUnit: null, ceilingHeightMm: 2600, cableRouting: 'ceiling', components: [upstairsLamp], wires: [wire(upstairsLamp, upstairsLamp, null)] },
    ],
    circuits: [lighting, kitchen, unassigned],
    links: [{ id: uuidv7(), projectId: 'p', fromComponentId: board.id, toComponentId: upstairsLamp.id, lengthM: 4.5, cable: { ...DEFAULT_CABLE }, circuitId: lighting.id, description: null }],
    profile: { ...EMPTY_PROFILE, maxBreakerByCrossSection: { '1.5': 16, '2.5': 20 } },
    costSettings: EMPTY_COST_SETTINGS,
  };
}

describe('loads and currents', () => {
  it('reads power from whichever field the component type uses', () => {
    expect(componentPowerW({ properties: { powerW: 12 } })).toBe(12);
    expect(componentPowerW({ properties: { loadW: 2000 } })).toBe(2000);
    expect(componentPowerW({ properties: { ratedPowerKw: 11 } })).toBe(11000);
    expect(componentPowerW({ properties: {} })).toBe(0);
  });

  it('estimates design current for single and three phase', () => {
    expect(designCurrentA(2300, 230, 'L1')).toBeCloseTo(10, 9);
    expect(designCurrentA(6928.2, 400, 'L1+L2+L3')).toBeCloseTo(10, 3);
    expect(designCurrentA(2300, 230, 'L1', 0.5)).toBeCloseTo(20, 9);
  });

  it('sums circuit loads across floors, measures cable, and warns about overloads and missing boards', () => {
    const loads = circuitLoads(sample());
    const [lights, oven, spare] = loads;
    expect(lights!.componentCount).toBe(4);
    expect(lights!.connectedW).toBe(2600);
    expect(lights!.designCurrentA).toBeCloseTo(11.3, 1);
    expect(lights!.warnings.join(' ')).toMatch(/above the 10 A breaker/);
    // board→l1 (100 units) + l1→l2 (100 units) at 0.01 m/unit + 4.5 m inter-floor link
    expect(lights!.cableM).toBeCloseTo(6.5, 9);
    expect(oven!.designCurrentA).toBeCloseTo(10.1, 1);
    expect(oven!.warnings).toEqual([]);
    expect(spare!.loadW).toBe(500); // manual estimate when no component carries power
    expect(spare!.warnings).toEqual(expect.arrayContaining(['Not assigned to a distribution board.', 'No components assigned.']));
  });

  it('checks breaker size only against the limits configured in the rules profile', () => {
    const inst = sample();
    inst.circuits[0] = { ...inst.circuits[0]!, breakerRatingA: 20, crossSectionMm2: 1.5 };
    expect(circuitLoads(inst)[0]!.warnings.join(' ')).toMatch(/exceeds the 16 A limit for 1.5 mm²/);
    inst.profile = EMPTY_PROFILE;
    expect(circuitLoads(inst)[0]!.warnings.join(' ')).not.toMatch(/limit/);
  });

  it('builds board schedules with circuits in number order and per-phase load', () => {
    const [s] = boardSchedules(sample());
    expect(s!.circuits.map((c) => c.circuit.number)).toEqual(['1', '2']);
    expect(s!.totalLoadW).toBe(2600 + 7000);
    expect(s!.phaseLoadW.L1).toBeCloseTo(2600 + 7000 / 3, 6);
    expect(s!.phaseLoadW.L3).toBeCloseTo(7000 / 3, 6);
  });
});

describe('installation totals', () => {
  it('counts components and totals cable by type and cross-section, flagging uncalibrated floors', () => {
    const t = installationTotals(sample());
    expect(t.componentsByCategory.lighting).toBe(3);
    expect(t.componentsByCategory.distribution).toBe(1);
    expect(t.componentsByType.find((x) => x.typeKey === 'light.ceiling')?.count).toBe(2);
    const nym = t.cables.find((c) => c.key === 'NYM-J 3×1.5 mm²')!;
    expect(nym.measuredM).toBeCloseTo(1 + 1 + 4.5, 9); // two wires + link; the uncalibrated wire adds no length
    expect(t.cables.find((c) => c.key === 'NYM-J 5×2.5 mm²')?.measuredM).toBeCloseTo(2, 9);
    expect(t.unmeasuredWires).toBe(1);
    expect(t.totalLoadW).toBe(60 + 40 + 7000 + 2500);
  });

  it('suggests the next circuit number', () => {
    expect(nextCircuitNumber([])).toBe('1');
    expect(nextCircuitNumber([{ number: '1' }, { number: '7' }, { number: 'X' }])).toBe('8');
    expect(nextCircuitNumber([{ number: 'C2' }, { number: 'C10' }])).toBe('C11');
  });
});
