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
  viewChild,
} from '@angular/core';
import type { PDFPageProxy } from 'pdfjs-dist';
import {
  DEFAULT_CABLE,
  MM_TO_PT,
  componentType,
  createComponent,
  type CableDto,
  hitTest,
  hitTestWire,
  insideRect,
  planToScreen,
  portPosition,
  snapToStep,
  uuidv7,
  wireRoute,
  type Calibration,
  type ComponentDto,
  type Vec2,
  type WireDto,
  type WireEndDto,
} from '@electro/shared';
import { DrawingLayer } from './drawing/drawing-layer';
import { gridSpec } from './drawing/grid';
import { elbow, handleAt, orthoPoint, wireHandles, type WireHandle } from './drawing/wire-handles';
import { findWall, rotationTowards, wallOffsetMm } from './drawing/wall-snap';
import { suggestedCable } from './drawing/cable-suggest';
import { PdfLayer } from './pdf/pdf-layer';
import { DrawingStore } from './state/drawing.store';
import { GuideStore } from './state/guide.store';
import { ToolsStore, constrainOrthogonal } from './state/tools.store';
import { ViewportStore } from './viewport/viewport.store';
import { t } from '../../core/i18n/i18n.service';

const WHEEL_ZOOM_SPEED = 0.0015;
/** Pointer must move this far (px) before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;
/** Extra pick tolerance around symbols and wires, in screen pixels (mouse / finger). */
const PICK_TOLERANCE_PX = 4;
const TOUCH_TOLERANCE_PX = 14;
/** How far from the pointer (screen px) outlets and switches look for a wall to stick to. */
const WALL_REACH_PX = 36;
const WALL_REACH_TOUCH_PX = 52;
export const DRAG_MIME = 'application/x-electro-component';

type MoveSnap = { components: ComponentDto[]; wires: WireDto[] };
type Gesture =
  | { kind: 'pan'; last: Vec2 }
  | { kind: 'move'; start: Vec2; startScreen: Vec2; snap: MoveSnap; anchor: Vec2; wireIds: ReadonlySet<string>; dragging: boolean }
  | { kind: 'handle'; wire: WireDto; handle: WireHandle; startScreen: Vec2; dragging: boolean }
  | { kind: 'box'; start: Vec2; additive: boolean }
  /** Touch: one finger down; a tap acts with the current tool, a drag pans. */
  | { kind: 'tap'; start: Vec2; last: Vec2; panning: boolean }
  /** Touch: two fingers zoom and pan. */
  | { kind: 'pinch'; center: Vec2; distance: number };

/**
 * The interactive canvas area. Converts pointer input into plan coordinates and editor actions.
 * Owns no data: it updates the ViewportStore (view), ToolsStore (tool input) and DrawingStore (drawing).
 */
