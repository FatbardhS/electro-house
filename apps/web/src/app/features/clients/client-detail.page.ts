import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import type { ClientDto, ProjectDto, ProjectSummaryDto } from '@electro/shared';
import { Api } from '../../core/api';
import { errorMessage, toApiError } from '../../core/api-error';
import { ConfirmService } from '../../shared/ui/confirm-dialog';
import { Modal } from '../../shared/ui/modal';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/states';
import { ProjectForm } from '../projects/project-form';
import { ProjectTable } from '../projects/project-table';
import { ClientForm } from './client-form';

@Component({
  selector: 'app-client-detail-page',
  imports: [RouterLink, LoadingState, ErrorState, EmptyState, Modal, ClientForm, ProjectForm, ProjectTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <a routerLink="/clients" class="back">← Clients</a>

      @if (client.error(); as err) {
        <app-error-state [message]="message(err)" (retry)="client.reload()" />
      } @else if (!client.hasValue()) {
        <app-loading />
      } @else {
        @let c = client.value();
        <div class="page-header">
          <div>
            <h1>{{ c.name }}</h1>
            <div class="subtitle">
              {{ contactLine(c) }}
            </div>
          </div>
          <div style="display: flex; gap: 8px">
            <button class="btn" type="button" (click)="editing.set(true)">Edit</button>
            <button class="btn btn-danger" type="button" (click)="remove(c)">Delete</button>
          </div>
        </div>

        @if (actionError(); as e) { <div class="banner banner-error" role="alert" style="margin-bottom: 14px">{{ e }}</div> }
        @if (c.notes) { <div class="card notes">{{ c.notes }}</div> }

        <div class="section-head">
          <h2>Projects</h2>
          <button class="btn btn-primary" type="button" (click)="creatingProject.set(true)">+ New project</button>
        </div>
        <div class="card">
          @if (projects.error(); as err) {
            <app-error-state [message]="message(err)" (retry)="projects.reload()" />
          } @else if (!projects.hasValue()) {
            <app-loading />
          } @else if (projects.value().length === 0) {
            <app-empty-state heading="No projects for this client yet"
                             text="Create a project, add its floors and upload the floor plan PDFs.">
              <button class="btn btn-primary" type="button" (click)="creatingProject.set(true)">+ New project</button>
            </app-empty-state>
          } @else {
            <app-project-table [projects]="projects.value()" [showClient]="false" />
          }
        </div>

        <app-modal heading="Edit client" [open]="editing()" (closed)="editing.set(false)">
          @if (editing()) {
            <app-client-form [client]="c" (saved)="editing.set(false); client.reload()" (cancelled)="editing.set(false)" />
          }
        </app-modal>
        <app-modal heading="New project for {{ c.name }}" [open]="creatingProject()" (closed)="creatingProject.set(false)">
          @if (creatingProject()) {
            <app-project-form [clientId]="c.id" (saved)="onProjectCreated($event)" (cancelled)="creatingProject.set(false)" />
          }
        </app-modal>
      }
    </div>
  `,
  styles: `
    .back { display: inline-block; margin-bottom: 12px; color: var(--text-muted); }
    .notes { padding: 14px 16px; white-space: pre-line; color: var(--text-muted); margin-bottom: 20px; }
    .section-head { display: flex; align-items: center; justify-content: space-between; margin: 24px 0 12px; }
  `,
})
export class ClientDetailPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);

  readonly clientId = input.required<string>();
  protected readonly editing = signal(false);
  protected readonly creatingProject = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected readonly client = httpResource<ClientDto>(() => `/api/clients/${this.clientId()}`);
  protected readonly projects = httpResource<ProjectSummaryDto[]>(
    () => `/api/projects?clientId=${encodeURIComponent(this.clientId())}`,
  );
  protected message = errorMessage;

  protected contactLine(c: ClientDto): string {
    return [c.phone, c.email, c.address].filter((v): v is string => !!v).join(' · ') || 'No contact details yet';
  }

  protected async remove(c: ClientDto): Promise<void> {
    this.actionError.set(null);
    const ok = await this.confirm.ask({
      title: 'Delete client?',
      message: `“${c.name}” will be deleted permanently.`,
      confirmLabel: 'Delete client',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.deleteClient(c.id);
      await this.router.navigate(['/clients']);
    } catch (err) {
      this.actionError.set(toApiError(err).message);
    }
  }

  protected onProjectCreated(p: ProjectDto): void {
    this.creatingProject.set(false);
    void this.router.navigate(['/projects', p.id]);
  }
}
