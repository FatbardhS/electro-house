import { z } from 'zod';
import { CATEGORIES, type Category } from '../catalog/types.js';
import { componentType } from '../catalog/catalog.js';
import type { ComponentDto } from '../drawing/drawing.js';
import type { ProjectCostSettings } from '../reports/settings.js';
import { cableSchema, cableSummary, wireLengthUnits, type CableDto, type WireDto } from '../drawing/wires.js';

// ── Circuits ────────────────────────────────────────────────────────────

export const CIRCUIT_CATEGORIES = [
  'Lighting',
  'Sockets',
  'Kitchen',
  'Bathroom',
  'Heating',
  'Air conditioning',
  'EV charging',
  'Solar / PV',
  'Data & security',
  'Smart home',
  'Other',
] as const;
export const PHASES = ['L1', 'L2', 'L3', 'L1+L2+L3'] as const;
export const PROTECTION_TYPES = ['MCB', 'RCBO', 'Fuse'] as const;

export interface CircuitDto {
  id: string;
  projectId: string;
  number: string;
  name: string;
  category: (typeof CIRCUIT_CATEGORIES)[number];
  /** Distribution board component this circuit is fed from (any floor of the project). */
  boardComponentId: string | null;
  phase: (typeof PHASES)[number];
  voltage: number;
  protection: (typeof PROTECTION_TYPES)[number];
  breakerRatingA: number | null;
  breakerCurve: 'B' | 'C' | 'D' | null;
  /** Shared RCD group (e.g. "RCD 1") when protected by an upstream RCD, null if none. */
  rcdGroup: string | null;
  residualCurrentMa: number | null;
  cableType: string | null;
  crossSectionMm2: number | null;
  /** Manual load estimate in W used when components carry no power data (optional). */
  manualLoadW: number | null;
  description: string | null;
}

export const circuitInputSchema = z.object({
  number: z.string().trim().min(1, 'Circuit number is required.').max(20),
  name: z.string().trim().min(1, 'Circuit name is required.').max(120),
  category: z.enum(CIRCUIT_CATEGORIES),
  boardComponentId: z.uuid().nullable(),
  phase: z.enum(PHASES),
  voltage: z.number().positive().max(1000),
  protection: z.enum(PROTECTION_TYPES),
  breakerRatingA: z.number().positive().max(4000).nullable(),
  breakerCurve: z.enum(['B', 'C', 'D']).nullable(),
  rcdGroup: z.string().trim().max(40).nullable(),
  residualCurrentMa: z.number().positive().max(1000).nullable(),
  cableType: z.string().trim().max(40).nullable(),
  crossSectionMm2: z.number().positive().max(1000).nullable(),
  manualLoadW: z.number().min(0).max(10_000_000).nullable(),
  description: z.string().max(2000).nullable(),
});
export type CircuitInput = z.infer<typeof circuitInputSchema>;
export const circuitUpdateSchema = circuitInputSchema.partial();

export const DEFAULT_CIRCUIT: CircuitInput = {
  number: '1',
  name: 'New circuit',
  category: 'Lighting',
  boardComponentId: null,
  phase: 'L1',
  voltage: 230,
  protection: 'MCB',
  breakerRatingA: 10,
  breakerCurve: 'B',
  rcdGroup: 'RCD 1',
  residualCurrentMa: 30,
  cableType: 'NYM-J',
  crossSectionMm2: 1.5,
  manualLoadW: null,
  description: null,
};

// ── Vertical / inter-floor links ────────────────────────────────────────

/** A cable between components on two floors (e.g. main board → sub board, riser junction boxes). */
export interface FloorLinkDto {
  id: string;
  projectId: string;
  fromComponentId: string;
  toComponentId: string;
  /** Real cable length between the floors (vertical run plus horizontal offset), entered by the user. */
  lengthM: number;
  cable: CableDto;
  circuitId: string | null;
  description: string | null;
}

