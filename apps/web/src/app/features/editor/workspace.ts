import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { PDFPageProxy } from 'pdfjs-dist';
import {
  createComponent,
  hitTest,
  insideRect,
  planToScreen,
  snapToStep,
  uuidv7,
  type Calibration,
  type ComponentDto,
  type Vec2,
} from '@electro/shared';
import { DrawingLayer } from './drawing/drawing-layer';
import { gridSpec } from './drawing/grid';
import { PdfLayer } from './pdf/pdf-layer';
import { DrawingStore } from './state/drawing.store';
import { ToolsStore, constrainOrthogonal } from './state/tools.store';
import { ViewportStore } from './viewport/viewport.store';

const WHEEL_ZOOM_SPEED = 0.0015;
/** Pointer must move this far (px) before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;
/** Extra pick tolerance around symbols, in screen pixels. */
const PICK_TOLERANCE_PX = 3;
export const DRAG_MIME = 'application/x-electro-component';

type Gesture =
  | { kind: 'pan'; last: Vec2 }
  | { kind: 'move'; start: Vec2; startScreen: Vec2; before: ComponentDto[]; anchor: ComponentDto; dragging: boolean }
  | { kind: 'box'; start: Vec2; additive: boolean };

/**
 * The interactive canvas area. Converts pointer input into plan coordinates and editor actions.
 * Owns no data: it updates the ViewportStore (view), ToolsStore (tool input) and DrawingStore (components).
 */
@Component({
  selector: 'app-workspace',
  imports: [PdfLayer, DrawingLayer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'cursorClass()',
    tabindex: '0',
    'aria-label': 'Floor plan workspace',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'onPointerUp($event)',
    '(pointercancel)': 'onPointerUp($event)',
    '(pointerleave)': 'tools.cursor.set(null)',
    '(dblclick)': 'onDoubleClick($event)',
    '(contextmenu)': '$event.preventDefault()',
    '(dragover)': 'onDragOver($event)',
    '(drop)': 'onDrop($event)',
  },
  template: `
    <app-pdf-layer [page]="page()" [view]="viewport.view()" [size]="viewport.size()"
                   (renderError)="renderError.emit($event)" />
    <app-drawing-layer [showGrid]="showGrid()" [calibrationData]="calibration()" />
  `,
  styles: `
    :host {
      position: relative; display: block; overflow: hidden; outline: none;
      background:
        radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px) 0 0 / 22px 22px,
        var(--workspace);
      touch-action: none; user-select: none;
    }
    :host(.cursor-pan) { cursor: grab; }
    :host(.cursor-panning) { cursor: grabbing; }
    :host(.cursor-cross) { cursor: crosshair; }
    :host(.cursor-default) { cursor: default; }
    :host(.cursor-move) { cursor: move; }
  `,
})
export class Workspace {
  protected readonly viewport = inject(ViewportStore);
  protected readonly tools = inject(ToolsStore);
  private readonly drawing = inject(DrawingStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly page = input<PDFPageProxy | null>(null);
  readonly showGrid = input(true);
  readonly calibration = input<Calibration | null>(null);
  /** Calibration picking is disabled (plan locked). */
  readonly calibrationLocked = input(false);
  readonly renderError = output<string>();

  private readonly spaceHeld = signal(false);
  private readonly gesture = signal<Gesture | null>(null);
  private readonly hovering = signal(false);

  protected readonly cursorClass = computed(() => {
    const g = this.gesture();
    if (g?.kind === 'pan') return 'cursor-panning';
    if (g?.kind === 'move' && g.dragging) return 'cursor-move';
    if (this.spaceHeld() || this.tools.tool() === 'pan') return 'cursor-pan';
    if (this.tools.tool() === 'select') return this.hovering() ? 'cursor-move' : 'cursor-default';
    return 'cursor-cross';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const ro = new ResizeObserver(([entry]) => {
        const { width, height } = entry!.contentRect;
        this.viewport.size.set({ width, height });
      });
      ro.observe(this.host);

      // Wheel must be non-passive to stop the page from scrolling while zooming.
      const onWheel = (e: WheelEvent) => this.onWheel(e);
      this.host.addEventListener('wheel', onWheel, { passive: false });

      const onKey = (e: KeyboardEvent) => {
        if (isTyping(e)) return;
        if (e.code === 'Space') {
          this.spaceHeld.set(e.type === 'keydown');
          if (e.type === 'keydown') e.preventDefault();
        }
        if (e.key === 'Shift') this.tools.orthogonal.set(e.type === 'keydown');
      };
      const onBlur = () => {
        this.spaceHeld.set(false);
        this.tools.orthogonal.set(false);
      };
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
      window.addEventListener('blur', onBlur);

      destroyRef.onDestroy(() => {
        ro.disconnect();
        this.host.removeEventListener('wheel', onWheel);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', onBlur);
      });
    });
  }

