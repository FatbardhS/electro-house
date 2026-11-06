import { z } from 'zod';
import { LAYER_KEYS } from '../catalog/types.js';

export const EXPORT_SECTIONS = ['cover', 'floors', 'legend', 'circuits', 'boards', 'links', 'bom', 'costs'] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export const EXPORT_SECTION_NAMES: Record<ExportSection, string> = {
  cover: 'Cover page',
  floors: 'Floor plans',
  legend: 'Legend (symbols used)',
  circuits: 'Circuit list',
  boards: 'Distribution board schedules',
  links: 'Floor connections',
  bom: 'Bill of materials',
  costs: 'Cost report',
};

/** ISO 216 sheet sizes in millimetres (portrait). "plan" = the size of each floor's own plan page. */
export const PAPER_SIZES_MM = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A2: { width: 420, height: 594 },
  A1: { width: 594, height: 841 },
} as const;
export const PAPER_OPTIONS = ['A4', 'A3', 'A2', 'A1', 'plan'] as const;
export type PaperOption = (typeof PAPER_OPTIONS)[number];

export const exportOptionsSchema = z.object({
  sections: z.array(z.enum(EXPORT_SECTIONS)).min(1, 'Choose at least one section.').max(EXPORT_SECTIONS.length),
  /** Floors to draw in the "floors" section, in the order given. Empty = all floors. */
  floorIds: z.array(z.uuid()).max(200),
  /** Layers left out of the floor plans and the legend. */
  hiddenLayers: z.array(z.enum(LAYER_KEYS)).max(LAYER_KEYS.length),
  /** Paper for floor plans. Schedules and reports always use A4. */
  paper: z.enum(PAPER_OPTIONS),
  orientation: z.enum(['auto', 'portrait', 'landscape']),
  /** Grouping of the bill of materials. */
  bomGrouping: z.enum(['project', 'floor', 'circuit']),
});
export type ExportOptions = z.infer<typeof exportOptionsSchema>;

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  sections: [...EXPORT_SECTIONS],
  floorIds: [],
  hiddenLayers: [],
  paper: 'A3',
  orientation: 'auto',
  bomGrouping: 'project',
};
