import { z } from 'zod';
import { CABLE_TYPES, cableSummary, type CableDto } from '../drawing/wires.js';
import { componentType } from '../catalog/catalog.js';

// ── Price list ──────────────────────────────────────────────────────────

export interface MaterialDto {
  id: string;
  /** Supplier article number. Unique per company when set; used to match CSV imports. */
  code: string | null;
  name: string;
  /** "pcs", "m", "pack" or free text. Quantities in the BOM are in this unit. */
  unit: string;
  /** Net price per unit in the company currency. */
  unitPrice: number;
  /** Units per pack/drum (e.g. 100 m); used to round order quantities up. */
  packSize: number | null;
  category: string | null;
  archived: boolean;
  updatedAt: string;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === '' ? null : v));

export const materialInputSchema = z.object({
  code: optionalText(60),
  name: z.string().trim().min(1, 'Material name is required.').max(200),
  unit: z.string().trim().min(1, 'Unit is required.').max(20),
  unitPrice: z.number().min(0, 'Price cannot be negative.').max(10_000_000),
  packSize: z.number().positive('Pack size must be positive.').max(1_000_000).nullable(),
  category: optionalText(80),
  archived: z.boolean(),
});
export type MaterialInput = z.infer<typeof materialInputSchema>;
export const materialUpdateSchema = materialInputSchema.partial();

export const MATERIAL_UNITS = ['pcs', 'm', 'pack', 'set', 'h'] as const;

// ── Material rules ──────────────────────────────────────────────────────

/**
 * What a component type or a cable consumes.
 * - `component:<typeKey>` → quantity per placed component.
 * - `cable:<type>|<conductors>|<mm²>` → quantity per metre of cable; each part may be `*` (any).
 */
export interface MaterialRuleDto {
  id: string;
  target: string;
  materialId: string;
  quantity: number;
  /** Installation time per component, or per metre for cables. */
  labourMinutes: number;
}

const CABLE_PART = '[^|]{1,40}';
export const RULE_TARGET = new RegExp(`^(component:[a-z0-9.-]{1,80}|cable:${CABLE_PART}\\|${CABLE_PART}\\|${CABLE_PART})$`);

export const materialRuleInputSchema = z.object({
  target: z.string().regex(RULE_TARGET, 'Invalid rule target.'),
  materialId: z.uuid(),
  quantity: z.number().min(0).max(1_000_000),
  labourMinutes: z.number().min(0).max(100_000),
});
export type MaterialRuleInput = z.infer<typeof materialRuleInputSchema>;
export const materialRuleUpdateSchema = materialRuleInputSchema.partial();

export function componentTarget(typeKey: string): string {
  return `component:${typeKey}`;
}

/** Rule target for a cable spec. Missing values become `*`. */
export function cableTarget(cable: Pick<CableDto, 'cableType' | 'conductors' | 'crossSectionMm2'>): string {
  return `cable:${cable.cableType ?? '*'}|${cable.conductors ?? '*'}|${cable.crossSectionMm2 ?? '*'}`;
}

export function parseCableTarget(target: string): { cableType: string; conductors: string; crossSection: string } | null {
  const m = /^cable:([^|]+)\|([^|]+)\|([^|]+)$/.exec(target);
  return m ? { cableType: m[1]!, conductors: m[2]!, crossSection: m[3]! } : null;
}

