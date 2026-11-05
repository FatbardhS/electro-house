import { z } from 'zod';
import { COMPONENT_TYPES, MM_TO_PT, componentType, propertiesSchema } from '../catalog/catalog.js';
import { LAYER_KEYS, type LayerKey } from '../catalog/types.js';
import type { Vec2 } from '../geometry/vec.js';

/** A placed electrical component. Position is in plan coordinates (PDF points of the plan page). */
export interface ComponentDto {
  id: string;
  typeKey: string;
  typeVersion: number;
  layerKey: LayerKey;
  label: string | null;
  x: number;
  y: number;
  /** Degrees, clockwise. */
  rotation: number;
  mountHeightMm: number | null;
  description: string | null;
  properties: Record<string, unknown>;
}

export interface LayerStateDto {
  key: LayerKey;
  visible: boolean;
  locked: boolean;
}

export interface DrawingDto {
  floorId: string;
  revision: number;
  layers: LayerStateDto[];
  components: ComponentDto[];
}

/** Plan coordinates are bounded generously (an A0 sheet is ~3370 pt wide). */
const COORD = z.number().finite().min(-100_000).max(100_000);

export const componentSchema = z.object({
  id: z.uuid(),
  typeKey: z.string().min(1).max(80),
  typeVersion: z.number().int().min(1),
  layerKey: z.enum(LAYER_KEYS),
  label: z.string().trim().max(40).nullable(),
  x: COORD,
  y: COORD,
  rotation: z.number().finite(),
  mountHeightMm: z.number().int().min(0).max(20_000).nullable(),
  description: z.string().max(2000).nullable(),
  properties: z.record(z.string(), z.unknown()),
});

export const drawingOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('upsert'), component: componentSchema }),
  z.object({ op: z.literal('delete'), id: z.uuid() }),
  z.object({
    op: z.literal('layer'),
    key: z.enum(LAYER_KEYS),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
  }),
]);
export type DrawingOp = z.infer<typeof drawingOpSchema>;

export const MAX_OPS_PER_PATCH = 500;

export const drawingPatchSchema = z.object({
  baseRevision: z.number().int().min(0),
  ops: z.array(drawingOpSchema).min(1).max(MAX_OPS_PER_PATCH),
});
export type DrawingPatchInput = z.infer<typeof drawingPatchSchema>;

/**
 * Checks a component against the catalog: known type, valid properties.
 * Returns the component with normalised properties and rotation, or a list of problems.
 */
export function validateComponent(c: ComponentDto): { ok: true; value: ComponentDto } | { ok: false; error: string } {
  const type = componentType(c.typeKey);
  if (!type) return { ok: false, error: `Unknown component type "${c.typeKey}".` };
  const props = propertiesSchema(type).safeParse(c.properties);
  if (!props.success) {
    const first = props.error.issues[0];
    return { ok: false, error: `${type.name}: ${first?.message ?? 'invalid properties'}` };
  }
  return { ok: true, value: { ...c, properties: props.data, rotation: normalizeDegrees(c.rotation) } };
}

export function normalizeDegrees(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  return Math.abs(r - 360) < 1e-9 ? 0 : r;
}

export function defaultLayers(): LayerStateDto[] {
  return LAYER_KEYS.map((key) => ({ key, visible: true, locked: false }));
}

// ── geometry helpers ────────────────────────────────────────────────────

/** Radius of a component's selectable area in plan units. */
export function hitRadius(c: Pick<ComponentDto, 'typeKey'>): number {
  return (componentType(c.typeKey)?.symbol.hitRadiusMm ?? 3) * MM_TO_PT;
}

/** Topmost component under a plan point (last drawn wins), or null. */
export function hitTest<T extends ComponentDto>(components: readonly T[], p: Vec2, tolerance = 0): T | null {
  for (let i = components.length - 1; i >= 0; i--) {
    const c = components[i]!;
    const r = hitRadius(c) + tolerance;
    if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 <= r * r) return c;
  }
  return null;
}

/** Components whose insertion point lies inside the axis-aligned rectangle (any corner order). */
export function insideRect<T extends ComponentDto>(components: readonly T[], a: Vec2, b: Vec2): T[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return components.filter((c) => c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1);
}

export function snapToStep(p: Vec2, step: number): Vec2 {
  if (!(step > 0)) return p;
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
}

/** Next free automatic label for a prefix, e.g. "S4" when S1–S3 exist. */
export function nextLabel(prefix: string, components: readonly Pick<ComponentDto, 'label'>[]): string {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
  let max = 0;
  for (const c of components) {
    const m = c.label ? re.exec(c.label) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

/**
 * Gives copied components fresh automatic labels (L1 → next free L number) so labels stay unique.
 * Labels the user typed themselves (not "<prefix><number>") are kept as they are.
 */
export function relabelCopies<T extends ComponentDto>(copies: T[], existing: readonly Pick<ComponentDto, 'label'>[]): T[] {
  const taken: Pick<ComponentDto, 'label'>[] = [...existing];
  return copies.map((c) => {
    const prefix = componentType(c.typeKey)?.labelPrefix;
    if (!prefix || !c.label || !new RegExp(`^${prefix}\\d+$`).test(c.label)) return c;
    const label = nextLabel(prefix, taken);
    taken.push({ label });
    return { ...c, label };
  });
}

/** A new component of a type at a plan position, with the type's defaults. */
export function createComponent(
  typeKey: string,
  at: Vec2,
  id: string,
  existing: readonly Pick<ComponentDto, 'label'>[],
): ComponentDto {
  const type = componentType(typeKey);
  if (!type) throw new Error(`Unknown component type "${typeKey}"`);
  return {
    id,
    typeKey,
    typeVersion: type.version,
    layerKey: type.defaultLayer,
    label: nextLabel(type.labelPrefix, existing),
    x: at.x,
    y: at.y,
    rotation: 0,
    mountHeightMm: type.defaultMountHeightMm ?? null,
    description: null,
    properties: { ...type.defaults },
  };
}

/** RFC 9562 UUID version 7 (time-ordered). Works in browsers and Node 20+. */
export function uuidv7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const ts = BigInt(now);
  for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const COMPONENT_TYPE_COUNT = COMPONENT_TYPES.length;
