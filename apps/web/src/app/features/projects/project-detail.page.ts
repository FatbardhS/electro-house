import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import type { ProjectDto } from '@electro/shared';
import { Api } from '../../core/api';
import { errorMessage, toApiError } from '../../core/api-error';
import { ConfirmService } from '../../shared/ui/confirm-dialog';
import { Modal } from '../../shared/ui/modal';
import { ErrorState, LoadingState } from '../../shared/ui/states';
import { FloorList } from './floor-list';
import { ProjectForm } from './project-form';
import { STATUS_LABELS } from './status';

@Component({
  selector: 'app-project-detail-page',
  imports: [RouterLink, DatePipe, LoadingState, ErrorState, Modal, ProjectForm, FloorList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (project.error(); as err) {
        <a routerLink="/projects" class="back">← Projects</a>
        <app-error-state [message]="message(err)" (retry)="project.reload()" />
      } @else if (!project.hasValue()) {
        <app-loading />
      } @else {
        @let p = project.value();
        <a [routerLink]="['/clients', p.clientId]" class="back">← {{ p.clientName }}</a>
        <div class="page-header">
          <div>
            <h1>{{ p.name }} <span class="badge badge-{{ p.status.toLowerCase() }}">{{ labels[p.status] }}</span></h1>
            <div class="subtitle">
              {{ p.propertyAddress || 'No property address' }} · created {{ p.createdAt | date: 'mediumDate' }}
            </div>
          </div>
          <div style="display: flex; gap: 8px">
            <a class="btn btn-primary" [routerLink]="['/projects', p.id, 'installation']">Circuits & calculations</a>
            <button class="btn" type="button" (click)="editing.set(true)">Edit</button>
            <button class="btn btn-danger" type="button" (click)="remove(p)">Delete</button>
          </div>
        </div>
        @if (actionError(); as e) { <div class="banner banner-error" role="alert" style="margin-bottom: 14px">{{ e }}</div> }
        @if (p.description) { <div class="card desc">{{ p.description }}</div> }

        <div class="section-head">
          <h2>Floors</h2>
          <span class="faint">Order from bottom (basement) to top (attic).</span>
        </div>
        <div class="card">
          <app-floor-list [projectId]="p.id" [floors]="p.floors" (changed)="project.reload()" />
        </div>

        <app-modal heading="Edit project" [open]="editing()" (closed)="editing.set(false)">
          @if (editing()) {
            <app-project-form [project]="p" (saved)="editing.set(false); project.reload()" (cancelled)="editing.set(false)" />
          }
        </app-modal>
      }
    </div>
  `,
  styles: `
    .back { display: inline-block; margin-bottom: 12px; color: var(--text-muted); }
    h1 .badge { vertical-align: middle; margin-left: 8px; }
    .desc { padding: 14px 16px; white-space: pre-line; color: var(--text-muted); margin-bottom: 8px; }
    .section-head { display: flex; align-items: baseline; gap: 12px; margin: 24px 0 12px; }
  `,
})
export class ProjectDetailPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);

  readonly projectId = input.required<string>();
  protected readonly project = httpResource<ProjectDto>(() => `/api/projects/${this.projectId()}`);
  protected readonly editing = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly labels = STATUS_LABELS;
  protected message = errorMessage;

  protected async remove(p: ProjectDto): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Delete project?',
      message: `“${p.name}” with ${p.floors.length} floor(s), their plan PDFs and drawings will be deleted permanently.`,
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.deleteProject(p.id);
      await this.router.navigate(['/clients', p.clientId]);
    } catch (err) {
      this.actionError.set(toApiError(err).message);
    }
  }
}
