import { z } from 'zod';
import { MM_TO_PT, componentType } from '../catalog/catalog.js';
import { distance, polylineLength, type Vec2 } from '../geometry/vec.js';
import type { ComponentDto } from './drawing.js';

/**
 * One end of a cable route. When `componentId` is set the end is connected (as data) to that
 * component's port and its position is derived from the component; x/y then only hold the last
 * known position (used if the component is ever missing). Otherwise x/y is a free end in plan units.
 */
export interface WireEndDto {
  componentId: string | null;
  portId: string | null;
  x: number;
  y: number;
}

export const CABLE_TYPES = [
  'NYM-J',
  'NYY-J',
  'H07V-U',
  'H07V-K',
  'H05VV-F',
  'N2XH-J',
  'Cat6',
  'Cat6A',
  'Coax',
  'Bus (KNX)',
  'Other',
] as const;
export const CROSS_SECTIONS_MM2 = [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50] as const;
export const INSTALL_METHODS = [
  'In conduit in wall',
  'In conduit in ceiling',
  'In screed / floor',
  'Surface mounted',
  'In cable tray',
  'Buried in ground',
  'Free air',
] as const;
export const LINE_STYLES = ['solid', 'dashed', 'dotted', 'dash-dot'] as const;
export const WIRE_COLORS = ['#111827', '#b91c1c', '#1d4ed8', '#15803d', '#c2410c', '#7e22ce', '#0e7490', '#be185d', '#a16207'] as const;

export interface CableDto {
  cableType?: (typeof CABLE_TYPES)[number];
  conductors?: number;
  crossSectionMm2?: number;
  voltage?: number;
  installMethod?: (typeof INSTALL_METHODS)[number];
  color: string;
  lineStyle: (typeof LINE_STYLES)[number];
}

export interface WireDto {
  id: string;
  label: string | null;
  from: WireEndDto;
  to: WireEndDto;
  /** Interior bend points in plan coordinates (not including the two ends). */
  points: Vec2[];
  cable: CableDto;
  circuitId: string | null;
  description: string | null;
}

const COORD = z.number().finite().min(-100_000).max(100_000);
const wireEndSchema = z.object({
  componentId: z.uuid().nullable(),
  portId: z.string().min(1).max(40).nullable(),
  x: COORD,
  y: COORD,
});

export const cableSchema = z.object({
  cableType: z.enum(CABLE_TYPES).optional(),
  conductors: z.number().int().min(1).max(61).optional(),
  crossSectionMm2: z.number().positive().max(1000).optional(),
  voltage: z.number().positive().max(1000).optional(),
  installMethod: z.enum(INSTALL_METHODS).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a #rrggbb value.'),
  lineStyle: z.enum(LINE_STYLES),
});

export const wireSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().max(40).nullable(),
  from: wireEndSchema,
  to: wireEndSchema,
  points: z.array(z.object({ x: COORD, y: COORD })).max(500),
  cable: cableSchema,
  circuitId: z.uuid().nullable(),
  description: z.string().max(2000).nullable(),
});

export const DEFAULT_CABLE: CableDto = {
  cableType: 'NYM-J',
  conductors: 3,
  crossSectionMm2: 1.5,
  voltage: 230,
  installMethod: 'In conduit in wall',
  color: '#111827',
  lineStyle: 'solid',
};

/** Plan position of a component port (port offsets rotate with the component). */
export function portPosition(c: Pick<ComponentDto, 'x' | 'y' | 'rotation' | 'typeKey'>, portId: string | null): Vec2 {
  const port = componentType(c.typeKey)?.ports.find((p) => p.id === portId) ?? componentType(c.typeKey)?.ports[0];
  if (!port || (port.offsetMm.x === 0 && port.offsetMm.y === 0)) return { x: c.x, y: c.y };
  const a = (c.rotation * Math.PI) / 180;
  const ox = port.offsetMm.x * MM_TO_PT;
  const oy = port.offsetMm.y * MM_TO_PT;
  return { x: c.x + ox * Math.cos(a) - oy * Math.sin(a), y: c.y + ox * Math.sin(a) + oy * Math.cos(a) };
}

