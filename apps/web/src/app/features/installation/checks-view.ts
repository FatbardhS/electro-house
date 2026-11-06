import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  CHECKS,
  applyIgnored,
  runChecks,
  type InstallationDto,
  type Issue,
  type MaterialDto,
  type MaterialRuleDto,
  type Severity,
} from '@electro/shared';
import { Api } from '../../core/api';
import { toApiError } from '../../core/api-error';
import { EmptyState } from '../../shared/ui/states';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import type { TKey } from '../../core/i18n/sq';
import { t, tx } from '../../core/i18n/i18n.service';

const SEVERITY_LABEL: Record<Severity, TKey> = { error: 'Error', warning: 'Warning', info: 'Info' };
const SEVERITY_PLURAL: Record<Severity, TKey> = { error: 'Errors', warning: 'Warnings', info: 'Notes' };

/** All validation issues of the project, grouped by floor, with "show on plan" and ignore / restore. */
@Component({
  selector: 'app-checks-view',
  imports: [I18N_PIPES, RouterLink, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = result();
    <div class="bar">
      @for (s of severities; track s) {
        <button type="button" class="chip" [class]="'chip ' + s" [class.on]="shown().has(s)" (click)="toggle(s)">
          {{ r.summary[s] }} {{ (r.summary[s] === 1 ? label[s] : plural[s]) | t }}</button>
      }
      <label class="faint small check"><input type="checkbox" [checked]="showIgnored()" (change)="showIgnored.set($any($event.target).checked)" />
        {{ 'Show ignored ({n})' | t: { n: r.summary.ignored } }}</label>
      @if (!pricesLoaded()) { <span class="faint small">{{ 'Price checks load with the price list…' | t }}</span> }
    </div>
    @if (error(); as e) { <div class="banner banner-error" role="alert">{{ e | tx }}</div> }

    @if (groups().length === 0) {
      <div class="card">
        <app-empty-state [heading]="(r.open.length === 0 ? 'No problems found' : 'Nothing matches the filter') | t"
          [text]="(r.open.length === 0 ? 'The checks found nothing to fix in this project.' : 'Turn on more severities above to see them.') | t" />
      </div>
    }
    @for (g of groups(); track g.key) {
      <section class="card group">
        <h3>{{ g.name }} <span class="faint">· {{ g.items.length }}</span></h3>
        <ul>
          @for (i of g.items; track i.issue.id) {
            <li [class.ignored]="i.ignored">
              <span class="sev" [class]="'sev ' + i.issue.severity">{{ label[i.issue.severity] | t }}</span>
              <div class="text">
                <div class="title">{{ checkTitle[i.issue.code] | tx }} <span class="faint mono small">{{ i.issue.code }}</span></div>
                <div class="msg">{{ i.issue.message }}</div>
              </div>
              <div class="acts">
                @if (i.issue.floorId && (i.issue.componentIds.length || i.issue.wireIds.length)) {
                  <a class="btn btn-sm" [routerLink]="['/projects', installation().projectId, 'floors', i.issue.floorId]"
                     [queryParams]="{ select: [...i.issue.componentIds, ...i.issue.wireIds].join(',') }">{{ 'Show on plan' | t }}</a>
                } @else if (i.issue.floorId) {
                  <a class="btn btn-sm" [routerLink]="['/projects', installation().projectId, 'floors', i.issue.floorId]">{{ 'Open floor' | t }}</a>
                }
                @if (i.ignored) {
                  <button class="btn btn-sm btn-ghost" type="button" (click)="restore(i.issue)" [disabled]="busy()">{{ 'Restore' | t }}</button>
                } @else {
                  <button class="btn btn-sm btn-ghost" type="button" (click)="ignore(i.issue)" [disabled]="busy()" [title]="'Hide this issue for this project' | t">{{ 'Ignore' | t }}</button>
                }
              </div>
            </li>
          }
        </ul>
      </section>
    }
    <p class="faint small">{{ 'Checks use the plans and the limits in your rules profile. They are planning aids, not a certification.' | t }}</p>
  `,
  styles: `
    .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
    .chip { padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: none; color: var(--text-muted);
            font: 600 12px var(--font); cursor: pointer; opacity: 0.55; }
    .chip.on { opacity: 1; }
    .chip.error.on { color: #ff8a8a; border-color: rgba(240, 106, 106, 0.5); }
    .chip.warning.on { color: var(--warn); border-color: var(--warn); }
    .chip.info.on { color: var(--accent); border-color: var(--accent); }
    .check { display: flex; gap: 6px; align-items: center; }
    .small { font-size: 12px; }
    .banner { margin-bottom: 12px; }
    .group { margin-bottom: 12px; }
    h3 { margin: 0; padding: 10px 14px; font-size: 13.5px; border-bottom: 1px solid var(--border); }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: flex; gap: 12px; align-items: flex-start; padding: 10px 14px; border-bottom: 1px solid var(--border); }
    li:last-child { border-bottom: 0; }
    li.ignored { opacity: 0.5; }
    .sev { flex: none; width: 64px; text-align: center; font-size: 11px; font-weight: 700; padding: 2px 0; border-radius: 4px; }
    .sev.error { color: #ff8a8a; background: rgba(240, 106, 106, 0.14); }
    .sev.warning { color: var(--warn); background: var(--warn-soft); }
    .sev.info { color: var(--accent); background: var(--accent-soft); }
    .text { flex: 1; min-width: 0; }
    .title { font-weight: 600; font-size: 13px; }
    .msg { font-size: 13px; color: var(--text-muted); margin-top: 2px; }
    .acts { display: flex; gap: 6px; flex: none; }
    @media (max-width: 640px) { li { flex-wrap: wrap; } .acts { width: 100%; justify-content: flex-end; } }
  `,
})
export class ChecksView {
  private readonly api = inject(Api);
  readonly installation = input.required<InstallationDto>();
  readonly changed = output<void>();

  private readonly materials = httpResource<MaterialDto[]>(() => '/api/materials');
  private readonly rules = httpResource<MaterialRuleDto[]>(() => '/api/material-rules');
  protected readonly severities: Severity[] = ['error', 'warning', 'info'];
  protected readonly label = SEVERITY_LABEL;
  protected readonly plural = SEVERITY_PLURAL;
  protected readonly checkTitle = CHECKS;
  protected readonly shown = signal(new Set<Severity>(['error', 'warning', 'info']));
  protected readonly showIgnored = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pricesLoaded = computed(() => this.materials.hasValue() && this.rules.hasValue());

  protected readonly result = computed(() => {
    const opts = this.pricesLoaded() ? { materials: this.materials.value()!, rules: this.rules.value()! } : {};
    return applyIgnored(runChecks(this.installation(), opts), this.installation().ignoredIssues);
  });

  protected readonly groups = computed(() => {
    const r = this.result();
    const items = [
      ...r.open.map((issue) => ({ issue, ignored: false })),
      ...(this.showIgnored() ? r.ignored.map((issue) => ({ issue, ignored: true })) : []),
    ].filter((i) => i.ignored || this.shown().has(i.issue.severity));
    const floors = this.installation().floors;
    const order = [null, ...floors.map((f) => f.floorId)];
    return order
      .map((floorId) => ({
        key: floorId ?? 'project',
        name: floorId ? (floors.find((f) => f.floorId === floorId)?.name ?? t('Floor')) : t('Whole project'),
        items: items.filter((i) => i.issue.floorId === floorId),
      }))
      .filter((g) => g.items.length);
  });

  protected toggle(s: Severity): void {
    this.shown.update((set) => {
      const next = new Set(set);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  protected ignore(i: Issue): Promise<void> {
    return this.run(() => this.api.ignoreIssue(this.installation().projectId, i.id));
  }

  protected restore(i: Issue): Promise<void> {
    return this.run(() => this.api.restoreIssue(this.installation().projectId, i.id));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      this.changed.emit();
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