/** Readable name of a rule target, e.g. "Double outlet" or "NYM-J 3×1.5 mm²" or "NYM-J (any size)". */
export function targetLabel(target: string): string {
  if (target.startsWith('component:')) {
    const key = target.slice('component:'.length);
    return componentType(key)?.name ?? key;
  }
  const c = parseCableTarget(target);
  if (!c) return target;
  const any = (v: string) => v === '*';
  if (any(c.conductors) && any(c.crossSection)) return `${any(c.cableType) ? 'Any cable' : c.cableType} (any size)`;
  const cable: CableDto = {
    cableType: any(c.cableType) ? undefined : (c.cableType as CableDto['cableType']),
    conductors: any(c.conductors) ? undefined : Number(c.conductors),
    crossSectionMm2: any(c.crossSection) ? undefined : Number(c.crossSection),
    color: '#000000',
    lineStyle: 'solid',
  };
  let s = cableSummary(cable);
  if (any(c.cableType)) s = s.replace(/^Cable/, 'Any cable');
  if (any(c.conductors) && !any(c.crossSection)) s += ' (any cores)';
  if (!any(c.conductors) && any(c.crossSection)) s = `${s} ${c.conductors} cores (any size)`;
  return s;
}

/**
 * Rules that apply to a cable: those of the most specific matching target (fewest `*`).
 * A target may have several rules (several materials), which all apply.
 */
export function rulesForCable(cable: Pick<CableDto, 'cableType' | 'conductors' | 'crossSectionMm2'>, rules: readonly MaterialRuleDto[]): MaterialRuleDto[] {
  const matches = (part: string, value: string | number | undefined): boolean =>
    value !== undefined && (typeof value === 'number' ? Number(part) === value : part === value);
  let best = -1;
  let bestTarget: string | null = null;
  for (const r of rules) {
    const c = parseCableTarget(r.target);
    if (!c) continue;
    const checks: [string, string | number | undefined][] = [
      [c.cableType, cable.cableType],
      [c.conductors, cable.conductors],
      [c.crossSection, cable.crossSectionMm2],
    ];
    let score = 0;
    let ok = true;
    for (const [part, value] of checks) {
      if (part === '*') continue;
      if (matches(part, value)) score++;
      else ok = false;
    }
    if (ok && score > best) {
      best = score;
      bestTarget = r.target;
    }
  }
  return bestTarget === null ? [] : rules.filter((r) => r.target === bestTarget);
}

export function rulesForComponent(typeKey: string, rules: readonly MaterialRuleDto[]): MaterialRuleDto[] {
  const t = componentTarget(typeKey);
  return rules.filter((r) => r.target === t);
}

export const CABLE_TYPE_OPTIONS = ['*', ...CABLE_TYPES] as const;

// ── CSV import / export ─────────────────────────────────────────────────

/** RFC 4180-style CSV parser. Detects `;`, `,` or tab as delimiter from the header line. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ';': 0, ',': 0, '\t': 0 } as Record<string, number>;
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]!++;
  }
  const [top] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const delim = top && top[1] > 0 ? top[0] : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** Parses "12.50", "12,50", "1.234,50" and "1,234.50". Returns NaN for anything else. */