  // ── pointer ──

  protected onPointerDown(e: PointerEvent): void {
    this.host.focus({ preventScroll: true });
    const local = this.local(e);
    const tool = this.tools.tool();
    const wantsPan = e.button === 1 || (e.button === 0 && (this.spaceHeld() || tool === 'pan'));
    if (wantsPan) {
      e.preventDefault();
      this.capture(e);
      this.gesture.set({ kind: 'pan', last: local });
      return;
    }

    if (e.button === 2) {
      if (tool === 'measure') this.tools.measurePoints().length >= 2 ? this.tools.finishMeasure() : this.tools.clearMeasure();
      if (tool === 'calibrate') this.tools.resetCalibration();
      if (tool === 'place') this.tools.setTool('select');
      return;
    }
    if (e.button !== 0) return;

    const raw = this.viewport.toPlan(local);
    if (!raw) return;

    if (tool === 'select') {
      const hit = hitTest(this.drawing.selectable(), raw, PICK_TOLERANCE_PX / this.zoom());
      if (hit) {
        const sel = this.drawing.selection();
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          this.drawing.select([hit.id], 'toggle');
          return;
        }
        if (!sel.has(hit.id)) this.drawing.select([hit.id]);
        this.capture(e);
        this.gesture.set({
          kind: 'move',
          start: raw,
          startScreen: local,
          before: this.drawing.selected(),
          anchor: hit,
          dragging: false,
        });
      } else {
        this.capture(e);
        this.gesture.set({ kind: 'box', start: local, additive: e.shiftKey || e.ctrlKey || e.metaKey });
      }
      return;
    }

    if (tool === 'place') {
      const type = this.tools.placeType();
      if (type) this.placeAt(type, this.snapped(raw, e.altKey));
      return;
    }

