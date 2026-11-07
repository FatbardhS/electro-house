import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CHECKS, type Issue } from '@electro/shared';
import { GUIDE_STEPS, GuideStore, stepIndex } from '../state/guide.store';
import type { GuideProgress } from '../state/guide-progress';
import { I18N_PIPES } from '../../../core/i18n/t.pipe';
import type { TKey } from '../../../core/i18n/sq';

const COUNT_LABEL: Record<string, TKey> = {
  lights: 'Lights',
  outlets: 'Outlets',
  switches: 'Switches',
  wires: 'Wires',
  'not connected': 'Without a wire',
  problems: 'Problems to fix',
};

/** Right panel of the guided editor when nothing is selected: progress, warnings for this step, next step. */
@Component({
  selector: 'app-progress-panel',
  imports: [I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-tour="progress">
      <h3>{{ 'Your progress' | t }}</h3>
      <ul class="steps">
        @for (s of steps; track s.id; let i = $index) {
          @let p = progress()?.steps?.[s.id];
          <li [class.current]="guide.step() === s.id">
            <button type="button" (click)="guide.step.set(s.id)">
              <span class="mark" [class.done]="p?.done">{{ p?.done ? '✓' : i + 1 }}</span>
              <span class="name">{{ s.title | t }}</span>
            </button>
            @if (p?.counts?.length) {
              <div class="counts">
                @for (c of p!.counts; track c.label) {
                  <span [class.warn]="(c.label === 'not connected' || c.label === 'problems') && c.n > 0">{{ label(c.label) | t }}: <b>{{ c.n }}</b></span>
                }
              </div>
            }
          </li>
        }
      </ul>
    </section>

    @if (stepIssues().length) {
      <section>
        <h3>{{ 'Worth a look' | t }}</h3>
        @for (i of stepIssues(); track i.id) {
          <button type="button" class="issue" [class]="'issue ' + i.severity" (click)="focus.emit(i)">
            <strong>{{ titles[i.code] | tx }}</strong>
            <span>{{ i.message | tx }}</span>
          </button>
        }
        @if (moreIssues() > 0) { <p class="faint small">{{ '+{n} more in step 5' | t: { n: moreIssues() } }}</p> }
      </section>
    }

    @if (next(); as n) {
      <button class="btn btn-primary next" type="button" (click)="guide.step.set(n.id)">{{ 'Next: {step}' | t: { step: (n.title | t) } }} →</button>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 18px; }
    section { display: flex; flex-direction: column; gap: 6px; }
    h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-faint); margin: 0; }
    .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .steps li { padding: 6px 8px; border-radius: var(--radius); border: 1px solid transparent; }
    .steps li.current { border-color: var(--accent); background: var(--accent-soft); }
    .steps button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 0; border: 0; background: none;
                    color: var(--text); font: 600 13px var(--font); cursor: pointer; text-align: left; }
    .mark { flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px;
            border: 1px solid var(--border); color: var(--text-muted); }
    .mark.done { background: var(--accent); border-color: var(--accent); color: #06130d; }
    .counts { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 4px 0 0 28px; font-size: 12px; color: var(--text-muted); }
    .counts b { color: var(--text); }
    .counts .warn, .counts .warn b { color: var(--warn); }
    .issue { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 8px 10px; border-radius: var(--radius);
             border: 1px solid var(--border); background: var(--bg-elev-2); color: var(--text-muted); font: 12px var(--font); cursor: pointer; line-height: 1.35; }
    .issue strong { color: var(--text); font-weight: 600; }
    .issue.warning { border-left: 3px solid var(--warn); }
    .issue.error { border-left: 3px solid var(--danger); }
    .issue:hover { border-color: var(--border-strong); }
    .small { font-size: 12px; margin: 0; }
    .next { width: 100%; min-height: 42px; justify-content: center; font-size: 14px; }
  `,
})
export class ProgressPanel {
  protected readonly guide = inject(GuideStore);
  readonly progress = input<GuideProgress | null>(null);
  readonly issues = input<Issue[]>([]);
  readonly focus = output<Issue>();
  protected readonly steps = GUIDE_STEPS;
  protected readonly titles = CHECKS;

  private readonly allStepIssues = computed(() => {
    const step = GUIDE_STEPS[stepIndex(this.guide.step())]!;
    return this.issues().filter((i) => step.checks.includes(i.code));
  });
  protected readonly stepIssues = computed(() => this.allStepIssues().slice(0, 5));
  protected readonly moreIssues = computed(() => this.allStepIssues().length - this.stepIssues().length);
  protected readonly next = computed(() => GUIDE_STEPS[stepIndex(this.guide.step()) + 1] ?? null);

  protected label(key: string): TKey {
    return COUNT_LABEL[key]!;
  }
}
