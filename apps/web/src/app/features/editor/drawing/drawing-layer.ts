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
import { MM_TO_PT, componentType, hitRadius } from '@electro/shared';
import { ViewportStore } from '../viewport/viewport.store';
import { ToolsStore } from '../state/tools.store';
import { DrawingStore } from '../state/drawing.store';
import { gridSpec, visibleGridLines } from './grid';
import { LAYER_COLORS, symbolId } from './symbol-defs';

/** SVG transform placing a symbol (drawn in paper mm) at a component's plan position and rotation. */
export function componentTransform(c: { x: number; y: number; rotation: number }): string {
  return `translate(${c.x} ${c.y}) rotate(${c.rotation}) scale(${MM_TO_PT})`;
}

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

          <!-- Electrical components, by layer, in draw order -->
          <g class="components">
            @for (c of items(); track c.id) {
              <g [attr.transform]="c.transform" [style.color]="c.color">
                <use [attr.href]="c.href" />
              </g>
              @if (c.label) {
                <text class="label" [attr.x]="c.labelX" [attr.y]="c.labelY" [attr.font-size]="labelSize" [style.fill]="c.color">{{ c.label }}</text>
              }
            }
          </g>
          @for (s of selectionRings(); track s.id) {
            <circle class="selection" [attr.cx]="s.x" [attr.cy]="s.y" [attr.r]="s.r" vector-effect="non-scaling-stroke" />
          }
          @if (ghost(); as g) {
            <g class="ghost" [attr.transform]="g.transform" [style.color]="g.color"><use [attr.href]="g.href" /></g>
          }
        </g>
        @if (box(); as b) {
          <rect class="select-box" [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" />
        }

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
    .label { font-family: Arial, Helvetica, sans-serif; font-weight: 600; paint-order: stroke; stroke: #fff; stroke-width: 0.6px; }
    .selection { fill: rgba(62, 207, 142, 0.12); stroke: #16a34a; stroke-width: 1.5; stroke-dasharray: 4 3; }
    .ghost { opacity: 0.55; }
    .select-box { fill: rgba(62, 207, 142, 0.08); stroke: #3ecf8e; stroke-width: 1; stroke-dasharray: 5 3; }
  `,
})
export class DrawingLayer {
  private readonly viewport = inject(ViewportStore);
  private readonly tools = inject(ToolsStore);
  private readonly drawing = inject(DrawingStore);

  /** Label text height: 2.2 mm on paper. */
  protected readonly labelSize = 2.2 * MM_TO_PT;

  /** Render data for every visible component (transform strings computed once per change). */
  protected readonly items = computed(() =>
    this.drawing.visible().map((c) => {
      const type = componentType(c.typeKey);
      const r = (type?.symbol.hitRadiusMm ?? 3) * MM_TO_PT;
      const note = c.typeKey === 'annotation.note' ? String(c.properties['text'] ?? '') : '';
      return {
        id: c.id,
        transform: componentTransform(c),
        href: `#${symbolId(c.typeKey)}`,
        color: LAYER_COLORS[c.layerKey],
        label: note || c.label,
        labelX: c.x + r * 0.9,
        labelY: c.y - r * 0.9,
      };
    }),
  );

  protected readonly selectionRings = computed(() =>
    this.drawing.selected().map((c) => ({ id: c.id, x: c.x, y: c.y, r: hitRadius(c) * 1.15 })),
  );

  /** Semi-transparent preview of the component about to be placed. */
  protected readonly ghost = computed(() => {
    const key = this.tools.placeType();
    const at = this.tools.cursor();
    const type = key ? componentType(key) : undefined;
    if (this.tools.tool() !== 'place' || !type || !at) return null;
    return {
      transform: componentTransform({ x: at.x, y: at.y, rotation: 0 }),
      href: `#${symbolId(type.key)}`,
      color: LAYER_COLORS[type.defaultLayer],
    };
  });

  protected readonly box = computed(() => {
    const b = this.tools.selectBox();
    if (!b) return null;
    return { x: Math.min(b.a.x, b.b.x), y: Math.min(b.a.y, b.b.y), w: Math.abs(b.b.x - b.a.x), h: Math.abs(b.b.y - b.a.y) };
  });

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
