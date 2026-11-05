import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { pageScreenRect, type Size, type ViewState } from '@electro/shared';

/** Largest bitmap we render (pixels). Beyond this the effective device-pixel ratio is reduced. */
const MAX_CANVAS_PIXELS = 16_000_000;
/** Re-render this long after the last zoom/pan change; until then the old bitmap is CSS-transformed. */
const SETTLE_MS = 140;

interface RenderJob {
  page: PDFPageProxy;
  view: ViewState;
  size: Size;
}

/**
 * Background layer: renders the visible part of a PDF page onto a canvas under the drawing.
 * It receives a page and the shared view transform. It has no knowledge of electrical objects.
 *
 * Renders are serialised: a render in progress is never cancelled for a newer one. Cancelling a
 * PDF.js render while the page's first operator list is still loading can leave the next render
 * on that page waiting forever (the plan then never appears). Instead, requests that arrive during
 * a render are coalesced and the latest one runs as soon as the current render finishes.
 */
@Component({
  selector: 'app-pdf-layer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas></canvas>`,
  styles: `
    :host { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
    canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  `,
})
export class PdfLayer implements OnDestroy {
  readonly page = input<PDFPageProxy | null>(null);
  readonly view = input<ViewState | null>(null);
  readonly size = input.required<Size>();
  readonly renderError = output<string>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  /** What the visible bitmap was rendered for. */
  private rendered: RenderJob | null = null;
  /** Latest requested render not started yet (coalesced). */
  private queued: RenderJob | null = null;
  private running = false;
  private task: RenderTask | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  constructor() {
    effect(() => {
      const page = this.page();
      const view = this.view();
      const size = this.size();
      untracked(() => this.onChange(page, view, size));
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.queued = null;
    this.task?.cancel();
  }

  private onChange(page: PDFPageProxy | null, view: ViewState | null, size: Size): void {
    const canvas = this.canvasRef().nativeElement;
    clearTimeout(this.timer);
    if (!page || !view || size.width < 1 || size.height < 1) {
      this.queued = null;
      canvas.style.visibility = 'hidden';
      return;
    }
    const job: RenderJob = { page, view, size };
    const r = this.rendered;
    if (r && r.page === page && r.view.rotation === view.rotation) {
      // Instant feedback: move/scale the existing bitmap, then re-render sharply when the gesture settles.
      const k = view.zoom / r.view.zoom;
      canvas.style.transform = `translate(${view.pan.x - r.view.pan.x * k}px, ${view.pan.y - r.view.pan.y * k}px) scale(${k})`;
      canvas.style.visibility = 'visible';
      this.timer = setTimeout(() => this.request(job), SETTLE_MS);
    } else {
      // New page or rotation: the old bitmap cannot be reused; hide it until the new one is ready.
      canvas.style.visibility = 'hidden';
      this.request(job);
    }
  }

  /** Queues a render; starts it now unless one is running, in which case it runs right after. */
  private request(job: RenderJob): void {
    this.queued = job;
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.queued && !this.destroyed) {
        const job = this.queued;
        this.queued = null;
        await this.render(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async render(job: RenderJob): Promise<void> {
    const { page, view, size } = job;
    let dpr = window.devicePixelRatio || 1;
    const area = size.width * size.height * dpr * dpr;
    if (area > MAX_CANVAS_PIXELS) dpr *= Math.sqrt(MAX_CANVAS_PIXELS / area);

    const width = Math.max(1, Math.round(size.width * dpr));
    const height = Math.max(1, Math.round(size.height * dpr));
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const ctx = off.getContext('2d', { alpha: true });
    if (!ctx) {
      this.renderError.emit('The plan could not be drawn: this browser could not create a drawing canvas.');
      return;
    }

    // Paper: white only where the page is, so the workspace around it stays dark.
    const rect = pageScreenRect(view);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(rect.x * dpr, rect.y * dpr, rect.width * dpr, rect.height * dpr);

    const viewport = page.getViewport({ scale: view.zoom * dpr, rotation: (page.rotate + view.rotation) % 360 });
    this.task = page.render({
      canvas: off,
      canvasContext: ctx,
      viewport,
      // Shift the page so only the visible region lands on this viewport-sized canvas.
      transform: [1, 0, 0, 1, view.pan.x * dpr, view.pan.y * dpr],
      background: 'rgba(0,0,0,0)',
    });

    try {
      await this.task.promise;
    } catch (err) {
      if ((err as { name?: string }).name === 'RenderingCancelledException' || this.destroyed) return;
      this.renderError.emit(`The plan could not be drawn: ${(err as Error).message}`);
      return;
    } finally {
      this.task = null;
    }
    // A newer request is waiting: skip showing this one; the loop renders the newer one next.
    if (this.destroyed || this.queued) return;

    const canvas = this.canvasRef().nativeElement;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    canvas.getContext('2d')?.drawImage(off, 0, 0);
    canvas.style.transform = 'none';
    canvas.style.visibility = 'visible';
    this.rendered = job;
  }
}