export const floorLinkInputSchema = z.object({
  fromComponentId: z.uuid(),
  toComponentId: z.uuid(),
  lengthM: z.number().positive().max(10_000),
  cable: cableSchema,
  circuitId: z.uuid().nullable(),
  description: z.string().max(2000).nullable(),
});
export type FloorLinkInput = z.infer<typeof floorLinkInputSchema>;
export const floorLinkUpdateSchema = floorLinkInputSchema.partial();

// ── Project settings: electrical rules profile ─────────────────────────

/**
 * Rules the electrician configures for their market. Nothing here is a built-in standard:
 * the app only applies the limits entered. Empty table = the cable/breaker check is not performed.
 */
export interface ElectricalProfile {
  name: string;
  /** Max breaker rating (A) allowed per copper cross-section (mm²), e.g. { "1.5": 16 }. */
  maxBreakerByCrossSection: Record<string, number>;
  /** Default power factor used to estimate current from W (1 = resistive). */
  powerFactor: number;
  /** Maximum estimated voltage drop in % at the farthest point of a circuit; null = not checked. */
  maxVoltageDropPct: number | null;
  /** Circuit categories that must be protected by an RCD (have an RCD group); empty = not checked. */
  rcdRequiredCategories: string[];
}

export const electricalProfileSchema = z.object({
  name: z.string().trim().max(80),
  maxBreakerByCrossSection: z.record(z.string().regex(/^\d+(\.\d+)?$/), z.number().positive().max(4000)),
  powerFactor: z.number().min(0.1).max(1),
  // Defaults keep profiles saved before Phase 6 valid.
  maxVoltageDropPct: z.number().positive().max(50).nullable().default(null),
  rcdRequiredCategories: z.array(z.enum(CIRCUIT_CATEGORIES)).max(CIRCUIT_CATEGORIES.length).default([]),
});

export const EMPTY_PROFILE: ElectricalProfile = {
  name: '',
  maxBreakerByCrossSection: {},
  powerFactor: 1,
  maxVoltageDropPct: null,
  rcdRequiredCategories: [],
};

/** An issue the user chose to hide (see validation checks). */
export interface IgnoredIssue {
  id: string;
  ignoredBy: string;
  ignoredAt: string;
}

export const ISSUE_ID = /^[A-Z]\d{1,2}:[A-Za-z0-9:._|-]{1,1500}$/;
export const ignoreIssueSchema = z.object({ issueId: z.string().regex(ISSUE_ID, 'Invalid issue id.') });

// ── Whole-project data used for calculations and reports ───────────────

export interface FloorInstallationDto {
  floorId: string;
  name: string;
  sortOrder: number;
  /** null when the floor is not calibrated: its wire lengths cannot be measured. */
  metresPerUnit: number | null;
  /** True when the calibration should be checked again (the plan PDF or page changed). */
  calibrationNeedsCheck: boolean;
  hasPlan: boolean;
  /** Floor-to-ceiling height, used for vertical cable drops to components. */
  ceilingHeightMm: number;
  /** Where cables run on this floor: drops go down from the ceiling or up from the floor. */
  cableRouting: CableRouting;
  components: ComponentDto[];
  wires: WireDto[];
}

export interface InstallationDto {
  projectId: string;
  floors: FloorInstallationDto[];
  circuits: CircuitDto[];
  links: FloorLinkDto[];
  profile: ElectricalProfile;
  costSettings: ProjectCostSettings;
  ignoredIssues: IgnoredIssue[];
}

export const CABLE_ROUTINGS = ['ceiling', 'floor'] as const;
export type CableRouting = (typeof CABLE_ROUTINGS)[number];
export const DEFAULT_CEILING_HEIGHT_MM = 2600;

export const floorHeightsSchema = z.object({
  ceilingHeightMm: z.number().int().min(1500, 'Ceiling height must be at least 1500 mm.').max(20_000),
  cableRouting: z.enum(CABLE_ROUTINGS),
});
export type FloorHeightsInput = z.infer<typeof floorHeightsSchema>;

