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
import { MM_TO_PT, componentType, dashArray, hitRadius, planToScreen as toScreenAt, portPosition, wireRoute } from '@electro/shared';
import { wireHandles } from './wire-handles';
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

          <!-- Wires (drawn under the symbols, whose paper fill hides the wire ends) -->
          <g class="wires" fill="none" stroke-linejoin="round" stroke-linecap="round">
            @for (w of wireItems(); track w.id) {
              @if (w.selected) {
                <polyline class="wire-sel" [attr.points]="w.points" vector-effect="non-scaling-stroke" />
              }
              <polyline [attr.points]="w.points" [attr.stroke]="w.color" [attr.stroke-width]="wireWidth" [attr.stroke-dasharray]="w.dash"
                        [style.opacity]="w.dim ? 0.15 : null" />
              @if (w.label) {
                <text class="label" [attr.x]="w.labelAt.x" [attr.y]="w.labelAt.y" [attr.font-size]="labelSize" [style.fill]="w.color">{{ w.label }}</text>
              }
            }
            @if (draft(); as d) {
              <polyline class="wire-draft" [attr.points]="d.points" [attr.stroke]="d.color" [attr.stroke-width]="wireWidth" />
            }
          </g>

          <!-- Electrical components, by layer, in draw order -->
          <g class="components">
            @for (c of items(); track c.id) {
              <g [attr.transform]="c.transform" [style.color]="c.color" [style.opacity]="c.dim ? 0.18 : null">
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
          @for (r of connectRings(); track r.id) {
            <circle [class]="'connect connect-' + r.kind" [attr.cx]="r.x" [attr.cy]="r.y" [attr.r]="r.r" vector-effect="non-scaling-stroke" />
          }
          @if (ghost(); as g) {
            <g class="ghost" [attr.transform]="g.transform" [style.color]="g.color"><use [attr.href]="g.href" /></g>
          }
        </g>
        @for (h of handles(); track $index) {
          <circle [class]="'handle handle-' + h.kind" [attr.cx]="h.x" [attr.cy]="h.y" [attr.r]="h.kind === 'mid' ? 4 : 5" />
        }
        @if (draftLabel(); as l) {
          <g class="measure" [attr.transform]="'translate(' + l.at.x + ' ' + l.at.y + ')'">
            <rect x="10" y="-26" [attr.width]="l.text.length * 7.2 + 14" height="22" rx="4" />
            <text x="17" y="-11">{{ l.text }}</text>
          </g>
        }
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
    .connect { fill: rgba(56, 138, 221, 0.12); stroke: #378add; stroke-width: 2; }
    .connect-target { fill: rgba(62, 207, 142, 0.18); stroke: #16a34a; stroke-width: 2.5; }
    .wire-sel { stroke: rgba(62, 207, 142, 0.45); stroke-width: 9; }
    .wire-draft { opacity: 0.75; stroke-dasharray: 6 4; }
    .handle { stroke: #16a34a; stroke-width: 1.5; }
    .handle-vertex, .handle-end { fill: #fff; }
    .handle-mid { fill: rgba(62, 207, 142, 0.35); }
    .select-box { fill: rgba(62, 207, 142, 0.08); stroke: #3ecf8e; stroke-width: 1; stroke-dasharray: 5 3; }
  `,
})
export class DrawingLayer {
  private readonly viewport = inject(ViewportStore);
  private readonly tools = inject(ToolsStore);
  private readonly drawing = inject(DrawingStore);

  /** Cable line width: 0.5 mm on paper. */
  protected readonly wireWidth = 0.5 * MM_TO_PT;

  protected readonly wireItems = computed(() => {
    const lookup = this.drawing.lookup();
    const sel = this.drawing.selection();
    const hl = this.drawing.highlightCircuit();
    return this.drawing.visibleWires().map((w) => {
      const route = wireRoute(w, lookup);
      // label at the middle of the longest segment
      let best = 0;
      let at = route[0]!;
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1]!;
        const b = route[i]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > best) {
          best = len;
          at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 1.2 * MM_TO_PT };
        }
      }
      return {
        id: w.id,
        points: route.map((p) => `${p.x},${p.y}`).join(' '),
        color: w.cable.color,
        dash: dashArray(w.cable.lineStyle),
        selected: sel.has(w.id),
        dim: !!hl && w.circuitId !== hl,
        label: w.label,
        labelAt: at,
      };
    });
  });

  /** The wire being drawn, from its start through the clicked bends to the cursor. */
  private readonly draftRoute = computed(() => {
    const d = this.tools.wireDraft();
    if (!d || this.tools.tool() !== 'wire') return null;
    const c = d.from.componentId ? this.drawing.byId().get(d.from.componentId) : undefined;
    const start = c ? portPosition(c, d.from.portId) : { x: d.from.x, y: d.from.y };
    const cursor = this.tools.cursor();
    return [start, ...d.points, ...(cursor ? [cursor] : [])];
  });
  protected readonly draft = computed(() => {
    const r = this.draftRoute();
    return r ? { points: r.map((p) => `${p.x},${p.y}`).join(' '), color: this.tools.wireCable().color } : null;
  });
  protected readonly draftLabel = computed(() => {
    const r = this.draftRoute();
    const view = this.viewport.view();
    if (!r || r.length < 2 || !view) return null;
    return { text: formatMetres(measureMetres(r, this.calibrationData())), at: toScreenAt(view, r[r.length - 1]!) };
  });

  /** Edit handles of a single selected wire (screen space). */
  protected readonly handles = computed(() => {
    const wires = this.drawing.selectedWires();
    const view = this.viewport.view();
    if (wires.length !== 1 || this.drawing.selected().length || !view) return [];
    return wireHandles(wires[0]!, this.drawing.lookup(), view);
  });

  /** Label text height: 2.2 mm on paper. */
  protected readonly labelSize = 2.2 * MM_TO_PT;

  /** Render data for every visible component (transform strings computed once per change). */
  protected readonly items = computed(() => {
    const hl = this.drawing.highlightCircuit();
    return this.drawing.visible().map((c) => {
      const type = componentType(c.typeKey);
      const r = (type?.symbol.hitRadiusMm ?? 3) * MM_TO_PT;
      const note = c.typeKey === 'annotation.note' ? String(c.properties['text'] ?? '') : '';
      return {
        id: c.id,
        transform: componentTransform(c),
        dim: !!hl && c.circuitId !== hl,
        href: `#${symbolId(c.typeKey)}`,
        color: LAYER_COLORS[c.layerKey],
        label: note || c.label,
        labelX: c.x + r * 0.9,
        labelY: c.y - r * 0.9,
      };
    });
  });

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
      transform: componentTransform({ x: at.x, y: at.y, rotation: this.tools.placeRotation() }),
      href: `#${symbolId(type.key)}`,
      color: LAYER_COLORS[type.defaultLayer],
    };
  });

  /** Wire tool: rings on the item the wire starts from and on the item a click would connect to. */
  protected readonly connectRings = computed(() => {
    if (this.tools.tool() !== 'wire') return [];
    const byId = this.drawing.byId();
    const rings: { id: string; x: number; y: number; r: number; kind: 'start' | 'target' }[] = [];
    const startId = this.tools.wireDraft()?.from.componentId;
    const targetId = this.tools.connectTarget();
    for (const [id, kind] of [
      [startId, 'start'],
      [targetId, 'target'],
    ] as const) {
      const c = id ? byId.get(id) : undefined;
      if (c && !rings.some((r) => r.id === c.id)) rings.push({ id: c.id, x: c.x, y: c.y, r: hitRadius(c) * 1.35, kind });
    }
    return rings;
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
