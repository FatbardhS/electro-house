import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  PLAN_ROTATIONS,
  fitToViewport,
  invertMatrix,
  normalizeRotation,
  pageScreenRect,
  planToScreen,
  planToScreenMatrix,
  rotateView,
  rotatedSize,
  screenToPlan,
  zoomAt,
  type ViewState,
} from './view-transform.js';
import { polylineLength } from './vec.js';

const A3_LANDSCAPE = { width: 1190.55, height: 841.89 };

function view(partial: Partial<ViewState> = {}): ViewState {
  return { page: A3_LANDSCAPE, rotation: 0, zoom: 1, pan: { x: 0, y: 0 }, ...partial };
}

function expectClose(a: { x: number; y: number }, b: { x: number; y: number }, digits = 6) {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
}

describe('plan <-> screen transform', () => {
  const samples = [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
    { x: 1190.55, y: 841.89 },
    { x: 333.3, y: 777.7 },
  ];

  for (const rotation of PLAN_ROTATIONS) {
    for (const zoom of [0.05, 0.5, 1, 3.7, 40]) {
      it(`round-trips plan -> screen -> plan at rotation ${rotation}, zoom ${zoom}`, () => {
        const v = view({ rotation, zoom, pan: { x: 123.4, y: -56.7 } });
        for (const p of samples) {
          expectClose(screenToPlan(v, planToScreen(v, p)), p);
        }
      });
    }
  }

  it('maps page corners like PDF.js clockwise rotation', () => {
    const { width: W, height: H } = A3_LANDSCAPE;
    // 90° clockwise: plan top-left lands on the rotated box's top-right.
    expectClose(planToScreen(view({ rotation: 90 }), { x: 0, y: 0 }), { x: H, y: 0 });
    expectClose(planToScreen(view({ rotation: 90 }), { x: W, y: 0 }), { x: H, y: W });
    // 180°: top-left goes to bottom-right.
    expectClose(planToScreen(view({ rotation: 180 }), { x: 0, y: 0 }), { x: W, y: H });
    // 270°: top-left goes to bottom-left.
    expectClose(planToScreen(view({ rotation: 270 }), { x: 0, y: 0 }), { x: 0, y: W });
  });

  it('keeps the whole page inside the rotated box for every rotation', () => {
    for (const rotation of PLAN_ROTATIONS) {
      const v = view({ rotation });
      const size = rotatedSize(A3_LANDSCAPE, rotation);
      for (const corner of [
        { x: 0, y: 0 },
        { x: A3_LANDSCAPE.width, y: 0 },
        { x: 0, y: A3_LANDSCAPE.height },
        { x: A3_LANDSCAPE.width, y: A3_LANDSCAPE.height },
      ]) {
        const s = planToScreen(v, corner);
        expect(s.x).toBeGreaterThanOrEqual(-1e-9);
        expect(s.y).toBeGreaterThanOrEqual(-1e-9);
        expect(s.x).toBeLessThanOrEqual(size.width + 1e-9);
        expect(s.y).toBeLessThanOrEqual(size.height + 1e-9);
      }
    }
  });

  it('preserves lengths up to the zoom factor (rotation does not distort)', () => {
    const pts = [
      { x: 10, y: 10 },
      { x: 400, y: 10 },
      { x: 400, y: 300 },
    ];
    for (const rotation of PLAN_ROTATIONS) {
      const v = view({ rotation, zoom: 2.5 });
      const screenPts = pts.map((p) => planToScreen(v, p));
      expect(polylineLength(screenPts)).toBeCloseTo(polylineLength(pts) * 2.5, 9);
    }
  });

  it('inverts matrices exactly', () => {
    const m = planToScreenMatrix(view({ rotation: 270, zoom: 3, pan: { x: 7, y: 9 } }));
    const inv = invertMatrix(m);
    const p = { x: 42, y: 17 };
    const there = { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
    expectClose({ x: inv.a * there.x + inv.c * there.y + inv.e, y: inv.b * there.x + inv.d * there.y + inv.f }, p);
  });
});

describe('zoomAt', () => {
  it('keeps the plan point under the cursor fixed', () => {
    for (const rotation of PLAN_ROTATIONS) {
      const v = view({ rotation, zoom: 0.8, pan: { x: 30, y: 40 } });
      const cursor = { x: 412, y: 233 };
      const before = screenToPlan(v, cursor);
      const zoomed = zoomAt(v, cursor, 2.4);
      expect(zoomed.zoom).toBe(2.4);
      expectClose(planToScreen(zoomed, before), cursor);
    }
  });

  it('clamps to the allowed zoom range', () => {
    expect(zoomAt(view(), { x: 0, y: 0 }, 1e9).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(view(), { x: 0, y: 0 }, 0).zoom).toBe(MIN_ZOOM);
  });

  it('never changes stored plan coordinates (it only returns a new view)', () => {
    const v = view();
    const frozen = Object.freeze({ ...v, pan: Object.freeze({ ...v.pan }), page: Object.freeze({ ...v.page }) });
    expect(() => zoomAt(frozen, { x: 10, y: 10 }, 2)).not.toThrow();
  });
});

describe('fitToViewport', () => {
  const viewport = { width: 1600, height: 900 };

  for (const rotation of PLAN_ROTATIONS) {
    it(`fits and centres the page at rotation ${rotation}`, () => {
      const fitted = fitToViewport(view({ rotation, zoom: 7, pan: { x: -999, y: 999 } }), viewport, 20);
      const rect = pageScreenRect(fitted);
      expect(rect.x).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(rect.y).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width - 20 + 1e-9);
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height - 20 + 1e-9);
      // centred
      expect(rect.x + rect.width / 2).toBeCloseTo(viewport.width / 2, 9);
      expect(rect.y + rect.height / 2).toBeCloseTo(viewport.height / 2, 9);
      // touches at least one padded edge (largest possible zoom)
      const touchesX = Math.abs(rect.width - (viewport.width - 40)) < 1e-6;
      const touchesY = Math.abs(rect.height - (viewport.height - 40)) < 1e-6;
      expect(touchesX || touchesY).toBe(true);
    });
  }
});

describe('rotateView', () => {
  it('keeps the anchor point fixed when rotating', () => {
    const v = view({ zoom: 1.7, pan: { x: 50, y: 80 } });
    const anchor = { x: 800, y: 450 };
    const planAtAnchor = screenToPlan(v, anchor);
    for (const rotation of PLAN_ROTATIONS) {
      const r = rotateView(v, rotation, anchor);
      expect(r.rotation).toBe(rotation);
      expect(r.zoom).toBe(1.7);
      expectClose(planToScreen(r, planAtAnchor), anchor);
    }
  });

  it('normalizes arbitrary angles to quarter turns', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(181)).toBe(180);
  });
});