export function parseDecimal(raw: string): number {
  let s = raw.trim().replace(/\s|'/g, '');
  if (s === '') return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

const HEADER_ALIASES: Record<string, keyof MaterialInput> = {
  code: 'code',
  sku: 'code',
  article: 'code',
  'article number': 'code',
  name: 'name',
  description: 'name',
  unit: 'unit',
  price: 'unitPrice',
  'unit price': 'unitPrice',
  unitprice: 'unitPrice',
  'net price': 'unitPrice',
  pack: 'packSize',
  'pack size': 'packSize',
  packsize: 'packSize',
  category: 'category',
};

export interface CsvMaterialRow {
  line: number;
  input: MaterialInput;
}

export interface CsvParseResult {
  rows: CsvMaterialRow[];
  errors: { line: number; message: string }[];
}

/** Reads a price list CSV. Required columns: name, unit, price. Optional: code, pack size, category. */
export function materialsFromCsv(text: string): CsvParseResult {
  const table = parseCsv(text);
  const errors: CsvParseResult['errors'] = [];
  if (table.length === 0) return { rows: [], errors: [{ line: 1, message: 'The file is empty.' }] };
  const header = table[0]!.map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? null);
  for (const col of ['name', 'unit', 'unitPrice'] as const) {
    if (!header.includes(col)) {
      errors.push({ line: 1, message: `Missing column "${col === 'unitPrice' ? 'price' : col}".` });
    }
  }
  if (errors.length) return { rows: [], errors };
  const rows: CsvMaterialRow[] = [];
  const seenCodes = new Set<string>();
  for (const [idx, cells] of table.slice(1).entries()) {
    const line = idx + 2;
    const get = (k: keyof MaterialInput) => {
      const i = header.indexOf(k);
      return i >= 0 ? (cells[i] ?? '').trim() : '';
    };
    const price = parseDecimal(get('unitPrice'));
    const pack = get('packSize');
    const packSize = pack === '' ? null : parseDecimal(pack);
    if (Number.isNaN(price)) {
      errors.push({ line, message: `Price "${get('unitPrice')}" is not a number.` });
      continue;
    }
    if (packSize !== null && Number.isNaN(packSize)) {
      errors.push({ line, message: `Pack size "${pack}" is not a number.` });
      continue;
    }
    const parsed = materialInputSchema.safeParse({
      code: get('code') || null,
      name: get('name'),
      unit: get('unit'),
      unitPrice: price,
      packSize,
      category: get('category') || null,
      archived: false,
    });
    if (!parsed.success) {
      errors.push({ line, message: parsed.error.issues[0]?.message ?? 'Invalid row.' });
      continue;
    }
    if (parsed.data.code) {
      if (seenCodes.has(parsed.data.code)) {
        errors.push({ line, message: `Code "${parsed.data.code}" appears twice in the file.` });
        continue;
      }
      seenCodes.add(parsed.data.code);
    }
    rows.push({ line, input: parsed.data });
  }
  return { rows, errors };
}

function csvField(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function materialsToCsv(materials: readonly MaterialDto[]): string {
  const lines = [['code', 'name', 'unit', 'price', 'pack size', 'category'].join(',')];
  for (const m of materials) {
    if (m.archived) continue;
    lines.push([m.code, m.name, m.unit, m.unitPrice, m.packSize, m.category].map(csvField).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** Clearly fictional starter materials offered to a new company (prices are placeholders to replace). */
export const EXAMPLE_MATERIALS: readonly MaterialInput[] = [
  { code: 'EX-BOX-60', name: 'Flush box 60 mm (example)', unit: 'pcs', unitPrice: 0.5, packSize: null, category: 'Boxes', archived: false },
  { code: 'EX-OUT-2', name: 'Double socket outlet (example)', unit: 'pcs', unitPrice: 8, packSize: null, category: 'Devices', archived: false },
  { code: 'EX-SW-1', name: 'Switch 1-way (example)', unit: 'pcs', unitPrice: 5, packSize: null, category: 'Devices', archived: false },
  { code: 'EX-FR-1', name: 'Cover frame 1-gang (example)', unit: 'pcs', unitPrice: 2, packSize: null, category: 'Devices', archived: false },
  { code: 'EX-LMP', name: 'Ceiling light fitting (example)', unit: 'pcs', unitPrice: 25, packSize: null, category: 'Lighting', archived: false },
  { code: 'EX-NYM-315', name: 'NYM-J 3×1.5 mm² (example)', unit: 'm', unitPrice: 0.6, packSize: 100, category: 'Cable', archived: false },
  { code: 'EX-NYM-325', name: 'NYM-J 3×2.5 mm² (example)', unit: 'm', unitPrice: 0.9, packSize: 100, category: 'Cable', archived: false },
  { code: 'EX-NYM-56', name: 'NYM-J 5×6 mm² (example)', unit: 'm', unitPrice: 3.2, packSize: 50, category: 'Cable', archived: false },
  { code: 'EX-CONDUIT-20', name: 'Flexible conduit 20 mm (example)', unit: 'm', unitPrice: 0.3, packSize: 50, category: 'Conduit', archived: false },
];
