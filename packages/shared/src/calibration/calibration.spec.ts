import { describe, expect, it } from 'vitest';
import {
  CalibrationError,
  METRES_PER_PDF_POINT,
  calibratePaperScale,
  calibrateTwoPoint,
  equivalentPaperScale,
  formatMetres,
  measureMetres,
} from './calibration.js';
import { calibrationSchema } from '../schemas/schemas.js';

describe('two-point calibration', () => {
  it('computes metres per plan unit from a known distance', () => {
    // 4 m wall drawn as 226.77 pt (= 80 mm on paper → 1:50)
    const cal = calibrateTwoPoint({ x: 100, y: 100 }, { x: 326.77, y: 100 }, 4000);
    expect(cal.metresPerUnit).toBeCloseTo(4 / 226.77, 12);
    expect(equivalentPaperScale(cal)).toBeCloseTo(50, 1);
  });

  it('works for diagonal reference lines', () => {
    const cal = calibrateTwoPoint({ x: 0, y: 0 }, { x: 300, y: 400 }, 5000); // 500 units = 5 m
    expect(cal.metresPerUnit).toBeCloseTo(0.01, 12);
    expect(measureMetres([{ x: 0, y: 0 }, { x: 0, y: 250 }], cal)).toBeCloseTo(2.5, 12);
  });

  it('rejects zero, negative and non-numeric distances', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calibrateTwoPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, bad)).toThrow(CalibrationError);
    }
  });

  it('rejects points that are too close together', () => {
    expect(() => calibrateTwoPoint({ x: 5, y: 5 }, { x: 5, y: 5 }, 1000)).toThrow(CalibrationError);
    expect(() => calibrateTwoPoint({ x: 5, y: 5 }, { x: 9, y: 5 }, 1000)).toThrow(/too close/);
  });

  it('produces data that passes the API schema', () => {
    const cal = calibrateTwoPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 1000);
    expect(calibrationSchema.safeParse(cal).success).toBe(true);
  });
});

describe('paper-scale calibration', () => {
  it('1:50 means one PDF point is 17.64 mm', () => {
    const cal = calibratePaperScale(50);
    expect(cal.metresPerUnit).toBeCloseTo(0.017638888, 8);
    expect(cal.metresPerUnit).toBe(METRES_PER_PDF_POINT * 50);
  });

  it('rejects invalid scales', () => {
    expect(() => calibratePaperScale(0)).toThrow(CalibrationError);
    expect(() => calibratePaperScale(-100)).toThrow(CalibrationError);
  });

  it('agrees with a two-point calibration on the same drawing', () => {
    const paper = calibratePaperScale(100);
    // 1:100 → a 6 m wall is 60 mm on paper = 170.0787 pt
    const twoPoint = calibrateTwoPoint({ x: 0, y: 0 }, { x: 60 / 25.4 * 72, y: 0 }, 6000);
    expect(twoPoint.metresPerUnit).toBeCloseTo(paper.metresPerUnit, 12);
  });
});

describe('measuring', () => {
  it('returns null when the floor is not calibrated', () => {
    expect(measureMetres([{ x: 0, y: 0 }, { x: 10, y: 0 }], null)).toBeNull();
    expect(formatMetres(null)).toBe('not calibrated');
  });

  it('sums multi-segment routes', () => {
    const cal = calibratePaperScale(50);
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 30, y: 50 },
    ];
    expect(measureMetres(pts, cal)).toBeCloseTo(220 * cal.metresPerUnit, 12);
  });

  it('formats lengths', () => {
    expect(formatMetres(4)).toBe('4.00 m');
    expect(formatMetres(0.456)).toBe('45.6 cm');
  });
});
