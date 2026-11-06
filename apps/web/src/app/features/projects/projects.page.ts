import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Router } from '@angular/router';
import type { ProjectDto, ProjectSummaryDto } from '@electro/shared';
import { errorMessage } from '../../core/api-error';
import { Modal } from '../../shared/ui/modal';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/states';
import { ProjectForm } from './project-form';
import { ProjectTable } from './project-table';
import { I18N_PIPES } from '../../core/i18n/t.pipe';

@Component({
  selector: 'app-projects-page',
  imports: [I18N_PIPES, LoadingState, ErrorState, EmptyState, Modal, ProjectForm, ProjectTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>{{ 'Projects' | t }}</h1>
          <div class="subtitle">{{ 'All projects, most recently changed first.' | t }}</div>
        </div>
        <button class="btn btn-primary" type="button" (click)="creating.set(true)">+ {{ 'New project' | t }}</button>
      </div>
      <input class="input search" type="search" [placeholder]="'Search by project, client or address…' | t"
             [attr.aria-label]="'Search projects' | t" (input)="onSearch($any($event.target).value)" />
      <div class="card">
        @if (projects.error(); as err) {
          <app-error-state [message]="message(err)" (retry)="projects.reload()" />
        } @else if (!projects.hasValue()) {
          <app-loading [label]="'Loading projects…' | t" />
        } @else if (projects.value().length === 0) {
          @if (search()) {
            <app-empty-state [heading]="'No projects match “{q}”' | t: { q: search() }" />
          } @else {
            <app-empty-state [heading]="'No projects yet' | t" [text]="'Projects are created for a client.' | t">
              <button class="btn btn-primary" type="button" (click)="creating.set(true)">+ {{ 'New project' | t }}</button>
            </app-empty-state>
          }
        } @else {
          <app-project-table [projects]="projects.value()" />
        }
      </div>
    </div>
    <app-modal [heading]="'New project' | t" [open]="creating()" (closed)="creating.set(false)">
      @if (creating()) {
        <app-project-form (saved)="onCreated($event)" (cancelled)="creating.set(false)" />
      }
    </app-modal>
  `,
  styles: `.search { max-width: 360px; margin-bottom: 14px; }`,
})
export class ProjectsPage {
  private readonly router = inject(Router);
  protected readonly search = signal('');
  protected readonly creating = signal(false);
  private debounce?: ReturnType<typeof setTimeout>;

  protected readonly projects = httpResource<ProjectSummaryDto[]>(() => {
    const q = this.search().trim();
    return q ? `/api/projects?search=${encodeURIComponent(q)}` : '/api/projects';
  });
  protected message = errorMessage;

  protected onSearch(value: string): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.search.set(value), 250);
  }

  protected onCreated(p: ProjectDto): void {
    this.creating.set(false);
    void this.router.navigate(['/projects', p.id]);
  }
}
