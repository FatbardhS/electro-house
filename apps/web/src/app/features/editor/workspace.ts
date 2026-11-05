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
import type { Calibration, Vec2 } from '@electro/shared';
import { DrawingLayer } from './drawing/drawing-layer';
import { PdfLayer } from './pdf/pdf-layer';
import { ToolsStore, constrainOrthogonal } from './state/tools.store';
import { ViewportStore } from './viewport/viewport.store';

const WHEEL_ZOOM_SPEED = 0.0015;

/**
 * The interactive canvas area. Converts pointer input into plan coordinates and view changes.
 * Owns no data: it updates the ViewportStore (view) and ToolsStore (tool input).
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
  `,
})
export class Workspace {
  protected readonly viewport = inject(ViewportStore);
  protected readonly tools = inject(ToolsStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly page = input<PDFPageProxy | null>(null);
  readonly showGrid = input(true);
  readonly calibration = input<Calibration | null>(null);
  /** Calibration picking is disabled (plan locked). */
  readonly calibrationLocked = input(false);
  readonly renderError = output<string>();

  private readonly spaceHeld = signal(false);
  private readonly panning = signal(false);
  private lastPointer: Vec2 | null = null;

  protected readonly cursorClass = computed(() => {
    if (this.panning()) return 'cursor-panning';
    if (this.spaceHeld() || this.tools.tool() === 'pan') return 'cursor-pan';
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

  protected onPointerDown(e: PointerEvent): void {
    this.host.focus({ preventScroll: true });
    const local = this.local(e);
    const wantsPan = e.button === 1 || (e.button === 0 && (this.spaceHeld() || this.tools.tool() === 'pan'));
    if (wantsPan) {
      e.preventDefault();
      this.panning.set(true);
      this.lastPointer = local;
      this.host.setPointerCapture(e.pointerId);
      return;
    }

    const tool = this.tools.tool();
    if (e.button === 2) {
      if (tool === 'measure') this.tools.measurePoints().length >= 2 ? this.tools.finishMeasure() : this.tools.clearMeasure();
      if (tool === 'calibrate') this.tools.resetCalibration();
      return;
    }
    if (e.button !== 0) return;

    const p = this.planPoint(local, e.shiftKey);
    if (!p) return;
    if (tool === 'measure') this.tools.addMeasurePoint(p);
    if (tool === 'calibrate' && !this.calibrationLocked()) this.tools.addCalibrationPoint(p);
  }

  protected onPointerMove(e: PointerEvent): void {
    const local = this.local(e);
    if (this.panning() && this.lastPointer) {
      this.viewport.panBy({ x: local.x - this.lastPointer.x, y: local.y - this.lastPointer.y });
      this.lastPointer = local;
      return;
    }
    this.tools.cursor.set(this.planPoint(local, e.shiftKey));
  }

  protected onPointerUp(e: PointerEvent): void {
    if (!this.panning()) return;
    this.panning.set(false);
    this.lastPointer = null;
    if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);
  }

  protected onDoubleClick(e: MouseEvent): void {
    if (this.tools.tool() === 'measure') {
      e.preventDefault();
      this.tools.finishMeasure();
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    this.viewport.zoomAtPoint(this.local(e), Math.exp(-pixels * WHEEL_ZOOM_SPEED));
  }

  private local(e: MouseEvent): Vec2 {
    const r = this.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Pointer position in plan coordinates, constrained to horizontal/vertical when Shift is held. */
  private planPoint(local: Vec2, shift: boolean): Vec2 | null {
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
    return constrainOrthogonal(
      anchor,
      p,
      (v) => this.viewport.toScreen(v)!,
      (v) => this.viewport.toPlan(v)!,
    );
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
