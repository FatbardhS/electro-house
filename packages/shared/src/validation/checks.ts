import { MM_TO_PT, componentType } from '../catalog/catalog.js';
import type { ComponentDto } from '../drawing/drawing.js';
import { wireLengthUnits } from '../drawing/wires.js';
import {
  boardSchedules,
  circuitLoads,
  type CircuitDto,
  type CircuitLoad,
  type FloorInstallationDto,
  type InstallationDto,
} from '../installation/installation.js';
import { buildBom, dropM, takeoff } from '../reports/bom.js';
import type { MaterialDto, MaterialRuleDto } from '../reports/materials.js';
import { DEFAULT_ORGANIZATION_SETTINGS } from '../reports/settings.js';

/**
 * Validation checks over a whole project. Pure functions on data the app already has, so the editor, the project
 * page and the PDF show identical results. Nothing here claims compliance with a standard: limit checks only use
 * values the electrician entered in the rules profile.
 */

export type Severity = 'error' | 'warning' | 'info';

export const CHECKS = {
  D1: 'Component without a wire',
  D2: 'Wire with an unconnected end',
  D3: 'Components on top of each other',
  D4: 'Label used more than once',
  D5: 'Floor scale',
  C1: 'Component not on a circuit',
  C2: 'Wire not on a circuit',
  C3: 'Wire on a different circuit',
  C4: 'Cable does not match the circuit',
  C5: 'Incomplete circuit',
  C6: 'Current above breaker rating',
  C7: 'Breaker above cable limit',
  C8: 'Voltage drop',
  C9: 'RCD protection missing',
  B1: 'Unbalanced phases',
  M1: 'Not priced (no material rule)',
  M2: 'Material with price 0',
} as const;
export type CheckCode = keyof typeof CHECKS;

export interface Issue {
  /** Stable: the check code plus the ids it points at. Used to ignore an issue. */
  id: string;
  code: CheckCode;
  severity: Severity;
  message: string;
  /** Floor to show it on; null for project-wide issues. */
  floorId: string | null;
  componentIds: string[];
  wireIds: string[];
  circuitId: string | null;
}

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Copper resistivity at operating temperature, Ω·mm²/m. */
export const COPPER_RESISTIVITY = 0.0225;
/** Components closer than this (paper mm on the plan) are treated as stacked. */
const STACK_DISTANCE = 1 * MM_TO_PT;
const IMBALANCE_LIMIT = 0.2;

const isAnnotation = (c: ComponentDto) => c.typeKey.startsWith('annotation.');
const isBoard = (c: ComponentDto) => c.typeKey.startsWith('board.');
const categoryOf = (c: ComponentDto) => componentType(c.typeKey)?.category;
const nameOf = (c: ComponentDto) => `${c.label ? `${c.label} ` : ''}(${componentType(c.typeKey)?.name ?? c.typeKey})`;
const circuitName = (c: CircuitDto) => `${c.number} ${c.name}`;
const wireName = (w: { label: string | null }) => (w.label ? `Wire ${w.label}` : 'A wire');

// ── Voltage drop ────────────────────────────────────────────────────────

export interface VoltageDrop {
  circuitId: string;
  /** Longest cable path from the board to a component of the circuit, metres (null if it cannot be followed). */
  lengthM: number | null;
  dropPct: number | null;
  /** Components of the circuit that the cable path does not reach from the board. */
  unreachable: string[];
  /** Why the path could not be followed, if so. */
  problem: string | null;
}

/**
 * Follows the circuit's wires (and floor connections) from its board with Dijkstra, including the vertical drops
 * at each connected end, and estimates ΔU% at the farthest component:
 * single-phase 2·L·I·ρ/(S·U)·100, three-phase √3·L·I·ρ/(S·U)·100.
 */
