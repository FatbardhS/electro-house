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

/**
 * Background layer: renders the visible part of a PDF page onto a canvas under the drawing.
 * It receives a page and the shared view transform. It has no knowledge of electrical objects.
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

  /** View and page the visible bitmap was rendered for. */
  private rendered: { view: ViewState; page: PDFPageProxy } | null = null;
  private task: RenderTask | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;

  constructor() {
    effect(() => {
      const page = this.page();
      const view = this.view();
      const size = this.size();
      untracked(() => this.onChange(page, view, size));
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    this.task?.cancel();
  }

  private onChange(page: PDFPageProxy | null, view: ViewState | null, size: Size): void {
    const canvas = this.canvasRef().nativeElement;
    if (!page || !view || size.width < 1 || size.height < 1) {
      canvas.style.visibility = 'hidden';
      return;
    }
    const r = this.rendered;
    if (r && r.page === page && r.view.rotation === view.rotation) {
      // Instant feedback: move/scale the existing bitmap, then re-render sharply when the gesture settles.
      const k = view.zoom / r.view.zoom;
      const tx = view.pan.x - r.view.pan.x * k;
      const ty = view.pan.y - r.view.pan.y * k;
      canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
      canvas.style.visibility = 'visible';
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.render(page, view, size), SETTLE_MS);
    } else {
      // New page or rotation: the old bitmap cannot be reused.
      canvas.style.visibility = r ? canvas.style.visibility : 'hidden';
      clearTimeout(this.timer);
      void this.render(page, view, size);
    }
  }

  private async render(page: PDFPageProxy, view: ViewState, size: Size): Promise<void> {
    const gen = ++this.generation;
    this.task?.cancel();

    let dpr = window.devicePixelRatio || 1;
    const area = size.width * size.height * dpr * dpr;
    if (area > MAX_CANVAS_PIXELS) dpr *= Math.sqrt(MAX_CANVAS_PIXELS / area);

    const width = Math.max(1, Math.round(size.width * dpr));
    const height = Math.max(1, Math.round(size.height * dpr));
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const ctx = off.getContext('2d', { alpha: true });
    if (!ctx) return;

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
      if ((err as { name?: string }).name === 'RenderingCancelledException') return;
      if (gen === this.generation) this.renderError.emit(`The plan could not be drawn: ${(err as Error).message}`);
      return;
    }
    if (gen !== this.generation) return;

    const canvas = this.canvasRef().nativeElement;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    canvas.getContext('2d')?.drawImage(off, 0, 0);
    canvas.style.transform = 'none';
    canvas.style.visibility = 'visible';
    this.rendered = { view, page };
  }
}
