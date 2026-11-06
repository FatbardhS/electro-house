import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { applyIgnored, boardSchedules, circuitLoads, installationTotals, runChecks, type InstallationDto, type ProjectDto } from '@electro/shared';
import { errorMessage } from '../../core/api-error';
import { ErrorState, LoadingState } from '../../shared/ui/states';
import { BoardsView } from './boards-view';
import { CircuitsTable } from './circuits-table';
import { LinksView } from './links-view';
import { ProfileForm } from './profile-form';
import { TotalsView } from './totals-view';
import { MaterialsView } from './materials-view';
import { ExportDialog } from './export-dialog';
import { ChecksView } from './checks-view';
import { Modal } from '../../shared/ui/modal';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import type { TKey } from '../../core/i18n/sq';

type Tab = 'circuits' | 'boards' | 'links' | 'totals' | 'materials' | 'checks' | 'rules';

/** Electrical management of a whole project: circuits, boards, floor connections, calculations. */
@Component({
  selector: 'app-installation-page',
  imports: [I18N_PIPES, RouterLink, LoadingState, ErrorState, CircuitsTable, BoardsView, LinksView, TotalsView, MaterialsView, ProfileForm, ExportDialog, Modal, ChecksView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page wide">
      <a class="back" [routerLink]="['/projects', projectId()]">← {{ project.hasValue() ? project.value().name : ('Project' | t) }}</a>
      <div class="page-header">
        <div>
          <h1>{{ 'Circuits & calculations' | t }}</h1>
          <div class="subtitle">{{ 'Values update from the floor plans. Loads and currents are estimates for planning; verify against your national standard.' | t }}</div>
        </div>
        <button class="btn btn-primary" type="button" (click)="exporting.set(true)" [disabled]="!data.hasValue()">{{ 'Export PDF' | t }}</button>
      </div>

      <app-modal [heading]="'Export PDF' | t" [open]="exporting()" (closed)="exporting.set(false)">
        @if (exporting() && data.hasValue()) {
          <app-export-dialog [installation]="data.value()" [projectName]="project.hasValue() ? project.value().name : 'project'" (closed)="exporting.set(false)" />
        }
      </app-modal>

      <div class="tabs" role="tablist">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" [class.active]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label | t }}
            @if (t.id === 'checks' && checkCount(); as n) { <span class="count" [class.err]="checkErrors() > 0">{{ n }}</span> }</button>
        }
      </div>

      @if (data.error(); as err) {
        <app-error-state [message]="message(err)" (retry)="data.reload()" />
      } @else if (!data.hasValue()) {
        <app-loading [label]="'Loading installation…' | t" />
      } @else {
        @let inst = data.value();
        @switch (tab()) {
          @case ('circuits') { <app-circuits-table [installation]="inst" [loads]="loads()" (changed)="data.reload()" /> }
          @case ('boards') { <app-boards-view [installation]="inst" [schedules]="schedules()" /> }
          @case ('links') { <app-links-view [installation]="inst" (changed)="data.reload()" /> }
          @case ('totals') { <app-totals-view [installation]="inst" [totals]="totals()" [loads]="loads()" /> }
          @case ('materials') { <app-materials-view [installation]="inst" (changed)="data.reload()" /> }
          @case ('checks') { <app-checks-view [installation]="inst" (changed)="data.reload()" /> }
          @case ('rules') { <app-profile-form [projectId]="projectId()" [profile]="inst.profile" (changed)="data.reload()" /> }
        }
      }
    </div>
  `,
  styles: `
    .wide { max-width: 1500px; }
    .back { display: inline-block; margin-bottom: 12px; color: var(--text-muted); }
    .tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
    .tabs button { padding: 8px 14px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--text-muted);
                   font: 600 13px var(--font); cursor: pointer; }
    .tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tabs { overflow-x: auto; }
    .tabs button { white-space: nowrap; }
    .count { margin-left: 6px; padding: 1px 7px; border-radius: 999px; font-size: 11px; background: var(--warn-soft); color: var(--warn); }
    .count.err { background: rgba(240, 106, 106, 0.16); color: #ff8a8a; }
  `,
})
export class InstallationPage {
  readonly projectId = input.required<string>();
  protected readonly project = httpResource<ProjectDto>(() => `/api/projects/${this.projectId()}`);
  protected readonly data = httpResource<InstallationDto>(() => `/api/projects/${this.projectId()}/installation`);
  /** `?tab=` query parameter (bound by the router), e.g. links to the Checks tab. */
  readonly initialTab = input<string | undefined>(undefined, { alias: 'tab' });
  protected readonly tabs: { id: Tab; label: TKey }[] = [
    { id: 'circuits', label: 'Circuits' },
    { id: 'boards', label: 'Distribution boards' },
    { id: 'links', label: 'Floor connections' },
    { id: 'totals', label: 'Calculations' },
    { id: 'materials', label: 'Materials & costs' },
    { id: 'checks', label: 'Checks' },
    { id: 'rules', label: 'Rules profile' },
  ];
  protected readonly tab = linkedSignal<Tab>(() => {
    const t = this.initialTab();
    return this.tabs.some((x) => x.id === t) ? (t as Tab) : 'circuits';
  });
  protected readonly exporting = signal(false);
  /** Open errors + warnings (price checks excluded here; they are info only). */
  private readonly checkSummary = computed(() =>
    this.data.hasValue() ? applyIgnored(runChecks(this.data.value()), this.data.value().ignoredIssues).summary : null,
  );
  protected readonly checkErrors = computed(() => this.checkSummary()?.error ?? 0);
  protected readonly checkCount = computed(() => (this.checkSummary() ? this.checkSummary()!.error + this.checkSummary()!.warning : 0));
  protected message = errorMessage;

  protected readonly loads = computed(() => (this.data.hasValue() ? circuitLoads(this.data.value()) : []));
  protected readonly schedules = computed(() => (this.data.hasValue() ? boardSchedules(this.data.value(), this.loads()) : []));
  protected readonly totals = computed(() => (this.data.hasValue() ? installationTotals(this.data.value()) : null));
}
