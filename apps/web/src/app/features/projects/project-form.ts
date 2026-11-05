import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { httpResource } from '@angular/common/http';
import { PROJECT_STATUSES, projectCreateSchema, type ClientDto, type ProjectDto } from '@electro/shared';
import { Api } from '../../core/api';
import { FormState } from '../../core/forms';
import { STATUS_LABELS } from './status';

/** Create or edit a project. When `clientId` is given the client is fixed. */
@Component({
  selector: 'app-project-form',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (form.formError(); as err) {
      <div class="banner banner-error" role="alert" style="margin-bottom: 14px">{{ err }}</div>
    }
    <form (ngSubmit)="submit()" novalidate>
      @if (!clientId()) {
        <div class="field">
          <label for="p-client">Client *</label>
          @if (clients.hasValue()) {
            <select id="p-client" class="input" name="clientId" [(ngModel)]="model.clientId"
                    [class.invalid]="form.error('clientId')">
              <option value="">Choose a client…</option>
              @for (c of clients.value(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
            </select>
            @if (clients.value().length === 0) {
              <span class="faint" style="font-size: 12px">No clients yet. Create a client first.</span>
            }
          } @else if (clients.error()) {
            <span class="field-error">Could not load clients.</span>
          } @else {
            <span class="faint">Loading clients…</span>
          }
          @if (form.error('clientId'); as e) { <span class="field-error">{{ e }}</span> }
        </div>
      }
      <div class="field">
        <label for="p-name">Project name *</label>
        <input id="p-name" class="input" name="name" [(ngModel)]="model.name" [class.invalid]="form.error('name')"
               placeholder="e.g. Family house renovation" />
        @if (form.error('name'); as e) { <span class="field-error">{{ e }}</span> }
      </div>
      <div class="field">
        <label for="p-address">Property address</label>
        <input id="p-address" class="input" name="propertyAddress" [(ngModel)]="model.propertyAddress" />
      </div>
      <div class="field">
        <label for="p-status">Status</label>
        <select id="p-status" class="input" name="status" [(ngModel)]="model.status">
          @for (s of statuses; track s) { <option [value]="s">{{ labels[s] }}</option> }
        </select>
      </div>
      <div class="field">
        <label for="p-desc">Description</label>
        <textarea id="p-desc" class="input" name="description" [(ngModel)]="model.description"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn" type="button" (click)="cancelled.emit()">Cancel</button>
        <button class="btn btn-primary" type="submit" [disabled]="form.submitting()">
          {{ form.submitting() ? 'Saving…' : project() ? 'Save changes' : 'Create project' }}
        </button>
      </div>
    </form>
  `,
})
export class ProjectForm {
  private readonly api = inject(Api);
  readonly clientId = input<string>();
  readonly project = input<ProjectDto | null>(null);
  readonly saved = output<ProjectDto>();
  readonly cancelled = output<void>();

  protected readonly statuses = PROJECT_STATUSES;
  protected readonly labels = STATUS_LABELS;
  protected readonly clients = httpResource<ClientDto[]>(() => (this.clientId() ? undefined : '/api/clients'));
  protected model = {
    clientId: '',
    name: '',
    propertyAddress: '',
    description: '',
    status: 'PLANNING' as (typeof PROJECT_STATUSES)[number],
  };
  protected readonly form = new FormState(projectCreateSchema);

  ngOnInit(): void {
    const p = this.project();
    this.model.clientId = this.clientId() ?? p?.clientId ?? '';
    if (p) {
      this.model.name = p.name;
      this.model.propertyAddress = p.propertyAddress ?? '';
      this.model.description = p.description ?? '';
      this.model.status = p.status;
    }
  }

  protected async submit(): Promise<void> {
    const existing = this.project();
    await this.form.submit(this.model, async (value) => {
      const saved = existing ? await this.api.updateProject(existing.id, value) : await this.api.createProject(value);
      this.saved.emit(saved);
    });
  }
}
