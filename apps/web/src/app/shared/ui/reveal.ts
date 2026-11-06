import { Directive, ElementRef, OnDestroy, afterNextRender, inject, input } from '@angular/core';

/**
 * Scroll-reveal: the element fades/slides in the first time it enters the viewport.
 * `appReveal="up|left|right|zoom"`, optional `[revealDelay]="120"` (ms) for staggering.
 * Styles live in styles.css (`.reveal`, `.revealed`).
 */
@Directive({
  selector: '[appReveal]',
  host: { class: 'reveal', '[attr.data-reveal]': 'appReveal() || "up"', '[style.--reveal-delay.ms]': 'revealDelay()' },
})
export class Reveal implements OnDestroy {
  readonly appReveal = input<string>('up');
  readonly revealDelay = input(0);
  private readonly el = inject(ElementRef<HTMLElement>);
  private observer?: IntersectionObserver;

  constructor() {
    afterNextRender(() => {
      const node = this.el.nativeElement as HTMLElement;
      if (typeof IntersectionObserver === 'undefined') {
        node.classList.add('revealed');
        return;
      }
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              node.classList.add('revealed');
              this.observer?.disconnect();
            }
          }
        },
        { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
      );
      this.observer.observe(node);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
