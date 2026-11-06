import { componentType } from '../catalog/catalog.js';
import type { Category } from '../catalog/types.js';
import type { ComponentDto } from '../drawing/drawing.js';
import { cableSummary, wireLengthUnits, type CableDto } from '../drawing/wires.js';
import type { FloorInstallationDto, InstallationDto } from '../installation/installation.js';
import {
  cableTarget,
  componentTarget,
  rulesForCable,
  rulesForComponent,
  type MaterialDto,
  type MaterialRuleDto,
} from './materials.js';
import { DEFAULT_COST_NOTE, type Allowances, type EffectiveCostSettings, type ProjectCostSettings } from './settings.js';

/** Rounds to whole cents (or the minor unit of 2-decimal currencies). */
export function roundMoney(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Rounds a quantity to 3 decimals so floating-point noise never reaches a report. */
export function roundQty(v: number): number {
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
}

// ── Take-off: everything countable in the plans ─────────────────────────

export interface PlacedComponent {
  component: ComponentDto;
  floorId: string;
}

/** One cable run (a wire on a floor, or a floor connection) with its allowances in metres. */
export interface CableRun {
  id: string;
  cable: CableDto;
  /** null for floor connections. */
  floorId: string | null;
  circuitId: string | null;
  /** Measured route length; null when the floor is not calibrated. */
  measuredM: number | null;
  dropsM: number;
  terminationsM: number;
}

export interface Takeoff {
  components: PlacedComponent[];
  runs: CableRun[];
}

function mountHeightMm(c: ComponentDto): number | null {
  return c.mountHeightMm ?? componentType(c.typeKey)?.defaultMountHeightMm ?? null;
}

function isBoard(c: ComponentDto): boolean {
  return c.typeKey.startsWith('board.');
}

/** Vertical cable from the routing level (ceiling or floor) down/up to a component's mounting height. */
export function dropM(c: ComponentDto, floor: Pick<FloorInstallationDto, 'ceilingHeightMm' | 'cableRouting'>): number {
  const h = mountHeightMm(c);
  if (h === null) return 0;
  const mm = floor.cableRouting === 'floor' ? h : Math.max(0, floor.ceilingHeightMm - h);
  return mm / 1000;
}

function terminationM(c: ComponentDto, a: Allowances): number {
  return isBoard(c) ? a.boardTailM : a.endReserveM;
}

export function takeoff(inst: InstallationDto, allowances: Allowances): Takeoff {
  const components: PlacedComponent[] = [];
  const runs: CableRun[] = [];
  const byId = new Map<string, ComponentDto>();
  for (const f of inst.floors) for (const c of f.components) byId.set(c.id, c);

  for (const f of inst.floors) {
    for (const c of f.components) {
      if (c.typeKey.startsWith('annotation.')) continue; // notes and markers are not material
      components.push({ component: c, floorId: f.floorId });
    }
    for (const w of f.wires) {
      let drops = 0;
      let terms = 0;
      for (const end of [w.from, w.to]) {
        const c = end.componentId ? byId.get(end.componentId) : undefined;
        if (!c) continue;
        drops += dropM(c, f);
        terms += terminationM(c, allowances);
      }
      runs.push({
        id: w.id,
        cable: w.cable,
        floorId: f.floorId,
        circuitId: w.circuitId,
        measuredM: f.metresPerUnit === null ? null : wireLengthUnits(w, (id) => byId.get(id)) * f.metresPerUnit,
        dropsM: drops,
        terminationsM: terms,
      });
    }
  }
  for (const l of inst.links) {
    let terms = 0;
    for (const id of [l.fromComponentId, l.toComponentId]) {
      const c = byId.get(id);
      if (c) terms += terminationM(c, allowances);
    }
    // The entered length already includes the vertical run, so no drops are added.
    runs.push({ id: l.id, cable: l.cable, floorId: null, circuitId: l.circuitId, measuredM: l.lengthM, dropsM: 0, terminationsM: terms });
  }
  return { components, runs };
}

export type BomGrouping = 'project' | 'floor' | 'circuit';

export interface TakeoffGroup {
  id: string;
  name: string;
  takeoff: Takeoff;
}

/** Splits a take-off by floor (plus "Between floors") or by circuit (plus "Not assigned to a circuit"). */
export function groupTakeoff(t: Takeoff, inst: InstallationDto, grouping: BomGrouping): TakeoffGroup[] {
  if (grouping === 'project') return [{ id: 'project', name: 'Whole project', takeoff: t }];
  const groups: TakeoffGroup[] = [];
  const add = (id: string, name: string, pc: (p: PlacedComponent) => boolean, pr: (r: CableRun) => boolean) => {
    const g = { components: t.components.filter(pc), runs: t.runs.filter(pr) };
    if (g.components.length || g.runs.length) groups.push({ id, name, takeoff: g });
  };
  if (grouping === 'floor') {
    for (const f of inst.floors) add(f.floorId, f.name, (p) => p.floorId === f.floorId, (r) => r.floorId === f.floorId);
    add('links', 'Between floors', () => false, (r) => r.floorId === null);
  } else {
    const sorted = [...inst.circuits].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    for (const c of sorted) add(c.id, `${c.number} · ${c.name}`, (p) => p.component.circuitId === c.id, (r) => r.circuitId === c.id);
    const known = new Set(inst.circuits.map((c) => c.id));
    const free = (id: string | null) => !id || !known.has(id);
    add('none', 'Not assigned to a circuit', (p) => free(p.component.circuitId), (r) => free(r.circuitId));
  }
  return groups;
}

// ── Bill of materials ───────────────────────────────────────────────────

export interface ComponentRow {
  typeKey: string;
  name: string;
  category: Category;
  count: number;
}

export interface CableRow {
  key: string;
  target: string;
  cable: CableDto;
  runs: number;
  /** Runs on uncalibrated floors: not included in any length. */
  unknownRuns: number;
  measuredM: number;
  dropsM: number;
  terminationsM: number;
  wasteM: number;
  totalM: number;
}

export interface MaterialLine {
  material: MaterialDto;
  /** Quantity needed by the plans. */
  quantity: number;
  /** Packs to order when rounding to packs, else null. */
  packs: number | null;
  /** Quantity priced: `quantity`, or rounded up to whole packs. */
  orderQuantity: number;
  total: number;
  /** Readable names of what consumed this material. */
  usedFor: string[];
}

export interface UnmappedItem {
  target: string;
  label: string;
  quantity: number;
  unit: 'pcs' | 'm';
}

export interface Bom {
  components: ComponentRow[];
  cables: CableRow[];
  lines: MaterialLine[];
  unmapped: UnmappedItem[];
  labourMinutes: number;
  materialsNet: number;
  unknownRuns: number;
}

export interface BomOptions {
  allowances: Allowances;
  roundToPacks: boolean;
}

export function cableRows(runs: readonly CableRun[], allowances: Allowances): CableRow[] {
  const rows = new Map<string, CableRow>();
  for (const r of runs) {
    const target = cableTarget(r.cable);
    const row = rows.get(target) ?? {
      key: cableSummary(r.cable),
      target,
      cable: r.cable,
      runs: 0,
      unknownRuns: 0,
      measuredM: 0,
      dropsM: 0,
      terminationsM: 0,
      wasteM: 0,
      totalM: 0,
    };
    row.runs++;
    if (r.measuredM === null) row.unknownRuns++;
    else {
      row.measuredM += r.measuredM;
      row.dropsM += r.dropsM;
      row.terminationsM += r.terminationsM;
    }
    rows.set(target, row);
  }
  return [...rows.values()]
    .map((row) => {
      const base = row.measuredM + row.dropsM + row.terminationsM;
      const wasteM = (base * allowances.wastePct) / 100;
      return {
        ...row,
        measuredM: roundQty(row.measuredM),
        dropsM: roundQty(row.dropsM),
        terminationsM: roundQty(row.terminationsM),
        wasteM: roundQty(wasteM),
        totalM: roundQty(base + wasteM),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

export function componentRows(components: readonly PlacedComponent[]): ComponentRow[] {
  const counts = new Map<string, number>();
  for (const p of components) counts.set(p.component.typeKey, (counts.get(p.component.typeKey) ?? 0) + 1);
  return [...counts]
    .map(([typeKey, count]) => {
      const t = componentType(typeKey);
      return { typeKey, name: t?.name ?? typeKey, category: t?.category ?? ('annotation' as Category), count };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function buildBom(t: Takeoff, materials: readonly MaterialDto[], rules: readonly MaterialRuleDto[], opts: BomOptions): Bom {
  const components = componentRows(t.components);
  const cables = cableRows(t.runs, opts.allowances);
  const byMaterial = new Map<string, { quantity: number; usedFor: Set<string> }>();
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const unmapped: UnmappedItem[] = [];
  let labourMinutes = 0;

  const consume = (applicable: MaterialRuleDto[], units: number, label: string) => {
    for (const r of applicable) {
      if (!materialById.has(r.materialId)) continue;
      const e = byMaterial.get(r.materialId) ?? { quantity: 0, usedFor: new Set<string>() };
      e.quantity += units * r.quantity;
      e.usedFor.add(label);
      byMaterial.set(r.materialId, e);
      labourMinutes += units * r.labourMinutes;
    }
  };

  for (const row of components) {
    const applicable = rulesForComponent(row.typeKey, rules);
    if (applicable.length === 0) unmapped.push({ target: componentTarget(row.typeKey), label: row.name, quantity: row.count, unit: 'pcs' });
    else consume(applicable, row.count, row.name);
  }
  for (const row of cables) {
    const applicable = rulesForCable(row.cable, rules);
    if (applicable.length === 0) unmapped.push({ target: row.target, label: row.key, quantity: row.totalM, unit: 'm' });
    else consume(applicable, row.totalM, row.key);
  }

  const lines: MaterialLine[] = [...byMaterial].map(([id, e]) => {
    const material = materialById.get(id)!;
    const quantity = roundQty(e.quantity);
    const packs = opts.roundToPacks && material.packSize ? Math.ceil(quantity / material.packSize - 1e-9) : null;
    const orderQuantity = packs !== null ? roundQty(packs * material.packSize!) : quantity;
    return { material, quantity, packs, orderQuantity, total: roundMoney(orderQuantity * material.unitPrice), usedFor: [...e.usedFor].sort() };
  });
  lines.sort(
    (a, b) =>
      (a.material.category ?? '').localeCompare(b.material.category ?? '') || a.material.name.localeCompare(b.material.name),
  );
  return {
    components,
    cables,
    lines,
    unmapped,
    labourMinutes: roundQty(labourMinutes),
    materialsNet: roundMoney(lines.reduce((s, l) => s + l.total, 0)),
    unknownRuns: cables.reduce((s, c) => s + c.unknownRuns, 0),
  };
}

// ── Cost report ─────────────────────────────────────────────────────────

export interface CostSummary {
  currency: string;
  materialsNet: number;
  markupPct: number;
  markup: number;
  /** Hours from material rules. */
  ruleHours: number;
  extraHours: number;
  hourlyRate: number;
  labour: number;
  extraLines: { text: string; amount: number }[];
  extrasTotal: number;
  net: number;
  vatPct: number;
  vat: number;
  gross: number;
  note: string;
}

export function costSummary(bom: Bom, eff: EffectiveCostSettings, project: ProjectCostSettings): CostSummary {
  const markup = roundMoney((bom.materialsNet * eff.markupPct) / 100);
  const ruleHours = roundQty(bom.labourMinutes / 60);
  const hours = ruleHours + project.extraHours;
  const labour = roundMoney(hours * eff.hourlyRate);
  const extraLines = project.extraLines.map((l) => ({ text: l.text, amount: roundMoney(l.amount) }));
  const extrasTotal = roundMoney(extraLines.reduce((s, l) => s + l.amount, 0));
  const net = roundMoney(bom.materialsNet + markup + labour + extrasTotal);
  const vat = roundMoney((net * eff.vatPct) / 100);
  return {
    currency: eff.currency,
    materialsNet: bom.materialsNet,
    markupPct: eff.markupPct,
    markup,
    ruleHours,
    extraHours: project.extraHours,
    hourlyRate: eff.hourlyRate,
    labour,
    extraLines,
    extrasTotal,
    net,
    vatPct: eff.vatPct,
    vat,
    gross: roundMoney(net + vat),
    note: project.note.trim() || DEFAULT_COST_NOTE,
  };
}

/** Formats an amount with the company currency, e.g. "1,234.50 EUR". */
export function formatMoney(amount: number, currency: string): string {
  const s = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${s} ${currency}`;
}
