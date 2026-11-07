import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, signal } from '@angular/core';
import { GuideStore } from '../state/guide.store';
import { I18N_PIPES } from '../../../core/i18n/t.pipe';
import type { TKey } from '../../../core/i18n/sq';

interface TourStop {
  target: string;
  title: TKey;
  text: TKey;
}

const STOPS: readonly TourStop[] = [
  { target: 'steps', title: 'Five simple steps', text: 'Work from left to right. A step turns green when it is done. You can jump to any step at any time.' },
  { target: 'tiles,intro', title: 'Pick, then click', text: 'Click an item here, then click on the plan to put it there. Outlets and switches stick to the walls by themselves.' },
  { target: 'hint', title: 'Always know the next click', text: 'This box tells you what your next click will do. “Done” stops the current tool.' },
  { target: 'progress', title: 'Your progress', text: 'See what is done and what still needs attention. Click a warning to jump to it on the plan.' },
  { target: 'mode', title: 'All tools when you need them', text: 'Experienced users can switch to all tools. Help opens this tour again.' },
];

/** First-visit walkthrough: highlights a part of the editor and explains it in one bubble. */
@Component({
  selector: 'app-tour',
  imports: [I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (stop(); as s) {
      <div class="shade" (click)="close()"></div>
      @if (rect(); as r) {
        <div class="spot" [style.left.px]="r.left - 6" [style.top.px]="r.top - 6" [style.width.px]="r.width + 12" [style.height.px]="r.height + 12"></div>
      }
      <div class="bubble" role="dialog" aria-modal="true" [attr.aria-label]="s.title | t" [style.left.px]="pos().left" [style.top.px]="pos().top">
        <div class="count faint">{{ index()! + 1 }} / {{ stops.length }}</div>
        <h3>{{ s.title | t }}</h3>
        <p>{{ s.text | t }}</p>
        <div class="row">
          <button class="btn btn-sm btn-ghost" type="button" (click)="close()">{{ 'Skip' | t }}</button>
          <span class="spacer"></span>
          @if (index()! > 0) { <button class="btn btn-sm" type="button" (click)="go(-1)">{{ 'Back' | t }}</button> }
          <button class="btn btn-sm btn-primary" type="button" (click)="go(1)">{{ (index()! === stops.length - 1 ? 'Start working' : 'Next') | t }}</button>
        </div>
      </div>
    }
  `,
  styles: `
    :host { position: fixed; inset: 0; z-index: 50; pointer-events: none; }
    .shade { position: absolute; inset: 0; pointer-events: auto; }
    .spot { position: absolute; border-radius: 10px; border: 2px solid var(--accent); box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
            pointer-events: none; transition: all 0.2s ease; }
    .bubble { position: absolute; width: 320px; padding: 14px 16px; border-radius: 12px; background: var(--bg-elev);
              border: 1px solid var(--accent); box-shadow: var(--shadow); pointer-events: auto; }
    .count { font-size: 11px; }
    h3 { margin: 4px 0 6px; font-size: 16px; }
    p { margin: 0 0 12px; font-size: 13.5px; line-height: 1.5; color: var(--text-muted); }
    .row { display: flex; gap: 6px; align-items: center; }
    .spacer { flex: 1; }
  `,
})
export class Tour {
  private readonly guide = inject(GuideStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly stops = STOPS;
  protected readonly index = this.guide.tour;
  protected readonly stop = computed(() => {
    const i = this.index();
    return i === null ? null : (STOPS[i] ?? null);
  });
  protected readonly rect = signal<DOMRect | null>(null);

  protected readonly pos = computed(() => {
    const r = this.rect();
    const w = 320;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!r) return { left: (vw - w) / 2, top: vh / 3 };
    // Below the target if there is room, else to its right, else above.
    let left = Math.min(Math.max(12, r.left), vw - w - 12);
    let top = r.bottom + 14;
    if (top + 190 > vh) {
      if (r.right + 14 + w < vw) {
        left = r.right + 14;
        top = Math.max(12, Math.min(r.top, vh - 210));
      } else {
        top = Math.max(12, r.top - 200);
      }
    }
    return { left, top };
  });

  constructor() {
    // The editor lays itself out in several passes (plan loading, panels): keep the highlight in place.
    afterRenderEffect(() => {
      this.stop();
      this.measure();
    });
    const timer = setInterval(() => this.measure(), 250);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private measure(): void {
    const s = this.stop();
    const root = this.host.parentElement ?? document.body;
    const el = s ? (s.target.split(",").map((t) => root.querySelector<HTMLElement>(`[data-tour="${t}"]`)).find((e) => !!e) ?? null) : null;
    const r = el?.getBoundingClientRect();
    const next = r && r.width > 0 ? r : null;
    const prev = this.rect();
    const same = prev && next && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height;
    if (!same && (prev || next)) this.rect.set(next);
  }

  protected go(delta: number): void {
    const next = (this.index() ?? 0) + delta;
    if (next >= STOPS.length) this.close();
    else this.index.set(Math.max(0, next));
  }

  protected close(): void {
    this.guide.closeTour();
  }
}