export function circuitVoltageDrops(inst: InstallationDto, loads: CircuitLoad[] = circuitLoads(inst)): VoltageDrop[] {
  const floorOf = new Map<string, FloorInstallationDto>();
  const byId = new Map<string, ComponentDto>();
  for (const f of inst.floors) for (const c of f.components) (floorOf.set(c.id, f), byId.set(c.id, c));

  return loads.map(({ circuit, designCurrentA }) => {
    const result = (lengthM: number | null, unreachable: string[], problem: string | null): VoltageDrop => {
      let dropPct: number | null = null;
      if (lengthM !== null && designCurrentA !== null && circuit.crossSectionMm2 && circuit.voltage > 0) {
        const k = circuit.phase === 'L1+L2+L3' ? Math.sqrt(3) : 2;
        dropPct = ((k * lengthM * designCurrentA * COPPER_RESISTIVITY) / (circuit.crossSectionMm2 * circuit.voltage)) * 100;
      }
      return { circuitId: circuit.id, lengthM, dropPct, unreachable, problem };
    };
    const members = [...byId.values()].filter((c) => c.circuitId === circuit.id).map((c) => c.id);
    if (!circuit.boardComponentId || !byId.has(circuit.boardComponentId)) return result(null, members, 'The circuit has no distribution board.');
    if (members.length === 0) return result(null, [], null);

    // Graph of this circuit's cables. Edges on uncalibrated floors have unknown length.
    const edges = new Map<string, { to: string; m: number }[]>();
    let uncalibrated = false;
    const addEdge = (a: string, b: string, m: number) => {
      edges.set(a, [...(edges.get(a) ?? []), { to: b, m }]);
      edges.set(b, [...(edges.get(b) ?? []), { to: a, m }]);
    };
    for (const f of inst.floors) {
      for (const w of f.wires) {
        if (w.circuitId !== circuit.id || !w.from.componentId || !w.to.componentId) continue;
        if (f.metresPerUnit === null) {
          uncalibrated = true;
          continue;
        }
        const a = byId.get(w.from.componentId);
        const b = byId.get(w.to.componentId);
        if (!a || !b) continue;
        const m = wireLengthUnits(w, (id) => byId.get(id)) * f.metresPerUnit + dropM(a, f) + dropM(b, f);
        addEdge(a.id, b.id, m);
      }
    }
    for (const l of inst.links) if (l.circuitId === circuit.id) addEdge(l.fromComponentId, l.toComponentId, l.lengthM);

    const dist = new Map<string, number>([[circuit.boardComponentId, 0]]);
    const queue = [circuit.boardComponentId];
    while (queue.length) {
      queue.sort((x, y) => dist.get(x)! - dist.get(y)!);
      const cur = queue.shift()!;
      for (const e of edges.get(cur) ?? []) {
        const d = dist.get(cur)! + e.m;
        if (d < (dist.get(e.to) ?? Infinity)) {
          if (!dist.has(e.to)) queue.push(e.to);
          dist.set(e.to, d);
        }
      }
    }
    const unreachable = members.filter((id) => !dist.has(id));
    if (unreachable.length) {
      const why = uncalibrated
        ? 'Some of its wires are on a floor without a scale.'
        : 'Not all its components are connected to the board by wires of this circuit.';
      return result(null, unreachable, why);
    }
    return result(Math.max(...members.map((id) => dist.get(id)!)), [], null);
  });
}

// ── Checks ──────────────────────────────────────────────────────────────

export interface CheckOptions {
  /** Price list and rules for the material checks (M1, M2); skipped when absent. */
  materials?: readonly MaterialDto[];
  rules?: readonly MaterialRuleDto[];
}

