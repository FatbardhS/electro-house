import { z } from 'zod';

/**
 * Request validation schemas. The API validates every request body with these,
 * and the web app uses the same ones for form validation, so the rules cannot drift apart.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

const requiredName = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} must be at most ${max} characters.`);

// ── Auth ───────────────────────────────────────────────────────────────

/** Interface language. Albanian is the default. */
export const LANGUAGES = ['sq', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const languageSchema = z.enum(LANGUAGES);
export const setLanguageSchema = z.object({ language: languageSchema });

export const signUpSchema = z.object({
  name: requiredName('Name', 120),
  email: z.email('Enter a valid email address.').trim().toLowerCase().max(254),
  password: z.string().min(10, 'Password must be at least 10 characters.').max(200),
  organizationName: requiredName('Company name', 160),
  language: languageSchema.default('sq'),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  password: z.string().min(1, 'Password is required.').max(200),
});
export type SignInInput = z.infer<typeof signInSchema>;

// ── Clients ────────────────────────────────────────────────────────────
export const clientInputSchema = z.object({
  name: requiredName('Client name'),
  email: z
    .union([z.literal(''), z.email('Enter a valid email address.').trim().toLowerCase().max(254)])
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  phone: optionalText(50),
  address: optionalText(500),
  notes: optionalText(5000),
});
export type ClientInput = z.infer<typeof clientInputSchema>;

export const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});

// ── Projects ───────────────────────────────────────────────────────────
export const PROJECT_STATUSES = ['PLANNING', 'IN_PROGRESS', 'COMPLETED'] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const projectCreateSchema = z.object({
  clientId: z.uuid('Choose a client.'),
  name: requiredName('Project name'),
  propertyAddress: optionalText(500),
  description: optionalText(5000),
  status: projectStatusSchema.default('PLANNING'),
});
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;

export const projectUpdateSchema = projectCreateSchema.partial();
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;

// ── Floors ─────────────────────────────────────────────────────────────
export const floorCreateSchema = z.object({
  name: requiredName('Floor name', 80),
});
export type FloorCreateInput = z.infer<typeof floorCreateSchema>;

export const floorRenameSchema = z.object({
  name: requiredName('Floor name', 80),
});

export const floorReorderSchema = z.object({
  floorIds: z.array(z.uuid()).min(1).max(100),
});

const vec2Schema = z.object({ x: z.number().finite(), y: z.number().finite() });

export const calibrationSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('two-point'),
    p1: vec2Schema,
    p2: vec2Schema,
    realDistanceMm: z.number().positive().max(1_000_000),
    metresPerUnit: z.number().positive().finite(),
    calibratedAt: z.iso.datetime(),
  }),
  z.object({
    method: z.literal('paper-scale'),
    paperScale: z.number().positive().max(100_000),
    metresPerUnit: z.number().positive().finite(),
    calibratedAt: z.iso.datetime(),
  }),
]);

/** Floor view/plan settings saved by the editor's autosave. All fields optional; `baseRevision` is required. */
export const floorSettingsSchema = z.object({
  baseRevision: z.number().int().min(0),
  planPage: z.number().int().min(1).optional(),
  planRotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  backgroundLocked: z.boolean().optional(),
  calibration: calibrationSchema.nullable().optional(),
  calibrationNeedsCheck: z.boolean().optional(),
});
export type FloorSettingsInput = z.infer<typeof floorSettingsSchema>;

/** Preset floor names offered in the UI, in building order. Custom names are allowed too. */
export const FLOOR_PRESETS = ['Basement', 'Ground floor', 'First floor', 'Second floor', 'Third floor', 'Attic'] as const;

/** Upload limit for floor plan PDFs. */
export const MAX_PLAN_FILE_BYTES = 100 * 1024 * 1024;
