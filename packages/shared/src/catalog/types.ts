import type { Vec2 } from '../geometry/vec.js';

/** Drawing layers of a floor (the PDF background is not a layer here: it is the plan itself). */
export const LAYER_KEYS = [
  'wiring',
  'lighting',
  'outlets',
  'switches',
  'data',
  'smart',
  'distribution',
  'annotations',
] as const;
export type LayerKey = (typeof LAYER_KEYS)[number];

export const LAYER_NAMES: Record<LayerKey, string> = {
  wiring: 'Electrical wiring',
  lighting: 'Lighting',
  outlets: 'Power outlets',
  switches: 'Switches',
  data: 'Data & communication',
  smart: 'Smart home',
  distribution: 'Distribution & energy',
  annotations: 'Annotations',
};

export const CATEGORIES = [
  'lighting',
  'outlets',
  'switches',
  'distribution',
  'communication',
  'smart',
  'renewable',
  'annotation',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_NAMES: Record<Category, string> = {
  lighting: 'Lighting',
  outlets: 'Power outlets',
  switches: 'Switches',
  distribution: 'Distribution & protection',
  communication: 'Communication & security',
  smart: 'Smart home',
  renewable: 'Renewable energy & EV',
  annotation: 'Annotations',
};

/**
 * Symbol drawing primitives in paper millimetres around (0,0), y down.
 * Kept as plain data (not SVG markup) so both the SVG editor and the PDF exporter can draw them.
 */
export type SymbolPrimitive =
  | { kind: 'path'; d: string; fill?: 'none' | 'stroke' | 'paper' }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: 'none' | 'stroke' | 'paper' }
  | { kind: 'text'; x: number; y: number; text: string; size: number };

export interface SymbolDef {
  primitives: SymbolPrimitive[];
  /** Radius (mm) of the clickable / selectable area around the insertion point. */
  hitRadiusMm: number;
}

export interface PortDef {
  id: string;
  /** Offset from the insertion point in paper millimetres (rotates with the component). */
  offsetMm: Vec2;
}

/** Field shown in the properties panel and validated on the server. */
export type PropertyField =
  | { key: string; label: string; kind: 'number'; unit?: string; min?: number; max?: number; integer?: boolean }
  | { key: string; label: string; kind: 'select'; options: readonly string[] }
  | { key: string; label: string; kind: 'text'; maxLength?: number }
  | { key: string; label: string; kind: 'boolean' };

export interface ComponentType {
  /** Stable identifier stored with every placed component. Never renamed or reused. */
  key: string;
  version: number;
  category: Category;
  name: string;
  defaultLayer: LayerKey;
  labelPrefix: string;
  symbol: SymbolDef;
  ports: PortDef[];
  fields: PropertyField[];
  /** Default property values for new components. */
  defaults: Record<string, unknown>;
  /** Typical mounting height above finished floor, used as the default for new components. */
  defaultMountHeightMm?: number;
  /** Search keywords besides the name. */
  keywords?: string[];
}
