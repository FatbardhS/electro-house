import { z } from 'zod';

// ── Company (organization) settings ─────────────────────────────────────

/** Cable allowances added on top of measured lengths in the bill of materials. */
export interface Allowances {
  /** Waste / offcuts in % of measured + drops + terminations. */
  wastePct: number;
  /** Reserve per wire end connected to a component (m). */
  endReserveM: number;
  /** Reserve per wire end at a distribution board (m). */
  boardTailM: number;
}

export const allowancesSchema = z.object({
  wastePct: z.number().min(0).max(100),
  endReserveM: z.number().min(0).max(10),
  boardTailM: z.number().min(0).max(20),
});

/** Max size of the logo stored in settings (base64 data URL). */
export const MAX_LOGO_BYTES = 300_000;

export interface OrganizationSettings {
  /** ISO 4217 code, e.g. "EUR". All prices of the company are in this currency. */
  currency: string;
  vatPct: number;
  /** Markup on material cost in %. */
  markupPct: number;
  /** Labour rate per hour (net). */
  hourlyRate: number;
  allowances: Allowances;
  /** Round cable and material quantities up to whole packs / drums when a pack size is set. */
  roundToPacks: boolean;
  company: { address: string; phone: string; email: string; website: string; taxNumber: string };
  /** PNG or JPEG as a data URL, shown in PDF title blocks. */
  logoDataUrl: string | null;
}

const text = (max: number) => z.string().trim().max(max);

export const organizationSettingsSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code such as EUR.'),
  vatPct: z.number().min(0).max(100),
  markupPct: z.number().min(0).max(1000),
  hourlyRate: z.number().min(0).max(100_000),
  allowances: allowancesSchema,
  roundToPacks: z.boolean(),
  company: z.object({
    address: text(300),
    phone: text(60),
    email: text(200),
    website: text(200),
    taxNumber: text(60),
  }),
  logoDataUrl: z
    .string()
    .max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 40, 'The logo is too large (max 300 KB).')
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'The logo must be a PNG or JPEG image.')
    .nullable(),
});

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  currency: 'EUR',
  vatPct: 0,
  markupPct: 0,
  hourlyRate: 0,
  allowances: { wastePct: 5, endReserveM: 0.2, boardTailM: 0.5 },
  roundToPacks: false,
  company: { address: '', phone: '', email: '', website: '', taxNumber: '' },
  logoDataUrl: null,
};

/** Reads stored settings leniently: missing or invalid parts fall back to the defaults. */
export function readOrganizationSettings(raw: unknown): OrganizationSettings {
  const r = (raw ?? {}) as Partial<OrganizationSettings>;
  const merged = {
    ...DEFAULT_ORGANIZATION_SETTINGS,
    ...r,
    allowances: { ...DEFAULT_ORGANIZATION_SETTINGS.allowances, ...(r.allowances ?? {}) },
    company: { ...DEFAULT_ORGANIZATION_SETTINGS.company, ...(r.company ?? {}) },
  };
  const parsed = organizationSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_ORGANIZATION_SETTINGS;
}

// ── Project cost settings (overrides) ───────────────────────────────────

export interface CostExtraLine {
  text: string;
  /** Net amount; negative for a discount. */
  amount: number;
}

/** Per-project overrides. `null` = use the company setting. */
export interface ProjectCostSettings {
  markupPct: number | null;
  vatPct: number | null;
  hourlyRate: number | null;
  wastePct: number | null;
  endReserveM: number | null;
  boardTailM: number | null;
  /** Hours added on top of the labour from material rules (e.g. testing, commissioning). */
  extraHours: number;
  extraLines: CostExtraLine[];
  /** Note printed on the cost report. Empty = the default estimate disclaimer. */
  note: string;
}

const nullablePct = (max: number) => z.number().min(0).max(max).nullable();

export const projectCostSettingsSchema = z.object({
  markupPct: nullablePct(1000),
  vatPct: nullablePct(100),
  hourlyRate: z.number().min(0).max(100_000).nullable(),
  wastePct: nullablePct(100),
  endReserveM: z.number().min(0).max(10).nullable(),
  boardTailM: z.number().min(0).max(20).nullable(),
  extraHours: z.number().min(0).max(100_000),
  extraLines: z
    .array(z.object({ text: z.string().trim().min(1, 'Describe the extra line.').max(200), amount: z.number().min(-1e9).max(1e9) }))
    .max(50),
  note: z.string().max(2000),
});

export const EMPTY_COST_SETTINGS: ProjectCostSettings = {
  markupPct: null,
  vatPct: null,
  hourlyRate: null,
  wastePct: null,
  endReserveM: null,
  boardTailM: null,
  extraHours: 0,
  extraLines: [],
  note: '',
};

export const DEFAULT_COST_NOTE =
  'Estimate based on the current plans and price list. Not a binding quote; quantities and prices may change.';

export function readProjectCostSettings(raw: unknown): ProjectCostSettings {
  const parsed = projectCostSettingsSchema.safeParse({ ...EMPTY_COST_SETTINGS, ...((raw as object) ?? {}) });
  return parsed.success ? parsed.data : EMPTY_COST_SETTINGS;
}

/** Company settings with the project's overrides applied. */
export interface EffectiveCostSettings {
  currency: string;
  vatPct: number;
  markupPct: number;
  hourlyRate: number;
  allowances: Allowances;
  roundToPacks: boolean;
}

export function effectiveCostSettings(org: OrganizationSettings, project: ProjectCostSettings): EffectiveCostSettings {
  return {
    currency: org.currency,
    vatPct: project.vatPct ?? org.vatPct,
    markupPct: project.markupPct ?? org.markupPct,
    hourlyRate: project.hourlyRate ?? org.hourlyRate,
    allowances: {
      wastePct: project.wastePct ?? org.allowances.wastePct,
      endReserveM: project.endReserveM ?? org.allowances.endReserveM,
      boardTailM: project.boardTailM ?? org.allowances.boardTailM,
    },
    roundToPacks: org.roundToPacks,
  };
}
