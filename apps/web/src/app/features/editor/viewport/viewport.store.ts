import { Injectable, computed, signal } from '@angular/core';
import {
  clampZoom,
  fitToViewport,
  panBy,
  planToScreen,
  planToScreenMatrix,
  rotateView,
  screenToPlan,
  zoomAt,
  type PlanRotation,
  type Size,
  type Vec2,
  type ViewState,
} from '@electro/shared';

const STORAGE_PREFIX = 'eh.view.';

interface SavedView {
  w: number;
  h: number;
  rotation: PlanRotation;
  zoom: number;
  pan: Vec2;
}

/**
 * The single source of the plan ↔ screen transform for one editor.
 * Both the PDF layer and the SVG drawing layer read from here; neither knows about the other.
 * Zoom/pan/rotate only change this view — stored plan coordinates are never touched.
 */
@Injectable()
export class ViewportStore {
  /** Size of the workspace element in CSS pixels. */
  readonly size = signal<Size>({ width: 0, height: 0 });
  private readonly state = signal<ViewState | null>(null);
  readonly view = this.state.asReadonly();
  readonly matrix = computed(() => {
    const v = this.state();
    return v ? planToScreenMatrix(v) : null;
  });
  readonly zoomPercent = computed(() => Math.round((this.state()?.zoom ?? 1) * 100));

  private floorId: string | null = null;

  /** Starts a view for a page: restores the last view of this floor if it still matches, else fits the page. */
  init(floorId: string, page: Size, rotation: PlanRotation): void {
    this.floorId = floorId;
    const saved = readSaved(floorId);
    if (
      saved &&
      saved.rotation === rotation &&
      Math.abs(saved.w - page.width) < 0.5 &&
      Math.abs(saved.h - page.height) < 0.5
    ) {
      this.state.set({ page, rotation, zoom: clampZoom(saved.zoom), pan: saved.pan });
    } else {
      this.state.set(fitToViewport({ page, rotation, zoom: 1, pan: { x: 0, y: 0 } }, this.size()));
    }
  }

  /** Page size changed (other PDF page or replaced file): keep rotation, refit. */
  setPage(page: Size): void {
    const v = this.state();
    if (!v) return;
    if (Math.abs(v.page.width - page.width) < 0.5 && Math.abs(v.page.height - page.height) < 0.5) return;
    this.commit(fitToViewport({ ...v, page }, this.size()));
  }

  reset(): void {
    this.state.set(null);
    this.floorId = null;
  }

  zoomAtPoint(screen: Vec2, factor: number): void {
    const v = this.state();
    if (v) this.commit(zoomAt(v, screen, v.zoom * factor));
  }

  zoomBy(factor: number): void {
    const s = this.size();
    this.zoomAtPoint({ x: s.width / 2, y: s.height / 2 }, factor);
  }

  setZoom(zoom: number): void {
    const v = this.state();
    if (!v) return;
    const s = this.size();
    this.commit(zoomAt(v, { x: s.width / 2, y: s.height / 2 }, zoom));
  }

  panBy(delta: Vec2): void {
    const v = this.state();
    if (v) this.commit(panBy(v, delta));
  }

  fit(): void {
    const v = this.state();
    if (v) this.commit(fitToViewport(v, this.size()));
  }

  setRotation(rotation: PlanRotation): void {
    const v = this.state();
    if (!v || v.rotation === rotation) return;
    const s = this.size();
    this.commit(rotateView(v, rotation, { x: s.width / 2, y: s.height / 2 }));
  }

  toPlan(screen: Vec2): Vec2 | null {
    const v = this.state();
    return v ? screenToPlan(v, screen) : null;
  }

  toScreen(plan: Vec2): Vec2 | null {
    const v = this.state();
    return v ? planToScreen(v, plan) : null;
  }

  private commit(next: ViewState): void {
    this.state.set(next);
    this.persist(next);
  }

  private persistTimer?: ReturnType<typeof setTimeout>;
  private persist(v: ViewState): void {
    const id = this.floorId;
    if (!id) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        const saved: SavedView = { w: v.page.width, h: v.page.height, rotation: v.rotation, zoom: v.zoom, pan: v.pan };
        localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(saved));
      } catch {
        // View position is a convenience; storage being unavailable is fine.
      }
    }, 300);
  }
}

function readSaved(floorId: string): SavedView | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + floorId);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedView;
    const ok =
      [v.w, v.h, v.zoom, v.pan?.x, v.pan?.y].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
      [0, 90, 180, 270].includes(v.rotation);
    return ok ? v : null;
  } catch {
    return null;
  }
}
