import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Product mark: a lightning bolt inside a rounded square. */
@Component({
  selector: 'app-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" stroke="currentColor" stroke-width="1.6" />
      <path d="M13.2 4.8 7.6 13h4.1l-1 6.2 5.7-8.4h-4.1l.9-6Z" fill="currentColor" />
    </svg>
  `,
  styles: `:host { display: inline-flex; color: var(--accent); }`,
})
export class BrandMark {
  readonly size = input(22);
}