    const p = this.toolPoint(local, e.shiftKey);
    if (!p) return;
    if (tool === 'measure') this.tools.addMeasurePoint(p);
    if (tool === 'calibrate' && !this.calibrationLocked()) this.tools.addCalibrationPoint(p);
  }

  protected onPointerMove(e: PointerEvent): void {
    const local = this.local(e);
    const g = this.gesture();
    if (g?.kind === 'pan') {
      this.viewport.panBy({ x: local.x - g.last.x, y: local.y - g.last.y });
      this.gesture.set({ ...g, last: local });
      return;
    }
    if (g?.kind === 'move') {
      if (!g.dragging && Math.hypot(local.x - g.startScreen.x, local.y - g.startScreen.y) < DRAG_THRESHOLD_PX) return;
      const p = this.viewport.toPlan(local);
      if (!p) return;
      // Snap the grabbed component; move the rest of the selection by the same offset.
      let target = { x: g.anchor.x + (p.x - g.start.x), y: g.anchor.y + (p.y - g.start.y) };
      if (e.shiftKey) {
        target = constrainOrthogonal(g.anchor, target, (v) => this.viewport.toScreen(v)!, (v) => this.viewport.toPlan(v)!);
      }
      target = this.snapped(target, e.altKey);
      const dx = target.x - g.anchor.x;
      const dy = target.y - g.anchor.y;
      this.drawing.preview(g.before.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy })));
      if (!g.dragging) this.gesture.set({ ...g, dragging: true });
      return;
    }
    if (g?.kind === 'box') {
      this.tools.selectBox.set({ a: g.start, b: local });
      return;
    }

    const tool = this.tools.tool();
    if (tool === 'select') {
      const raw = this.viewport.toPlan(local);
      this.hovering.set(!!raw && !!hitTest(this.drawing.selectable(), raw, PICK_TOLERANCE_PX / this.zoom()));
      this.tools.cursor.set(raw);
    } else if (tool === 'place') {
      const raw = this.viewport.toPlan(local);
      this.tools.cursor.set(raw ? this.snapped(raw, e.altKey) : null);
    } else {
      this.tools.cursor.set(this.toolPoint(local, e.shiftKey));
    }
  }

  protected onPointerUp(e: PointerEvent): void {
    const g = this.gesture();
    if (!g) return;
    this.gesture.set(null);
    if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);

    if (g.kind === 'move' && g.dragging) {
      this.drawing.commitPreview(g.before.length === 1 ? 'Move component' : `Move ${g.before.length} components`, g.before);
    } else if (g.kind === 'box') {
      const box = this.tools.selectBox();
      this.tools.selectBox.set(null);
      if (!box || Math.hypot(box.b.x - box.a.x, box.b.y - box.a.y) < DRAG_THRESHOLD_PX) {
        if (!g.additive) this.drawing.clearSelection(); // plain click on empty space
        return;
      }
      // Test in screen space so the box is correct for any plan rotation.
      const view = this.viewport.view();
      if (!view) return;
      const onScreen = this.drawing.selectable().map((c) => ({ ...c, ...planToScreen(view, c) }));
      const ids = insideRect(onScreen, box.a, box.b).map((c) => c.id);
      this.drawing.select(ids, g.additive ? 'add' : 'replace');
    }
  }

  protected onDoubleClick(e: MouseEvent): void {
    if (this.tools.tool() === 'measure') {
      e.preventDefault();
      this.tools.finishMeasure();
    }
  }

  // ── drag & drop from the library ──

  protected onDragOver(e: DragEvent): void {
    if (e.dataTransfer?.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  protected onDrop(e: DragEvent): void {
    const type = e.dataTransfer?.getData(DRAG_MIME);
    if (!type) return;
    e.preventDefault();
    const p = this.viewport.toPlan(this.local(e));
    if (p) this.placeAt(type, this.snapped(p, e.altKey));
    this.host.focus({ preventScroll: true });
  }

  private placeAt(typeKey: string, at: Vec2): void {
    const c = createComponent(typeKey, at, uuidv7(), this.drawing.components());
    this.drawing.add([c]);
  }

  // ── helpers ──

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    this.viewport.zoomAtPoint(this.local(e), Math.exp(-pixels * WHEEL_ZOOM_SPEED));
  }

  private zoom(): number {
    return this.viewport.view()?.zoom ?? 1;
  }

  /** Snaps to the visible grid when snapping is on and Alt is not held. */
  private snapped(p: Vec2, altKey: boolean): Vec2 {
    if (!this.tools.snap() || altKey || !this.showGrid()) return p;
    const spec = gridSpec(this.zoom(), this.calibration()?.metresPerUnit ?? null);
    return snapToStep(p, spec.step);
  }

  private capture(e: PointerEvent): void {
    try {
      this.host.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
  }

  private local(e: MouseEvent): Vec2 {
    const r = this.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Measure / calibrate point, constrained to horizontal/vertical when Shift is held. */
  private toolPoint(local: Vec2, shift: boolean): Vec2 | null {
    const p = this.viewport.toPlan(local);
    if (!p) return null;
    if (!shift) return p;
    const tool = this.tools.tool();
    const anchorList =
      tool === 'measure' && !this.tools.measureFinished()
        ? this.tools.measurePoints()
        : tool === 'calibrate'
          ? this.tools.calibrationPoints()
          : [];
    const anchor = anchorList[anchorList.length - 1];
    if (!anchor || (tool === 'calibrate' && anchorList.length >= 2)) return p;
    return constrainOrthogonal(anchor, p, (v) => this.viewport.toScreen(v)!, (v) => this.viewport.toPlan(v)!);
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