export function runChecks(inst: InstallationDto, opts: CheckOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (i: Omit<Issue, 'id' | 'componentIds' | 'wireIds' | 'circuitId' | 'floorId'> & Partial<Issue>, key: string) =>
    issues.push({ floorId: null, componentIds: [], wireIds: [], circuitId: null, ...i, id: `${i.code}:${key}` });
  const circuits = new Map(inst.circuits.map((c) => [c.id, c]));
  const allComponents = new Map<string, ComponentDto>();
  for (const f of inst.floors) for (const c of f.components) allComponents.set(c.id, c);
  const linked = new Set(inst.links.flatMap((l) => [l.fromComponentId, l.toComponentId]));

  // ── drawing ──
  for (const f of inst.floors) {
    const connected = new Set<string>(linked);
    for (const w of f.wires) {
      if (w.from.componentId) connected.add(w.from.componentId);
      if (w.to.componentId) connected.add(w.to.componentId);
      const free = [w.from, w.to].filter((e) => !e.componentId || !allComponents.has(e.componentId)).length;
      if (free) {
        add(
          { code: 'D2', severity: 'warning', message: `${wireName(w)} has ${free === 2 ? 'two unconnected ends' : 'an unconnected end'}.`, floorId: f.floorId, wireIds: [w.id] },
          w.id,
        );
      }
    }
    for (const c of f.components) {
      if (isAnnotation(c) || connected.has(c.id)) continue;
      const optional = categoryOf(c) === 'communication' || categoryOf(c) === 'smart';
      add(
        {
          code: 'D1',
          severity: optional ? 'info' : 'warning',
          message: `${nameOf(c)} has no wire connected${optional ? ' (fine if it is wireless or on a bus)' : ''}.`,
          floorId: f.floorId,
          componentIds: [c.id],
        },
        c.id,
      );
    }
    // D3: stacked components (O(n log n) by sorting on x).
    const sorted = f.components.filter((c) => !isAnnotation(c)).sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j]!.x - sorted[i]!.x < STACK_DISTANCE; j++) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        if (Math.abs(a.y - b.y) < STACK_DISTANCE) {
          const ids = [a.id, b.id].sort();
          add({ code: 'D3', severity: 'warning', message: `${nameOf(a)} and ${nameOf(b)} are on top of each other.`, floorId: f.floorId, componentIds: ids }, ids.join('|'));
        }
      }
    }
    // D5: scale.
    if (f.metresPerUnit === null && (f.hasPlan || f.wires.length)) {
      const hasWires = f.wires.length > 0;
      add(
        {
          code: 'D5',
          severity: hasWires ? 'error' : 'warning',
          message: hasWires ? `${f.name} has no scale: cable lengths and quantities are missing.` : `${f.name} has no scale yet.`,
          floorId: f.floorId,
        },
        `${f.floorId}|none`,
      );
    } else if (f.calibrationNeedsCheck) {
      add({ code: 'D5', severity: 'warning', message: `${f.name}: the plan changed; check that the scale is still right.`, floorId: f.floorId }, `${f.floorId}|check`);
    }
  }
  // D4: duplicate labels across the project.
  const byLabel = new Map<string, { label: string; ids: string[]; floors: Set<string> }>();
  for (const f of inst.floors) {
    for (const c of f.components) {
      if (isAnnotation(c) || !c.label?.trim()) continue;
      const key = c.label.trim().toLowerCase();
      const e = byLabel.get(key) ?? { label: c.label.trim(), ids: [], floors: new Set() };
      e.ids.push(c.id);
      e.floors.add(f.floorId);
      byLabel.set(key, e);
    }
  }
  for (const e of byLabel.values()) {
    if (e.ids.length < 2) continue;
    const ids = [...e.ids].sort();
    add(
      {
        code: 'D4',
        severity: 'warning',
        message: `Label “${e.label}” is used ${e.ids.length} times.`,
        floorId: e.floors.size === 1 ? [...e.floors][0]! : null,
        componentIds: ids,
      },
      ids.join('|'),
    );
  }

  // ── circuits ──
  for (const f of inst.floors) {
    for (const c of f.components) {
      if (isAnnotation(c) || isBoard(c) || categoryOf(c) === 'communication') continue;
      if (!c.circuitId || !circuits.has(c.circuitId)) {
        add({ code: 'C1', severity: 'warning', message: `${nameOf(c)} is not assigned to a circuit.`, floorId: f.floorId, componentIds: [c.id] }, c.id);
      }
    }
    for (const w of f.wires) {
      const circuit = w.circuitId ? circuits.get(w.circuitId) : undefined;
      if (!circuit) {
        add({ code: 'C2', severity: 'info', message: `${wireName(w)} is not assigned to a circuit.`, floorId: f.floorId, wireIds: [w.id] }, w.id);
        continue;
      }
      const endCircuits = [w.from.componentId, w.to.componentId]
        .map((id) => (id ? allComponents.get(id) : undefined))
        .filter((c): c is ComponentDto => !!c && !isBoard(c) && !!c.circuitId)
        .map((c) => c.circuitId!);
      if (endCircuits.length && !endCircuits.includes(circuit.id)) {
        add(
          {
            code: 'C3',
            severity: 'warning',
            message: `${wireName(w)} is on circuit ${circuitName(circuit)}, but the components it connects are on another circuit.`,
            floorId: f.floorId,
            wireIds: [w.id],
            circuitId: circuit.id,
          },
          w.id,
        );
      }
      const problems: string[] = [];
      if (circuit.crossSectionMm2 && w.cable.crossSectionMm2 && w.cable.crossSectionMm2 < circuit.crossSectionMm2) {
        problems.push(`${w.cable.crossSectionMm2} mm² is smaller than the circuit's ${circuit.crossSectionMm2} mm²`);
      }
      if (circuit.cableType && w.cable.cableType && circuit.cableType !== w.cable.cableType) {
        problems.push(`cable type ${w.cable.cableType} differs from the circuit's ${circuit.cableType}`);
      }
      if (problems.length) {
        add(
          { code: 'C4', severity: 'warning', message: `${wireName(w)}: ${problems.join('; ')}.`, floorId: f.floorId, wireIds: [w.id], circuitId: circuit.id },
          w.id,
        );
      }
    }
  }

  const loads = circuitLoads(inst);
  const drops = new Map(circuitVoltageDrops(inst, loads).map((d) => [d.circuitId, d]));
  for (const l of loads) {
    const c = l.circuit;
    const floorOfBoard = c.boardComponentId ? (inst.floors.find((f) => f.components.some((x) => x.id === c.boardComponentId))?.floorId ?? null) : null;
    const base = { circuitId: c.id, floorId: floorOfBoard };
    if (!c.boardComponentId) add({ ...base, code: 'C5', severity: 'warning', message: `Circuit ${circuitName(c)} is not fed from a distribution board.` }, `${c.id}|board`);
    if (l.componentCount === 0) add({ ...base, code: 'C5', severity: 'warning', message: `Circuit ${circuitName(c)} has no components.` }, `${c.id}|empty`);
    if (l.designCurrentA !== null && c.breakerRatingA && l.designCurrentA > c.breakerRatingA) {
      add(
        { ...base, code: 'C6', severity: 'error', message: `Circuit ${circuitName(c)}: estimated ${l.designCurrentA.toFixed(1)} A is above its ${c.breakerRatingA} A breaker.` },
        c.id,
      );
    }
    const limit = c.crossSectionMm2 ? inst.profile.maxBreakerByCrossSection[String(c.crossSectionMm2)] : undefined;
    if (limit !== undefined && c.breakerRatingA && c.breakerRatingA > limit) {
      add(
        { ...base, code: 'C7', severity: 'error', message: `Circuit ${circuitName(c)}: ${c.breakerRatingA} A breaker exceeds your ${limit} A limit for ${c.crossSectionMm2} mm².` },
        c.id,
      );
    }
    const maxDrop = inst.profile.maxVoltageDropPct;
    const d = drops.get(c.id);
    if (maxDrop && d && l.componentCount > 0 && c.boardComponentId) {
      if (d.problem) {
        add({ ...base, code: 'C8', severity: 'info', message: `Circuit ${circuitName(c)}: voltage drop not estimated. ${d.problem}`, componentIds: d.unreachable }, `${c.id}|path`);
      } else if (d.dropPct !== null && d.dropPct > maxDrop) {
        add(
          {
            ...base,
            code: 'C8',
            severity: 'warning',
            message: `Circuit ${circuitName(c)}: estimated voltage drop ${d.dropPct.toFixed(2)} % over ${d.lengthM!.toFixed(1)} m is above your ${maxDrop} % limit.`,
          },
          c.id,
        );
      }
    }
    if (inst.profile.rcdRequiredCategories.includes(c.category) && !c.rcdGroup) {
      add({ ...base, code: 'C9', severity: 'warning', message: `Circuit ${circuitName(c)} (${c.category}) has no RCD group; your rules require RCD protection for ${c.category}.` }, c.id);
    }
  }

  // ── boards ──
  for (const s of boardSchedules(inst, loads)) {
    // Only for boards that are clearly three-phase; a single-phase supply puts everything on L1 by design.
    if (new Set(s.circuits.map((l) => l.circuit.phase)).size < 2) continue;
    const v = [s.phaseLoadW.L1, s.phaseLoadW.L2, s.phaseLoadW.L3];
    const max = Math.max(...v);
    if (max > 0 && (max - Math.min(...v)) / max > IMBALANCE_LIMIT) {
      const floorId = inst.floors.find((f) => f.components.some((x) => x.id === s.board.id))?.floorId ?? null;
      add(
        {
          code: 'B1',
          severity: 'info',
          message: `${s.board.label ? `Board ${s.board.label}` : 'A board'}: phases are unbalanced (L1 ${(s.phaseLoadW.L1 / 1000).toFixed(1)}, L2 ${(s.phaseLoadW.L2 / 1000).toFixed(1)}, L3 ${(s.phaseLoadW.L3 / 1000).toFixed(1)} kW).`,
          floorId,
          componentIds: [s.board.id],
        },
        s.board.id,
      );
    }
  }

  // ── materials ──
  if (opts.materials && opts.rules) {
    const a = DEFAULT_ORGANIZATION_SETTINGS.allowances;
    const bom = buildBom(takeoff(inst, a), opts.materials, opts.rules, { allowances: a, roundToPacks: false });
    for (const u of bom.unmapped) {
      add({ code: 'M1', severity: 'info', message: `${u.label} has no material rule, so it is not priced.` }, u.target);
    }
    for (const l of bom.lines) {
      if (l.material.unitPrice === 0) add({ code: 'M2', severity: 'info', message: `${l.material.name} has price 0 in the price list.` }, l.material.id);
    }
  }

  return issues.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity] || x.code.localeCompare(y.code));
}

export interface CheckSummary {
  error: number;
  warning: number;
  info: number;
  ignored: number;
}

/** Splits issues into open and ignored (by the project's ignored ids). */
export function applyIgnored(issues: readonly Issue[], ignored: readonly { id: string }[]): { open: Issue[]; ignored: Issue[]; summary: CheckSummary } {
  const ids = new Set(ignored.map((i) => i.id));
  const open = issues.filter((i) => !ids.has(i.id));
  const hidden = issues.filter((i) => ids.has(i.id));
  return {
    open,
    ignored: hidden,
    summary: {
      error: open.filter((i) => i.severity === 'error').length,
      warning: open.filter((i) => i.severity === 'warning').length,
      info: open.filter((i) => i.severity === 'info').length,
      ignored: hidden.length,
    },
  };
}