// ── Calculations ────────────────────────────────────────────────────────

/** Connected power of a component in W, from whichever power field its type has (0 if none). */
export function componentPowerW(c: Pick<ComponentDto, 'properties'>): number {
  const p = c.properties;
  const num = (k: string) => (typeof p[k] === 'number' && Number.isFinite(p[k] as number) ? (p[k] as number) : 0);
  return num('powerW') || num('loadW') || num('ratedPowerKw') * 1000 || num('ratedPowerKva') * 1000;
}

export interface CircuitLoad {
  circuit: CircuitDto;
  componentCount: number;
  /** Sum of component powers (W). */
  connectedW: number;
  /** connectedW, or the circuit's manual load if no component has power data. */
  loadW: number;
  /** Estimated design current Ib in A. */
  designCurrentA: number | null;
  /** Measured cable length of wires assigned to this circuit (m), plus inter-floor links. */
  cableM: number;
  warnings: string[];
}

/** Estimated design current: single-phase I = P / (U·cosφ); three-phase I = P / (√3·U·cosφ). */
export function designCurrentA(loadW: number, voltage: number, phase: CircuitDto['phase'], powerFactor = 1): number | null {
  if (!(voltage > 0) || !(powerFactor > 0)) return null;
  return phase === 'L1+L2+L3' ? loadW / (Math.sqrt(3) * voltage * powerFactor) : loadW / (voltage * powerFactor);
}

export function circuitLoads(inst: InstallationDto): CircuitLoad[] {
  const all = inst.floors.flatMap((f) => f.components);
  const wiresByCircuit = new Map<string, number>();
  for (const f of inst.floors) {
    if (f.metresPerUnit === null) continue;
    const byId = new Map(f.components.map((c) => [c.id, c]));
    for (const w of f.wires) {
      if (!w.circuitId) continue;
      const m = wireLengthUnits(w, (id) => byId.get(id)) * f.metresPerUnit;
      wiresByCircuit.set(w.circuitId, (wiresByCircuit.get(w.circuitId) ?? 0) + m);
    }
  }
  for (const l of inst.links) {
    if (l.circuitId) wiresByCircuit.set(l.circuitId, (wiresByCircuit.get(l.circuitId) ?? 0) + l.lengthM);
  }
  return inst.circuits.map((circuit) => {
    const comps = all.filter((c) => c.circuitId === circuit.id);
    const connectedW = comps.reduce((s, c) => s + componentPowerW(c), 0);
    const loadW = connectedW > 0 ? connectedW : (circuit.manualLoadW ?? 0);
    const ib = designCurrentA(loadW, circuit.voltage, circuit.phase, inst.profile.powerFactor);
    const warnings: string[] = [];
    if (ib !== null && circuit.breakerRatingA && ib > circuit.breakerRatingA) {
      warnings.push(`Estimated current ${ib.toFixed(1)} A is above the ${circuit.breakerRatingA} A breaker.`);
    }
    const limit = circuit.crossSectionMm2 ? inst.profile.maxBreakerByCrossSection[String(circuit.crossSectionMm2)] : undefined;
    if (limit !== undefined && circuit.breakerRatingA && circuit.breakerRatingA > limit) {
      warnings.push(`${circuit.breakerRatingA} A breaker exceeds the ${limit} A limit for ${circuit.crossSectionMm2} mm² in your rules profile.`);
    }
    if (!circuit.boardComponentId) warnings.push('Not assigned to a distribution board.');
    if (comps.length === 0) warnings.push('No components assigned.');
    return {
      circuit,
      componentCount: comps.length,
      connectedW,
      loadW,
      designCurrentA: ib,
      cableM: wiresByCircuit.get(circuit.id) ?? 0,
      warnings,
    };
  });
}

export interface BoardSchedule {
  board: ComponentDto;
  floorName: string;
  circuits: CircuitLoad[];
  totalLoadW: number;
  /** Load per phase for single-phase circuits; three-phase circuits add a third to each. */
  phaseLoadW: { L1: number; L2: number; L3: number };
}

