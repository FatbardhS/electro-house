import { Injectable, computed, signal } from '@angular/core';
import type { Vec2 } from '@electro/shared';

export type ToolId = 'pan' | 'measure' | 'calibrate';

export type CalibrationStep = 'pick-first' | 'pick-second' | 'enter-distance';

/**
 * Transient tool state for one editor (what is being measured / picked right now).
 * Nothing here is persisted; persisted floor data lives in FloorSync.
 */
@Injectable()
export class ToolsStore {
  readonly tool = signal<ToolId>('pan');
  /** Cursor position in plan coordinates while over the plan; null when outside. */
  readonly cursor = signal<Vec2 | null>(null);
  /** True while Shift is held: constrain to horizontal/vertical on screen. */
  readonly orthogonal = signal(false);

  // Measure tool
  readonly measurePoints = signal<Vec2[]>([]);
  readonly measureFinished = signal(false);

  // Calibrate tool (two-point method)
  readonly calibrationPoints = signal<Vec2[]>([]);
  readonly calibrationStep = computed<CalibrationStep>(() => {
    const n = this.calibrationPoints().length;
    return n === 0 ? 'pick-first' : n === 1 ? 'pick-second' : 'enter-distance';
  });

  setTool(tool: ToolId): void {
    if (this.tool() === tool) return;
    this.tool.set(tool);
    this.clearMeasure();
    this.calibrationPoints.set([]);
  }

  // ── measure ──
  addMeasurePoint(p: Vec2): void {
    if (this.measureFinished()) {
      this.measurePoints.set([p]);
      this.measureFinished.set(false);
      return;
    }
    const pts = this.measurePoints();
    const last = pts[pts.length - 1];
    if (last && last.x === p.x && last.y === p.y) return; // ignore double-click duplicate
    this.measurePoints.set([...pts, p]);
  }

  finishMeasure(): void {
    if (this.measurePoints().length >= 2) this.measureFinished.set(true);
  }

  undoMeasurePoint(): void {
    this.measureFinished.set(false);
    this.measurePoints.update((pts) => pts.slice(0, -1));
  }

  clearMeasure(): void {
    this.measurePoints.set([]);
    this.measureFinished.set(false);
  }

  // ── calibrate ──
  addCalibrationPoint(p: Vec2): void {
    const pts = this.calibrationPoints();
    if (pts.length >= 2) return;
    this.calibrationPoints.set([...pts, p]);
  }

  resetCalibration(): void {
    this.calibrationPoints.set([]);
  }
}

/**
 * Constrains `p` so the segment from `anchor` is horizontal or vertical on screen.
 * Works in screen space, then maps back, so it stays correct when the plan is rotated.
 */
export function constrainOrthogonal(
  anchor: Vec2,
  p: Vec2,
  toScreen: (v: Vec2) => Vec2,
  toPlan: (v: Vec2) => Vec2,
): Vec2 {
  const a = toScreen(anchor);
  const b = toScreen(p);
  const snapped = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  return toPlan(snapped);
}