@Component({
  selector: 'app-workspace',
  imports: [PdfLayer, DrawingLayer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'cursorClass()',
    tabindex: '0',
    '[attr.aria-label]': 'ariaLabel()',
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
    :host(.cursor-point) { cursor: pointer; }
  `,
})
export class Workspace {
  protected readonly ariaLabel = () => t('Floor plan workspace');
  protected readonly viewport = inject(ViewportStore);
  protected readonly tools = inject(ToolsStore);
  private readonly drawing = inject(DrawingStore);
  private readonly guide = inject(GuideStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly pdf = viewChild(PdfLayer);
  /** Active touch points (screen px), for pinch zoom. */
  private readonly touches = new Map<number, Vec2>();
  /** The last pointer was a finger: bigger pick tolerance and wall reach. */
  private touch = false;

  readonly page = input<PDFPageProxy | null>(null);
  readonly showGrid = input(true);
  readonly calibration = input<Calibration | null>(null);
  /** Calibration picking is disabled (plan locked). */
  readonly calibrationLocked = input(false);
  readonly renderError = output<string>();

  private readonly spaceHeld = signal(false);
  private readonly gesture = signal<Gesture | null>(null);
  private readonly hover = signal<'none' | 'object' | 'handle'>('none');

  protected readonly cursorClass = computed(() => {
    const g = this.gesture();
    if (g?.kind === 'pan' || g?.kind === 'pinch' || (g?.kind === 'tap' && g.panning)) return 'cursor-panning';
    if (this.tools.tool() === 'wire' && this.tools.connectTarget()) return 'cursor-point';
    if ((g?.kind === 'move' || g?.kind === 'handle') && g.dragging) return 'cursor-move';
    if (this.spaceHeld() || this.tools.tool() === 'pan') return 'cursor-pan';
    if (this.tools.tool() === 'select') {
      const h = this.hover();
      return h === 'handle' ? 'cursor-point' : h === 'object' ? 'cursor-move' : 'cursor-default';
    }
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
    this.touch = e.pointerType === 'touch';
    if (this.touch) {
      this.touches.set(e.pointerId, local);
      this.capture(e);
      if (this.touches.size === 2) return this.startPinch();
      if (this.touches.size > 2) return;
    }
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
      if (tool === 'wire') this.finishWire();
      return;
    }
    if (e.button !== 0) return;

    const raw = this.viewport.toPlan(local);
    if (!raw) return;

    // Fingers: act on a tap (when the finger lifts), so a drag or a second finger can pan and zoom instead.
    if (this.touch && tool !== 'select') {
      this.gesture.set({ kind: 'tap', start: local, last: local, panning: false });
      return;
    }
    if (tool === 'select') return this.selectDown(e, local, raw);
    this.act(local, e.shiftKey, e.altKey);
  }

  /** Click (or tap) with the current drawing tool at a screen point. */
  private act(local: Vec2, shift: boolean, alt: boolean): void {
    const tool = this.tools.tool();
    const raw = this.viewport.toPlan(local);
    if (!raw) return;
    if (tool === 'wire') return this.wireClick(raw, shift, alt);
    if (tool === 'place') {
      const type = this.tools.placeType();
      if (type) {
        const p = this.placement(type, local, raw, alt);
        this.placeAt(type, p.at, p.rotation);
      }
      return;
    }
    const p = this.toolPoint(local, shift);
    if (!p) return;
    if (tool === 'measure') this.tools.addMeasurePoint(p);
    if (tool === 'calibrate' && !this.calibrationLocked()) this.tools.addCalibrationPoint(p);
  }

  /** Two fingers on the plan: cancel what one finger started and zoom/pan instead. */
  private startPinch(): void {
    const g = this.gesture();
    if (g?.kind === 'move' && g.dragging) this.drawing.preview({ components: g.snap.components, wires: g.snap.wires });
    if (g?.kind === 'handle' && g.dragging) this.drawing.preview({ wires: [g.wire] });
    this.tools.selectBox.set(null);
    const [a, b] = [...this.touches.values()] as [Vec2, Vec2];
    this.gesture.set({ kind: 'pinch', center: mid(a, b), distance: Math.max(1, dist(a, b)) });
  }

  private selectDown(e: PointerEvent, local: Vec2, raw: Vec2): void {
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const tol = this.tol();

    // 1. Handles of a single selected wire (bend points, segment midpoints, ends).
    const handle = this.handleUnder(local);
    if (handle && !additive) {
      this.capture(e);
      this.gesture.set({ kind: 'handle', wire: handle.wire, handle: handle.handle, startScreen: local, dragging: false });
      return;
    }

    // 2. Components, then wires.
    const comp = hitTest(this.drawing.selectable(), raw, tol);
    const wire = comp ? null : hitTestWire(this.drawing.selectableWires(), raw, tol, this.drawing.lookup());
    const hitId = comp?.id ?? wire?.id;
    if (hitId) {
      if (additive) {
        this.drawing.select([hitId], 'toggle');
        return;
      }
      if (!this.drawing.selection().has(hitId)) this.drawing.select([hitId]);
      const compIds = new Set(this.drawing.selected().map((c) => c.id));
      const wireIds = new Set(this.drawing.selectedWires().map((w) => w.id));
      this.capture(e);
      this.gesture.set({
        kind: 'move',
        start: raw,
        startScreen: local,
        snap: this.drawing.moveSnapshot(compIds, wireIds),
        anchor: comp ? { x: comp.x, y: comp.y } : raw,
        wireIds,
        dragging: false,
      });
      return;
    }

    // 3. Empty space: box selection (or clear on a plain click). A finger pans instead.
    this.capture(e);
    if (this.touch) {
      this.gesture.set({ kind: 'tap', start: local, last: local, panning: false });
      return;
    }
    this.gesture.set({ kind: 'box', start: local, additive });
  }

  protected onPointerMove(e: PointerEvent): void {
    const local = this.local(e);
    const g = this.gesture();
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, local);
    if (g?.kind === 'pinch') {
      if (this.touches.size < 2) return;
      const [a, b] = [...this.touches.values()] as [Vec2, Vec2];
      const center = mid(a, b);
      const distance = Math.max(1, dist(a, b));
      this.viewport.panBy({ x: center.x - g.center.x, y: center.y - g.center.y });
      this.viewport.zoomAtPoint(center, distance / g.distance);
      this.gesture.set({ kind: 'pinch', center, distance });
      return;
    }
    if (g?.kind === 'tap') {
      if (!g.panning && dist(local, g.start) < DRAG_THRESHOLD_PX * 2) return;
      this.viewport.panBy({ x: local.x - g.last.x, y: local.y - g.last.y });
      this.gesture.set({ ...g, last: local, panning: true });
      return;
    }
    if (g?.kind === 'pan') {
      this.viewport.panBy({ x: local.x - g.last.x, y: local.y - g.last.y });
      this.gesture.set({ ...g, last: local });
      return;
    }
    if (g?.kind === 'move') {
      if (!g.dragging && dist(local, g.startScreen) < DRAG_THRESHOLD_PX) return;
      const p = this.viewport.toPlan(local);
      if (!p) return;
      // Snap the grabbed object; move the rest of the selection by the same offset.
      let target = { x: g.anchor.x + (p.x - g.start.x), y: g.anchor.y + (p.y - g.start.y) };
      if (e.shiftKey) target = constrainOrthogonal(g.anchor, target, this.toScreenFn, this.toPlanFn);
      target = this.snapped(target, e.altKey);
      this.drawing.preview(this.drawing.movedBy(g.snap, target.x - g.anchor.x, target.y - g.anchor.y, g.wireIds));
      if (!g.dragging) this.gesture.set({ ...g, dragging: true });
      return;
    }
    if (g?.kind === 'handle') {
      if (!g.dragging && dist(local, g.startScreen) < DRAG_THRESHOLD_PX) return;
      const p = this.viewport.toPlan(local);
      if (!p) return;
      this.drawing.preview({ wires: [this.editedWire(g.wire, g.handle, this.snapped(p, e.altKey), false)] });
      if (!g.dragging) this.gesture.set({ ...g, dragging: true });
      return;
    }
    if (g?.kind === 'box') {
      this.tools.selectBox.set({ a: g.start, b: local });
      return;
    }

    const tool = this.tools.tool();
    const raw = this.viewport.toPlan(local);
    if (tool === 'select') {
      const tol = this.tol();
      const over = !!raw && (!!hitTest(this.drawing.selectable(), raw, tol) || !!hitTestWire(this.drawing.selectableWires(), raw, tol, this.drawing.lookup()));
      this.hover.set(this.handleUnder(local) ? 'handle' : over ? 'object' : 'none');
      this.tools.cursor.set(raw);
    } else if (tool === 'place') {
      const type = this.tools.placeType();
      const p = raw && type ? this.placement(type, local, raw, e.altKey) : null;
      this.tools.cursor.set(p?.at ?? null);
      this.tools.placeRotation.set(p?.rotation ?? 0);
      this.tools.onWall.set(p?.onWall ?? false);
    } else if (tool === 'wire') {
      const w = raw ? this.wirePoint(raw, e.shiftKey, e.altKey) : null;
      this.tools.cursor.set(w?.point ?? null);
      this.tools.connectTarget.set(w?.component?.id ?? null);
    } else {
      this.tools.cursor.set(this.toolPoint(local, e.shiftKey));
    }
  }

  protected onPointerUp(e: PointerEvent): void {
    const wasTouch = this.touches.delete(e.pointerId);
    const g = this.gesture();
    if (!g) return;
    if (g.kind === 'pinch') {
      // Lifting one finger ends the pinch; the other finger does nothing until it is lifted too.
      if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);
      if (this.touches.size === 0) this.gesture.set(null);
      return;
    }
    this.gesture.set(null);
    if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);

    if (g.kind === 'tap') {
      if (g.panning || !wasTouch || e.type === 'pointercancel') return;
      if (this.tools.tool() === 'select') this.drawing.clearSelection();
      else this.act(g.start, false, false);
      return;
    }

    if (g.kind === 'move' && g.dragging) {
      const n = g.snap.components.length + g.wireIds.size;
      this.drawing.commitPreview(n === 1 ? (g.snap.components.length ? t('Move component') : t('Move wire')) : t('Move {n} objects', { n }), g.snap);
    } else if (g.kind === 'handle' && g.dragging) {
      const p = this.viewport.toPlan(this.local(e));
      this.drawing.preview({ wires: [g.wire] }); // restore, then record one clean step
      if (p) {
        const label = g.handle.kind === 'end' ? t('Reconnect wire') : g.handle.kind === 'mid' ? t('Add bend') : t('Move bend');
        this.drawing.updateWires([this.editedWire(g.wire, g.handle, this.snapped(p, e.altKey), true)], label);
      }
    } else if (g.kind === 'box') {
      const box = this.tools.selectBox();
      this.tools.selectBox.set(null);
      if (!box || dist(box.a, box.b) < DRAG_THRESHOLD_PX) {
        if (!g.additive) this.drawing.clearSelection(); // plain click on empty space
        return;
      }
      // Test in screen space so the box is correct for any plan rotation.
      const view = this.viewport.view();
      if (!view) return;
      const onScreen = this.drawing.selectable().map((c) => ({ ...c, ...planToScreen(view, c) }));
      const ids = insideRect(onScreen, box.a, box.b).map((c) => c.id);
      const x0 = Math.min(box.a.x, box.b.x);
      const x1 = Math.max(box.a.x, box.b.x);
      const y0 = Math.min(box.a.y, box.b.y);
      const y1 = Math.max(box.a.y, box.b.y);
      const lookup = this.drawing.lookup();
      for (const w of this.drawing.selectableWires()) {
        const inside = wireRoute(w, lookup)
          .map((p) => planToScreen(view, p))
          .every((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
        if (inside) ids.push(w.id);
      }
      this.drawing.select(ids, g.additive ? 'add' : 'replace');
    }
  }

  protected onDoubleClick(e: MouseEvent): void {
    const tool = this.tools.tool();
    if (tool === 'measure') {
      e.preventDefault();
      this.tools.finishMeasure();
    } else if (tool === 'wire') {
      e.preventDefault();
      this.finishWire();
    } else if (tool === 'select') {
      // Double-click a bend point to remove it.
      const h = this.handleUnder(this.local(e));
      if (h?.handle.kind === 'vertex') {
        const w = h.wire;
        this.drawing.updateWires([{ ...w, points: w.points.filter((_, i) => i !== (h.handle as { index: number }).index) }], t('Remove bend'));
      }
    }
  }

  // ── wire tool ──

  /** Where a wire click lands: on a component port (connects) or a snapped, optionally orthogonal point. */
  private wirePoint(raw: Vec2, shift: boolean, alt: boolean): { point: Vec2; component: ComponentDto | null } {
    const comp = hitTest(this.drawing.selectable(), raw, this.tol());
    if (comp) return { point: portPosition(comp, 'p'), component: comp };
    let p = this.snapped(raw, alt);
    const draft = this.tools.wireDraft();
    const ortho = this.tools.wireOrtho() !== shift; // Shift inverts the orthogonal mode while held
    if (draft && ortho) {
      const last = draft.points.at(-1) ?? this.endPoint(draft.from);
      p = orthoPoint(last, p, this.toScreenFn, this.toPlanFn);
    }
    return { point: p, component: null };
  }

  private wireClick(raw: Vec2, shift: boolean, alt: boolean): void {
    const { point, component } = this.wirePoint(raw, shift, alt);
    const draft = this.tools.wireDraft();
    const end: WireEndDto = component
      ? { componentId: component.id, portId: 'p', x: point.x, y: point.y }
      : { componentId: null, portId: null, x: point.x, y: point.y };
    if (!draft) {
      this.tools.wireDraft.set({ from: end, points: [] });
      return;
    }
    if (component) {
      if (component.id === draft.from.componentId && draft.points.length === 0) return; // same start component
      const last = draft.points.at(-1) ?? this.endPoint(draft.from);
      const points = [...draft.points];
      if (this.tools.wireOrtho() !== shift) {
        const corner = elbow(last, point, this.toScreenFn, this.toPlanFn);
        if (corner) points.push(corner);
      }
      this.commitWire(draft.from, end, points);
      // Guided: keep going from the item just reached, so a chain of outlets is a row of clicks.
      if (this.guide.guided()) this.tools.wireDraft.set({ from: end, points: [] });
      return;
    }
    const last = draft.points.at(-1) ?? this.endPoint(draft.from);
    if (dist(last, point) < 1e-6) return; // ignore a repeated click on the same spot
    this.tools.wireDraft.set({ ...draft, points: [...draft.points, point] });
  }

  /** Finishes the wire at its last bend point as a free end (double-click, Enter or right-click). */
  finishWire(): void {
    const draft = this.tools.wireDraft();
    if (!draft) return;
    if (draft.points.length === 0) {
      this.tools.wireDraft.set(null);
      return;
    }
    const points = [...draft.points];
    const last = points.pop()!;
    this.commitWire(draft.from, { componentId: null, portId: null, x: last.x, y: last.y }, points);
  }

  private commitWire(from: WireEndDto, to: WireEndDto, points: Vec2[]): void {
    const w: WireDto = {
      id: uuidv7(),
      label: null,
      from,
      to,
      points,
      cable: this.cableFor(from, to),
      circuitId: null,
      description: null,
    };
    this.drawing.addWire(w);
    this.tools.wireDraft.set(null);
  }

  /**
   * Cable for a new wire: the last cable chosen. In guided mode, while no cable was chosen yet,
   * a sensible size is picked from what the wire connects: 2.5 mm² for outlets, 5 cores for three-phase.
   */
  private cableFor(from: WireEndDto, to: WireEndDto): CableDto {
    const chosen = { ...this.tools.wireCable() };
    if (!this.guide.guided() || JSON.stringify(chosen) !== JSON.stringify(DEFAULT_CABLE)) return chosen;
    return { ...chosen, ...suggestedCable([from, to].map((e) => (e.componentId ? this.drawing.byId().get(e.componentId)?.typeKey : undefined))) };
  }

  private endPoint(end: WireEndDto): Vec2 {
    const c = end.componentId ? this.drawing.byId().get(end.componentId) : undefined;
    return c ? portPosition(c, end.portId) : { x: end.x, y: end.y };
  }

  // ── wire editing ──

  private handleUnder(local: Vec2): { wire: WireDto; handle: WireHandle } | null {
    const wires = this.drawing.selectedWires();
    const view = this.viewport.view();
    if (wires.length !== 1 || this.drawing.selected().length || !view) return null;
    const wire = wires[0]!;
    const handle = handleAt(wireHandles(wire, this.drawing.lookup(), view), local);
    return handle ? { wire, handle } : null;
  }

  /** The wire after dragging one of its handles to p. Ends dropped on a component connect to it. */
  private editedWire(w: WireDto, h: WireHandle, p: Vec2, final: boolean): WireDto {
    if (h.kind === 'vertex') return { ...w, points: w.points.map((q, i) => (i === h.index ? p : q)) };
    if (h.kind === 'mid') {
      const points = [...w.points];
      points.splice(h.index, 0, p);
      return { ...w, points };
    }
    const comp = final ? hitTest(this.drawing.selectable(), p, this.tol()) : null;
    const end: WireEndDto = comp
      ? { componentId: comp.id, portId: 'p', ...portPosition(comp, 'p') }
      : { componentId: null, portId: null, x: p.x, y: p.y };
    return h.which === 'from' ? { ...w, from: end } : { ...w, to: end };
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
    const local = this.local(e);
    const p = this.viewport.toPlan(local);
    if (p) {
      const at = this.placement(type, local, p, e.altKey);
      this.placeAt(type, at.at, at.rotation);
    }
    this.host.focus({ preventScroll: true });
  }

  private placeAt(typeKey: string, at: Vec2, rotation = 0): void {
    const c = createComponent(typeKey, at, uuidv7(), this.drawing.components());
    this.drawing.add([{ ...c, rotation }]);
  }

  /**
   * Where a component lands. Guided mode: outlets, switches and wall lights stick to the nearest wall
   * of the plan, facing it (Alt places freely). Otherwise the grid snap applies.
   */
  private placement(typeKey: string, local: Vec2, raw: Vec2, alt: boolean): { at: Vec2; rotation: number; onWall: boolean } {
    const offset = wallOffsetMm(typeKey);
    if (offset !== null && this.guide.guided() && !alt && componentType(typeKey)) {
      const reach = this.touch ? WALL_REACH_TOUCH_PX : WALL_REACH_PX;
      const dark = this.pdf()?.darkSampler(local, reach + 48);
      const hit = dark ? findWall(dark, local, reach) : null;
      if (hit) {
        const px = offset * MM_TO_PT * this.zoom();
        const at = this.viewport.toPlan({ x: hit.face.x - hit.toWall.x * px, y: hit.face.y - hit.toWall.y * px });
        const a = this.viewport.toPlan(hit.face);
        const b = this.viewport.toPlan({ x: hit.face.x + hit.toWall.x, y: hit.face.y + hit.toWall.y });
        if (at && a && b) return { at, rotation: rotationTowards({ x: b.x - a.x, y: b.y - a.y }), onWall: true };
      }
    }
    return { at: this.snapped(raw, alt), rotation: 0, onWall: false };
  }

  // ── helpers ──

  private readonly toScreenFn = (v: Vec2) => this.viewport.toScreen(v)!;
  private readonly toPlanFn = (v: Vec2) => this.viewport.toPlan(v)!;

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    this.viewport.zoomAtPoint(this.local(e), Math.exp(-pixels * WHEEL_ZOOM_SPEED));
  }

  private zoom(): number {
    return this.viewport.view()?.zoom ?? 1;
  }

  /** Pick tolerance in plan units: generous for fingers. */
  private tol(): number {
    return (this.touch ? TOUCH_TOLERANCE_PX : PICK_TOLERANCE_PX) / this.zoom();
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
    return constrainOrthogonal(anchor, p, this.toScreenFn, this.toPlanFn);
  }
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
