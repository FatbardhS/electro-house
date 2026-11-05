import { METRES_PER_PDF_POINT, rotatedSize, screenToPlan, type Size, type ViewState } from '@electro/shared';

/** Grid lines are never drawn closer together than this on screen. */
export const MIN_GRID_PX = 14;

export interface GridSpec {
  /** Distance between minor lines in plan units. */
  step: number;
  /** Every `majorEvery`-th line is emphasised. */
  majorEvery: number;
  /** Human label for one minor step, e.g. "1 m" or "10 mm on paper". */
  label: string;
}

const NICE = [1, 2, 5];

/**
 * Picks a grid step: real-world metres when the floor is calibrated, paper millimetres otherwise.
 * The step grows in 1-2-5 steps so lines stay at least MIN_GRID_PX apart at any zoom.
 */
export function gridSpec(zoom: number, metresPerUnit: number | null): GridSpec {
  const unitMetres = metresPerUnit ?? METRES_PER_PDF_POINT; // calibrated: real metres; else paper metres
  const baseMetres = metresPerUnit ? 0.1 : 0.001; // start at 10 cm real, or 1 mm on paper
  for (let decade = 0; decade < 12; decade++) {
    for (const n of NICE) {
      const metres = baseMetres * n * 10 ** decade;
      const step = metres / unitMetres;
      if (step * zoom >= MIN_GRID_PX) {
        return { step, majorEvery: n === 2 ? 5 : n === 5 ? 2 : 10, label: formatStep(metres, !!metresPerUnit) };
      }
    }
  }
  return { step: 1e6, majorEvery: 10, label: '' };
}

function formatStep(metres: number, real: boolean): string {
  const suffix = real ? '' : ' on paper';
  if (metres >= 1) return `${+metres.toFixed(2)} m${suffix}`;
  if (metres >= 0.01) return `${+(metres * 100).toFixed(1)} cm${suffix}`;
  return `${+(metres * 1000).toFixed(1)} mm${suffix}`;
}

export interface GridLines {
  vertical: { x: number; major: boolean }[];
  horizontal: { y: number; major: boolean }[];
  /** Plan-space extent the lines span (clipped to the page). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Grid lines (plan coordinates) covering the part of the page visible in the viewport. */
export function visibleGridLines(view: ViewState, viewport: Size, spec: GridSpec): GridLines {
  const corners = [
    { x: 0, y: 0 },
    { x: viewport.width, y: 0 },
    { x: 0, y: viewport.height },
    { x: viewport.width, y: viewport.height },
  ].map((p) => screenToPlan(view, p));
  const { width: W, height: H } = view.page;
  const x0 = Math.max(0, Math.min(...corners.map((c) => c.x)));
  const x1 = Math.min(W, Math.max(...corners.map((c) => c.x)));
  const y0 = Math.max(0, Math.min(...corners.map((c) => c.y)));
  const y1 = Math.min(H, Math.max(...corners.map((c) => c.y)));

  const vertical: GridLines['vertical'] = [];
  const horizontal: GridLines['horizontal'] = [];
  if (x1 <= x0 || y1 <= y0) return { vertical, horizontal, x0, x1, y0, y1 };

  // Hard cap protects against pathological inputs; MIN_GRID_PX keeps real counts far below this.
  const maxLines = Math.ceil(Math.max(rotatedSize(viewport, 0).width, viewport.height) / MIN_GRID_PX) * 2 + 4;
  for (let i = Math.ceil(x0 / spec.step); i * spec.step <= x1 && vertical.length < maxLines; i++) {
    vertical.push({ x: i * spec.step, major: i % spec.majorEvery === 0 });
  }
  for (let i = Math.ceil(y0 / spec.step); i * spec.step <= y1 && horizontal.length < maxLines; i++) {
    horizontal.push({ y: i * spec.step, major: i % spec.majorEvery === 0 });
  }
  return { vertical, horizontal, x0, x1, y0, y1 };
}
