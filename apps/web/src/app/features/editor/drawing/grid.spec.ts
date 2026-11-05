import { METRES_PER_PDF_POINT, planToScreen, type ViewState } from '@electro/shared';
import { MIN_GRID_PX, gridSpec, visibleGridLines } from './grid';
import { constrainOrthogonal } from '../state/tools.store';

const page = { width: 1190.55, height: 841.89 };

describe('gridSpec', () => {
  it('uses real metres when calibrated and keeps lines readable at every zoom', () => {
    const mpu = METRES_PER_PDF_POINT * 50; // 1:50
    for (const zoom of [0.05, 0.3, 1, 4, 20, 60]) {
      const spec = gridSpec(zoom, mpu);
      expect(spec.step * zoom).toBeGreaterThanOrEqual(MIN_GRID_PX);
      // never more than one 1-2-5 step coarser than needed (10 cm is the finest real-world step)
      const finest = 0.1 / mpu;
      if (spec.step > finest + 1e-9) expect(spec.step * zoom).toBeLessThan(MIN_GRID_PX * 5.01);
      expect(spec.label).not.toContain('paper');
    }
  });

  it('a 1 m grid at 1:50 is 56.7 PDF points', () => {
    const mpu = METRES_PER_PDF_POINT * 50;
    const spec = gridSpec(MIN_GRID_PX / 56.69, mpu);
    expect(spec.step).toBeCloseTo(1 / mpu, 6);
    expect(spec.label).toBe('1 m');
  });

  it('falls back to paper millimetres when not calibrated', () => {
    const spec = gridSpec(1, null);
    expect(spec.label).toContain('on paper');
  });
});

describe('visibleGridLines', () => {
  it('only produces lines inside the page and the viewport', () => {
    const view: ViewState = { page, rotation: 0, zoom: 2, pan: { x: -300, y: -200 } };
    const viewport = { width: 800, height: 600 };
    const spec = gridSpec(view.zoom, null);
    const lines = visibleGridLines(view, viewport, spec);
    expect(lines.vertical.length).toBeGreaterThan(0);
    for (const l of lines.vertical) {
      const s = planToScreen(view, { x: l.x, y: 0 });
      expect(s.x).toBeGreaterThanOrEqual(-1e-6);
      expect(s.x).toBeLessThanOrEqual(viewport.width + 1e-6);
      expect(l.x).toBeLessThanOrEqual(page.width);
    }
    expect(lines.vertical.length).toBeLessThanOrEqual(viewport.width / MIN_GRID_PX + 2);
  });

  it('returns nothing when the page is scrolled out of view', () => {
    const view: ViewState = { page, rotation: 0, zoom: 1, pan: { x: 5000, y: 5000 } };
    const lines = visibleGridLines(view, { width: 800, height: 600 }, gridSpec(1, null));
    expect(lines.vertical).toEqual([]);
    expect(lines.horizontal).toEqual([]);
  });
});

describe('constrainOrthogonal', () => {
  it('snaps to screen-horizontal even when the plan is rotated', () => {
    const view: ViewState = { page, rotation: 90, zoom: 1.5, pan: { x: 10, y: 20 } };
    const toScreen = (p: { x: number; y: number }) => planToScreen(view, p);
    const inv = (s: { x: number; y: number }) => {
      // invert via the shared helper
      return screenToPlanLocal(view, s);
    };
    const anchor = { x: 200, y: 300 };
    const raw = { x: 230, y: 120 };
    const snapped = constrainOrthogonal(anchor, raw, toScreen, inv);
    const a = toScreen(anchor);
    const b = toScreen(snapped);
    expect(Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y))).toBeCloseTo(0, 9);
  });
});

import { screenToPlan as screenToPlanLocal } from '@electro/shared';
