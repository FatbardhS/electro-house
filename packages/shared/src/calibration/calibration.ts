import { distance, polylineLength, type Vec2 } from '../geometry/vec.js';

/** One PDF point is 1/72 inch on paper. Plan units are PDF points. */
export const METRES_PER_PDF_POINT = 0.0254 / 72;

/** Reference points closer together than this (in plan units, ≈ 3.5 mm on paper) are rejected as too imprecise. */
export const MIN_CALIBRATION_SPAN_UNITS = 10;

export type Calibration =
  | {
      method: 'two-point';
      p1: Vec2;
      p2: Vec2;
      realDistanceMm: number;
      metresPerUnit: number;
      calibratedAt: string;
    }
  | {
      method: 'paper-scale';
      /** The N in "1:N", e.g. 50 for 1:50. */
      paperScale: number;
      metresPerUnit: number;
      calibratedAt: string;
    };

export class CalibrationError extends Error {}

/** Scale from two picked plan points and the real distance between them. */
export function calibrateTwoPoint(p1: Vec2, p2: Vec2, realDistanceMm: number, now = new Date()): Calibration {
  if (!Number.isFinite(realDistanceMm) || realDistanceMm <= 0) {
    throw new CalibrationError('The real distance must be a positive number.');
  }
  const span = distance(p1, p2);
  if (!Number.isFinite(span) || span < MIN_CALIBRATION_SPAN_UNITS) {
    throw new CalibrationError('The two points are too close together. Pick a longer known dimension.');
  }
  return {
    method: 'two-point',
    p1,
    p2,
    realDistanceMm,
    metresPerUnit: realDistanceMm / 1000 / span,
    calibratedAt: now.toISOString(),
  };
}

/** Scale from the drawing's paper scale (1:N). Exact for vector PDFs exported at true paper size. */
export function calibratePaperScale(paperScale: number, now = new Date()): Calibration {
  if (!Number.isFinite(paperScale) || paperScale <= 0) {
    throw new CalibrationError('The scale must be a positive number, e.g. 50 for 1:50.');
  }
  return {
    method: 'paper-scale',
    paperScale,
    metresPerUnit: METRES_PER_PDF_POINT * paperScale,
    calibratedAt: now.toISOString(),
  };
}

/** Real-world length in metres of a polyline in plan coordinates, or null when the floor is not calibrated. */
export function measureMetres(points: readonly Vec2[], calibration: Calibration | null | undefined): number | null {
  if (!calibration) return null;
  return polylineLength(points) * calibration.metresPerUnit;
}

/** Equivalent 1:N drawing scale of a calibration (useful to show next to a two-point calibration). */
export function equivalentPaperScale(calibration: Calibration): number {
  return calibration.metresPerUnit / METRES_PER_PDF_POINT;
}

export function formatMetres(metres: number | null): string {
  if (metres === null) return 'not calibrated';
  if (metres < 1) return `${(metres * 100).toFixed(1)} cm`;
  return `${metres.toFixed(2)} m`;
}
