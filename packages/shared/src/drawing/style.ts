import { MM_TO_PT } from '../catalog/catalog.js';
import type { LayerKey } from '../catalog/types.js';
import type { Vec2 } from '../geometry/vec.js';
import { hitRadius, type ComponentDto } from './drawing.js';

/** Drawing style shared by the SVG editor and the PDF export, so printed plans look like the screen. */

/** Colour per layer, chosen to read well on white paper and be distinguishable from each other. */
export const LAYER_COLORS: Record<LayerKey, string> = {
  wiring: '#111827',
  lighting: '#c2410c',
  outlets: '#1d4ed8',
  switches: '#7e22ce',
  data: '#0e7490',
  smart: '#be185d',
  distribution: '#b91c1c',
  annotations: '#374151',
};

/** Stroke width of symbols in paper millimetres (≈ a 0.25 mm pen). */
export const SYMBOL_STROKE_MM = 0.25;
/** Wire line width in paper millimetres. */
export const WIRE_WIDTH_MM = 0.5;
/** Label text height in paper millimetres. */
export const LABEL_SIZE_MM = 2.2;

/** Where a component's label is drawn (top-right of the symbol), in plan units. */
export function componentLabelPosition(c: Pick<ComponentDto, 'x' | 'y' | 'typeKey'>): Vec2 {
  const r = hitRadius(c);
  return { x: c.x + r * 0.9, y: c.y - r * 0.9 };
}

/** Where a wire's label is drawn: above the middle of its longest segment, in plan units. */
export function wireLabelPosition(route: readonly Vec2[]): Vec2 {
  let best = 0;
  let at = route[0] ?? { x: 0, y: 0 };
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) {
      best = len;
      at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 1.2 * MM_TO_PT };
    }
  }
  return at;
}

/** Text shown as a component's label (notes show their text). */
export function componentLabelText(c: Pick<ComponentDto, 'typeKey' | 'label' | 'properties'>): string | null {
  const note = c.typeKey === 'annotation.note' ? String(c.properties['text'] ?? '') : '';
  return note || c.label;
}

/** "#rrggbb" → [r, g, b] in 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
}