export type ComponentLookup = (id: string) => Pick<ComponentDto, 'x' | 'y' | 'rotation' | 'typeKey'> | undefined;

export function endPosition(end: WireEndDto, lookup: ComponentLookup): Vec2 {
  const c = end.componentId ? lookup(end.componentId) : undefined;
  return c ? portPosition(c, end.portId) : { x: end.x, y: end.y };
}

/** Full route of a wire: start, bend points, end. */
export function wireRoute(w: Pick<WireDto, 'from' | 'to' | 'points'>, lookup: ComponentLookup): Vec2[] {
  return [endPosition(w.from, lookup), ...w.points, endPosition(w.to, lookup)];
}

/** Route length in plan units. Multiply by Calibration.metresPerUnit for metres. */
export function wireLengthUnits(w: Pick<WireDto, 'from' | 'to' | 'points'>, lookup: ComponentLookup): number {
  return polylineLength(wireRoute(w, lookup));
}

/** Shortest distance from a point to a polyline. */
export function distanceToPolyline(p: Vec2, pts: readonly Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distanceToSegment(p, pts[i - 1]!, pts[i]!));
  if (pts.length === 1) best = distance(p, pts[0]!);
  return best;
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Topmost wire whose route passes within `tolerance` plan units of p. */
export function hitTestWire<T extends WireDto>(wires: readonly T[], p: Vec2, tolerance: number, lookup: ComponentLookup): T | null {
  for (let i = wires.length - 1; i >= 0; i--) {
    const w = wires[i]!;
    if (distanceToPolyline(p, wireRoute(w, lookup)) <= tolerance) return w;
  }
  return null;
}

/** Does this wire end attach to one of the given component ids? */
export function attachedTo(w: Pick<WireDto, 'from' | 'to'>, ids: ReadonlySet<string>): { from: boolean; to: boolean } {
  return {
    from: !!w.from.componentId && ids.has(w.from.componentId),
    to: !!w.to.componentId && ids.has(w.to.componentId),
  };
}

/** Detaches wire ends from components, leaving free ends where the ports were. */
export function detachEnds<T extends WireDto>(w: T, ids: ReadonlySet<string>, lookup: ComponentLookup): T {
  const a = attachedTo(w, ids);
  if (!a.from && !a.to) return w;
  const detach = (e: WireEndDto) => ({ componentId: null, portId: null, ...endPosition(e, lookup) });
  return { ...w, from: a.from ? detach(w.from) : w.from, to: a.to ? detach(w.to) : w.to };
}

/** Refreshes the cached x/y of attached ends from their components (keeps stored data consistent). */
export function syncEnds<T extends WireDto>(w: T, lookup: ComponentLookup): T {
  const fix = (e: WireEndDto): WireEndDto => {
    if (!e.componentId) return e;
    const p = endPosition(e, lookup);
    return p.x === e.x && p.y === e.y ? e : { ...e, ...p };
  };
  const from = fix(w.from);
  const to = fix(w.to);
  return from === w.from && to === w.to ? w : { ...w, from, to };
}

/** SVG stroke-dasharray for a line style, in plan units (scaled from paper mm). */
export function dashArray(style: CableDto['lineStyle']): string | null {
  const mm = (v: number) => +(v * MM_TO_PT).toFixed(3);
  switch (style) {
    case 'dashed':
      return `${mm(3)} ${mm(1.5)}`;
    case 'dotted':
      return `${mm(0.4)} ${mm(1)}`;
    case 'dash-dot':
      return `${mm(3)} ${mm(1)} ${mm(0.4)} ${mm(1)}`;
    default:
      return null;
  }
}

/** Short cable description, e.g. "NYM-J 3×1.5 mm²". */
export function cableSummary(c: CableDto): string {
  const parts = [c.cableType ?? 'Cable'];
  if (c.conductors && c.crossSectionMm2) parts.push(`${c.conductors}×${c.crossSectionMm2} mm²`);
  else if (c.crossSectionMm2) parts.push(`${c.crossSectionMm2} mm²`);
  return parts.join(' ');
}
