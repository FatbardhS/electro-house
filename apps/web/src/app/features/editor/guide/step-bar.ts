import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { GUIDE_STEPS, GuideStore, type StepId } from '../state/guide.store';
import type { GuideProgress } from '../state/guide-progress';
import { I18N_PIPES } from '../../../core/i18n/t.pipe';

/** The five steps of the guided editor; done steps are green, the current one is outlined. */
@Component({
  selector: 'app-step-bar',
  imports: [I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol>
      @for (s of steps; track s.id; let i = $index) {
        <li>
          <button type="button" [class.current]="guide.step() === s.id" [class.done]="progress()?.steps?.[s.id]?.done"
                  [attr.aria-current]="guide.step() === s.id ? 'step' : null" (click)="go(s.id)">
            <span class="n">{{ progress()?.steps?.[s.id]?.done ? '✓' : i + 1 }}</span>
            <span class="t">{{ s.title | t }}</span>
          </button>
        </li>
        @if (i < steps.length - 1) { <li class="arrow" aria-hidden="true">›</li> }
      }
    </ol>
  `,
  styles: `
    :host { display: block; min-width: 0; overflow-x: auto; }
    ol { display: flex; align-items: center; gap: 4px; margin: 0; padding: 0; list-style: none; }
    button { display: flex; align-items: center; gap: 7px; height: 34px; padding: 0 12px 0 6px; border: 1px solid transparent;
             border-radius: 999px; background: transparent; color: var(--text-muted); font: 600 13px var(--font); cursor: pointer; white-space: nowrap; }
    button:hover { background: var(--bg-elev-2); color: var(--text); }
    .n { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 12px;
         background: var(--bg-elev-2); border: 1px solid var(--border); }
    button.done { color: var(--accent); }
    button.done .n { background: var(--accent); border-color: var(--accent); color: #06130d; }
    button.current { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
    button.current:not(.done) .n { border-color: var(--accent); color: var(--accent); }
    .arrow { color: var(--text-faint); font-size: 16px; }
    @media (max-width: 1100px) { .t { display: none; } button.current .t { display: inline; } }
  `,
})
export class StepBar {
  protected readonly guide = inject(GuideStore);
  readonly progress = input<GuideProgress | null>(null);
  protected readonly steps = GUIDE_STEPS;

  protected go(id: StepId): void {
    this.guide.step.set(id);
  }
}
