import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { boardSchedules, circuitLoads, installationTotals, type InstallationDto, type ProjectDto } from '@electro/shared';
import { errorMessage } from '../../core/api-error';
import { ErrorState, LoadingState } from '../../shared/ui/states';
import { BoardsView } from './boards-view';
import { CircuitsTable } from './circuits-table';
import { LinksView } from './links-view';
import { ProfileForm } from './profile-form';
import { TotalsView } from './totals-view';
import { MaterialsView } from './materials-view';
import { ExportDialog } from './export-dialog';
import { Modal } from '../../shared/ui/modal';

type Tab = 'circuits' | 'boards' | 'links' | 'totals' | 'materials' | 'rules';

/** Electrical management of a whole project: circuits, boards, floor connections, calculations. */
@Component({
  selector: 'app-installation-page',
  imports: [RouterLink, LoadingState, ErrorState, CircuitsTable, BoardsView, LinksView, TotalsView, MaterialsView, ProfileForm, ExportDialog, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page wide">
      <a class="back" [routerLink]="['/projects', projectId()]">← {{ project.hasValue() ? project.value().name : 'Project' }}</a>
      <div class="page-header">
        <div>
          <h1>Circuits & calculations</h1>
          <div class="subtitle">Values update from the floor plans. Loads and currents are estimates for planning; verify against your national standard.</div>
        </div>
        <button class="btn btn-primary" type="button" (click)="exporting.set(true)" [disabled]="!data.hasValue()">Export PDF</button>
      </div>

      <app-modal heading="Export PDF" [open]="exporting()" (closed)="exporting.set(false)">
        @if (exporting() && data.hasValue()) {
          <app-export-dialog [installation]="data.value()" [projectName]="project.hasValue() ? project.value().name : 'project'" (closed)="exporting.set(false)" />
        }
      </app-modal>

      <div class="tabs" role="tablist">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" [class.active]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
        }
      </div>

      @if (data.error(); as err) {
        <app-error-state [message]="message(err)" (retry)="data.reload()" />
      } @else if (!data.hasValue()) {
        <app-loading label="Loading installation…" />
      } @else {
        @let inst = data.value();
        @switch (tab()) {
          @case ('circuits') { <app-circuits-table [installation]="inst" [loads]="loads()" (changed)="data.reload()" /> }
          @case ('boards') { <app-boards-view [installation]="inst" [schedules]="schedules()" /> }
          @case ('links') { <app-links-view [installation]="inst" (changed)="data.reload()" /> }
          @case ('totals') { <app-totals-view [installation]="inst" [totals]="totals()" [loads]="loads()" /> }
          @case ('materials') { <app-materials-view [installation]="inst" (changed)="data.reload()" /> }
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
  `,
})
export class InstallationPage {
  readonly projectId = input.required<string>();
  protected readonly project = httpResource<ProjectDto>(() => `/api/projects/${this.projectId()}`);
  protected readonly data = httpResource<InstallationDto>(() => `/api/projects/${this.projectId()}/installation`);
  protected readonly tab = signal<Tab>('circuits');
  protected readonly exporting = signal(false);
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'circuits', label: 'Circuits' },
    { id: 'boards', label: 'Distribution boards' },
    { id: 'links', label: 'Floor connections' },
    { id: 'totals', label: 'Calculations' },
    { id: 'materials', label: 'Materials & costs' },
    { id: 'rules', label: 'Rules profile' },
  ];
  protected message = errorMessage;

  protected readonly loads = computed(() => (this.data.hasValue() ? circuitLoads(this.data.value()) : []));
  protected readonly schedules = computed(() => (this.data.hasValue() ? boardSchedules(this.data.value(), this.loads()) : []));
  protected readonly totals = computed(() => (this.data.hasValue() ? installationTotals(this.data.value()) : null));
}