export function boardSchedules(inst: InstallationDto, loads = circuitLoads(inst)): BoardSchedule[] {
  const boards = inst.floors.flatMap((f) =>
    f.components.filter((c) => c.typeKey.startsWith('board.')).map((board) => ({ board, floorName: f.name })),
  );
  return boards.map(({ board, floorName }) => {
    const circuits = loads
      .filter((l) => l.circuit.boardComponentId === board.id)
      .sort((a, b) => a.circuit.number.localeCompare(b.circuit.number, undefined, { numeric: true }));
    const phaseLoadW = { L1: 0, L2: 0, L3: 0 };
    for (const l of circuits) {
      if (l.circuit.phase === 'L1+L2+L3') {
        phaseLoadW.L1 += l.loadW / 3;
        phaseLoadW.L2 += l.loadW / 3;
        phaseLoadW.L3 += l.loadW / 3;
      } else phaseLoadW[l.circuit.phase] += l.loadW;
    }
    return { board, floorName, circuits, totalLoadW: circuits.reduce((s, l) => s + l.loadW, 0), phaseLoadW };
  });
}

export interface CableTotal {
  key: string; // e.g. "NYM-J 3×1.5 mm²"
  measuredM: number;
  wireCount: number;
}

export interface InstallationTotals {
  componentsByCategory: Record<Category, number>;
  componentsByType: { typeKey: string; name: string; category: Category; count: number }[];
  cables: CableTotal[];
  /** Wires on floors without calibration (their length is unknown). */
  unmeasuredWires: number;
  totalMeasuredM: number;
  totalLoadW: number;
}

export function installationTotals(inst: InstallationDto): InstallationTotals {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const byType = new Map<string, number>();
  const cables = new Map<string, CableTotal>();
  let unmeasured = 0;
  let totalLoadW = 0;
  for (const f of inst.floors) {
    const byId = new Map(f.components.map((c) => [c.id, c]));
    for (const c of f.components) {
      const t = componentType(c.typeKey);
      if (t) byCategory[t.category]++;
      byType.set(c.typeKey, (byType.get(c.typeKey) ?? 0) + 1);
      totalLoadW += componentPowerW(c);
    }
    for (const w of f.wires) {
      const key = cableSummary(w.cable);
      const entry = cables.get(key) ?? { key, measuredM: 0, wireCount: 0 };
      entry.wireCount++;
      if (f.metresPerUnit === null) unmeasured++;
      else entry.measuredM += wireLengthUnits(w, (id) => byId.get(id)) * f.metresPerUnit;
      cables.set(key, entry);
    }
  }
  for (const l of inst.links) {
    const key = cableSummary(l.cable);
    const entry = cables.get(key) ?? { key, measuredM: 0, wireCount: 0 };
    entry.wireCount++;
    entry.measuredM += l.lengthM;
    cables.set(key, entry);
  }
  const cableList = [...cables.values()].sort((a, b) => b.measuredM - a.measuredM);
  return {
    componentsByCategory: byCategory,
    componentsByType: [...byType]
      .map(([typeKey, count]) => {
        const t = componentType(typeKey);
        return { typeKey, name: t?.name ?? typeKey, category: t?.category ?? 'annotation', count };
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    cables: cableList,
    unmeasuredWires: unmeasured,
    totalMeasuredM: cableList.reduce((s, c) => s + c.measuredM, 0),
    totalLoadW,
  };
}

/** Next free circuit number ("1", "2", … or keeping a letter prefix like "C3"). */
export function nextCircuitNumber(existing: readonly Pick<CircuitDto, 'number'>[]): string {
  let max = 0;
  let prefix = '';
  for (const c of existing) {
    const m = /^([A-Za-z-]*)(\d+)$/.exec(c.number);
    if (m && Number(m[2]) >= max) {
      max = Number(m[2]);
      prefix = m[1]!;
    }
  }
  return `${prefix}${max + 1}`;
}
