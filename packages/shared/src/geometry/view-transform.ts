import type { Vec2 } from './vec.js';

/**
 * Plan rotation in degrees, clockwise. Same convention as PDF.js `getViewport({ rotation })`.
 * It is a VIEW setting: it never changes stored plan coordinates.
 */
export type PlanRotation = 0 | 90 | 180 | 270;
export const PLAN_ROTATIONS: readonly PlanRotation[] = [0, 90, 180, 270];

export interface Size {
  width: number;
  height: number;
}

/**
 * Everything needed to map plan coordinates to screen pixels.
 * - `page` is the plan page size in plan units (PDF points at scale 1, page's own /Rotate applied).
 * - `zoom` is screen pixels per plan unit.
 * - `pan` is where the top-left corner of the (rotated) page lands on screen.
 */
export interface ViewState {
  page: Size;
  rotation: PlanRotation;
  zoom: number;
  pan: Vec2;
}

/** 2D affine matrix in SVG order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function normalizeRotation(deg: number): PlanRotation {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return r as PlanRotation;
}

/** Page size after rotation (width and height swap at 90° and 270°). */
export function rotatedSize(page: Size, rotation: PlanRotation): Size {
  return rotation === 90 || rotation === 270
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

/**
 * Rotation part only: maps a plan point into the rotated page box, whose top-left is (0,0).
 * 90° clockwise sends the plan's top-left corner to the rotated box's top-right corner.
 */
function rotationMatrix(page: Size, rotation: PlanRotation): Matrix {
  const { width: W, height: H } = page;
  switch (rotation) {
    case 0:
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    case 90: // (x, y) -> (H - y, x)
      return { a: 0, b: 1, c: -1, d: 0, e: H, f: 0 };
    case 180: // (x, y) -> (W - x, H - y)
      return { a: -1, b: 0, c: 0, d: -1, e: W, f: H };
    case 270: // (x, y) -> (y, W - x)
      return { a: 0, b: -1, c: 1, d: 0, e: 0, f: W };
  }
}

/** The full plan → screen matrix: screen = pan + zoom · R(plan). */
export function planToScreenMatrix(view: ViewState): Matrix {
  const r = rotationMatrix(view.page, view.rotation);
  const z = view.zoom;
  return {
    a: r.a * z,
    b: r.b * z,
    c: r.c * z,
    d: r.d * z,
    e: r.e * z + view.pan.x,
    f: r.f * z + view.pan.y,
  };
}

export function applyMatrix(m: Matrix, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function invertMatrix(m: Matrix): Matrix {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0 || !Number.isFinite(det)) {
    throw new Error('Matrix is not invertible');
  }
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export function planToScreen(view: ViewState, p: Vec2): Vec2 {
  return applyMatrix(planToScreenMatrix(view), p);
}

export function screenToPlan(view: ViewState, p: Vec2): Vec2 {
  return applyMatrix(invertMatrix(planToScreenMatrix(view)), p);
}

/** SVG `transform` attribute value for a matrix. */
export function matrixToSvg(m: Matrix): string {
  return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;
}

/** Zoom to `newZoom`, keeping the plan point currently under `screenPoint` exactly where it is. */
export function zoomAt(view: ViewState, screenPoint: Vec2, newZoom: number): ViewState {
  const zoom = clampZoom(newZoom);
  const k = zoom / view.zoom;
  return {
    ...view,
    zoom,
    pan: {
      x: screenPoint.x - (screenPoint.x - view.pan.x) * k,
      y: screenPoint.y - (screenPoint.y - view.pan.y) * k,
    },
  };
}

export function panBy(view: ViewState, delta: Vec2): ViewState {
  return { ...view, pan: { x: view.pan.x + delta.x, y: view.pan.y + delta.y } };
}

/** Zoom and centre so the whole (rotated) page fits inside the viewport with `padding` pixels around it. */
export function fitToViewport(view: ViewState, viewport: Size, padding = 24): ViewState {
  const size = rotatedSize(view.page, view.rotation);
  const availW = Math.max(1, viewport.width - 2 * padding);
  const availH = Math.max(1, viewport.height - 2 * padding);
  const zoom = clampZoom(Math.min(availW / size.width, availH / size.height));
  return {
    ...view,
    zoom,
    pan: {
      x: (viewport.width - size.width * zoom) / 2,
      y: (viewport.height - size.height * zoom) / 2,
    },
  };
}

/** Change the plan rotation, keeping the plan point at `anchor` (usually the viewport centre) fixed on screen. */
export function rotateView(view: ViewState, rotation: PlanRotation, anchor: Vec2): ViewState {
  const planPoint = screenToPlan(view, anchor);
  const rotated: ViewState = { ...view, rotation, pan: { x: 0, y: 0 } };
  const landed = planToScreen(rotated, planPoint);
  return { ...rotated, pan: { x: anchor.x - landed.x, y: anchor.y - landed.y } };
}

/** Axis-aligned screen rectangle covered by the rotated page. */
export function pageScreenRect(view: ViewState): { x: number; y: number; width: number; height: number } {
  const size = rotatedSize(view.page, view.rotation);
  return { x: view.pan.x, y: view.pan.y, width: size.width * view.zoom, height: size.height * view.zoom };
}
