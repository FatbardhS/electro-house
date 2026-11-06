import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import type { ProjectSummaryDto } from '@electro/shared';
import { STATUS_LABELS } from './status';
import { I18N_PIPES } from '../../core/i18n/t.pipe';

@Component({
  selector: 'app-project-table',
  imports: [I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <table class="table">
      <thead>
        <tr>
          <th>{{ 'Project' | t }}</th>
          @if (showClient()) { <th>{{ 'Client' | t }}</th> }
          <th>{{ 'Status' | t }}</th>
          <th style="text-align: right">{{ 'Floors' | t }}</th>
          <th style="text-align: right">{{ 'Updated' | t }}</th>
        </tr>
      </thead>
      <tbody>
        @for (p of projects(); track p.id) {
          <tr class="clickable" tabindex="0" (click)="open(p)" (keydown.enter)="open(p)">
            <td><strong>{{ p.name }}</strong>@if (p.propertyAddress) {<div class="faint">{{ p.propertyAddress }}</div>}</td>
            @if (showClient()) { <td class="muted">{{ p.clientName }}</td> }
            <td><span class="badge badge-{{ p.status.toLowerCase() }}">{{ labels[p.status] | t }}</span></td>
            <td style="text-align: right">{{ p.floorCount }}</td>
            <td style="text-align: right" class="muted">{{ p.updatedAt | ldate }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class ProjectTable {
  private readonly router = inject(Router);
  readonly projects = input.required<ProjectSummaryDto[]>();
  readonly showClient = input(true);
  protected readonly labels = STATUS_LABELS;

  protected open(p: ProjectSummaryDto): void {
    void this.router.navigate(['/projects', p.id]);
  }
}
