import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  distance,
  formatMetres,
  matrixToSvg,
  measureMetres,
  planToScreen,
  type Calibration,
  type Vec2,
} from '@electro/shared';
import { ViewportStore } from '../viewport/viewport.store';
import { ToolsStore } from '../state/tools.store';
import { gridSpec, visibleGridLines } from './grid';

/**
 * SVG overlay above the PDF. Plan-space content sits inside one <g> with the view matrix,
 * so zooming/panning only changes that transform. Tool feedback is drawn in screen space for
 * constant-size handles and labels. Electrical layers (Phase 2+) will be added as plan-space groups here.
 */
@Component({
  selector: 'app-drawing-layer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="layer" xmlns="http://www.w3.org/2000/svg">
      @if (svgTransform(); as t) {
        <g [attr.transform]="t">
          @if (showGrid() && grid(); as g) {
            <g class="grid">
              @for (l of g.lines.vertical; track l.x) {
                <line [attr.x1]="l.x" [attr.x2]="l.x" [attr.y1]="g.lines.y0" [attr.y2]="g.lines.y1"
                      [class.major]="l.major" vector-effect="non-scaling-stroke" />
              }
              @for (l of g.lines.horizontal; track l.y) {
                <line [attr.y1]="l.y" [attr.y2]="l.y" [attr.x1]="g.lines.x0" [attr.x2]="g.lines.x1"
                      [class.major]="l.major" vector-effect="non-scaling-stroke" />
              }
            </g>
          }
          <rect class="page-outline" x="0" y="0" [attr.width]="page()!.width" [attr.height]="page()!.height"
                vector-effect="non-scaling-stroke" />
        </g>

        <!-- Screen-space tool feedback -->
        @if (measure(); as m) {
          <g class="measure">
            <polyline [attr.points]="m.points" />
            @for (p of m.handles; track $index) { <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3.5" /> }
            @if (m.label) {
              <g [attr.transform]="'translate(' + m.labelAt.x + ' ' + m.labelAt.y + ')'">
                <rect x="10" y="-26" [attr.width]="m.label.length * 7.2 + 14" height="22" rx="4" />
                <text x="17" y="-11">{{ m.label }}</text>
              </g>
            }
          </g>
        }
        @if (calibration(); as c) {
          <g class="calibration">
            <polyline [attr.points]="c.points" />
            @for (p of c.handles; track $index) {
              <circle [attr.cx]="p.x" [attr.cy]="p.y" r="5" />
              <line [attr.x1]="p.x - 9" [attr.x2]="p.x + 9" [attr.y1]="p.y" [attr.y2]="p.y" />
              <line [attr.y1]="p.y - 9" [attr.y2]="p.y + 9" [attr.x1]="p.x" [attr.x2]="p.x" />
            }
          </g>
        }
      }
    </svg>
  `,
  styles: `
    :host { position: absolute; inset: 0; pointer-events: none; }
    .layer { width: 100%; height: 100%; display: block; overflow: hidden; }
    .grid line { stroke: rgba(46, 140, 100, 0.22); stroke-width: 1; }
    .grid line.major { stroke: rgba(46, 140, 100, 0.45); }
    .page-outline { fill: none; stroke: rgba(255, 255, 255, 0.18); stroke-width: 1; }
    .measure polyline { fill: none; stroke: #ff9f43; stroke-width: 2; }
    .measure circle { fill: #ff9f43; stroke: #1a1206; stroke-width: 1.5; }
    .measure rect { fill: rgba(16, 18, 20, 0.92); stroke: #ff9f43; }
    .measure text { fill: #ffd8b0; font: 600 12px var(--mono); }
    .calibration polyline { fill: none; stroke: #3ecf8e; stroke-width: 2; stroke-dasharray: 6 4; }
    .calibration circle { fill: rgba(62, 207, 142, 0.2); stroke: #3ecf8e; stroke-width: 1.5; }
    .calibration line { stroke: #3ecf8e; stroke-width: 1; }
  `,
})
export class DrawingLayer {
  private readonly viewport = inject(ViewportStore);
  private readonly tools = inject(ToolsStore);

  readonly showGrid = input(true);
  readonly calibrationData = input<Calibration | null>(null);

  protected readonly page = computed(() => this.viewport.view()?.page ?? null);
  protected readonly svgTransform = computed(() => {
    const m = this.viewport.matrix();
    return m ? matrixToSvg(m) : null;
  });

  protected readonly grid = computed(() => {
    const view = this.viewport.view();
    if (!view) return null;
    const spec = gridSpec(view.zoom, this.calibrationData()?.metresPerUnit ?? null);
    return { spec, lines: visibleGridLines(view, this.viewport.size(), spec) };
  });

  /** Measure polyline in screen space, including the rubber-band segment to the cursor. */
  protected readonly measure = computed(() => {
    const view = this.viewport.view();
    if (!view || this.tools.tool() !== 'measure') return null;
    const pts = [...this.tools.measurePoints()];
    const cursor = this.tools.cursor();
    if (pts.length === 0) return null;
    if (!this.tools.measureFinished() && cursor) pts.push(cursor);
    const screen = pts.map((p) => planToScreen(view, p));
    const metres = measureMetres(pts, this.calibrationData());
    const last = screen[screen.length - 1]!;
    return {
      points: screen.map((p) => `${p.x},${p.y}`).join(' '),
      handles: screen.slice(0, this.tools.measureFinished() || !cursor ? screen.length : -1),
      label: pts.length >= 2 ? formatMetres(metres) : '',
      labelAt: last,
    };
  });

  protected readonly calibration = computed(() => {
    const view = this.viewport.view();
    if (!view || this.tools.tool() !== 'calibrate') return null;
    const pts: Vec2[] = [...this.tools.calibrationPoints()];
    const cursor = this.tools.cursor();
    if (pts.length === 1 && cursor && distance(pts[0]!, cursor) > 0) pts.push(cursor);
    if (pts.length === 0) return null;
    const screen = pts.map((p) => planToScreen(view, p));
    return { points: screen.map((p) => `${p.x},${p.y}`).join(' '), handles: screen };
  });
}
