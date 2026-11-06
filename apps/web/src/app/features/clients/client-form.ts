import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { clientInputSchema, type ClientDto } from '@electro/shared';
import { Api } from '../../core/api';
import { FormState } from '../../core/forms';
import { I18N_PIPES } from '../../core/i18n/t.pipe';

/** Create or edit a client. Emits the saved client. */
@Component({
  selector: 'app-client-form',
  imports: [I18N_PIPES, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (form.formError(); as err) {
      <div class="banner banner-error" role="alert" style="margin-bottom: 14px">{{ err | tx }}</div>
    }
    <form (ngSubmit)="submit()" novalidate>
      <div class="field">
        <label for="c-name">{{ 'Client name *' | t }}</label>
        <input id="c-name" class="input" name="name" [(ngModel)]="model.name" [class.invalid]="form.error('name')"
               [placeholder]="'Person or company' | t" autofocus />
        @if (form.error('name'); as e) { <span class="field-error">{{ e | tx }}</span> }
      </div>
      <div class="form-row">
        <div class="field">
          <label for="c-phone">{{ 'Phone' | t }}</label>
          <input id="c-phone" class="input" name="phone" [(ngModel)]="model.phone" />
          @if (form.error('phone'); as e) { <span class="field-error">{{ e | tx }}</span> }
        </div>
        <div class="field">
          <label for="c-email">{{ 'Email' | t }}</label>
          <input id="c-email" class="input" type="email" name="email" [(ngModel)]="model.email"
                 [class.invalid]="form.error('email')" />
          @if (form.error('email'); as e) { <span class="field-error">{{ e | tx }}</span> }
        </div>
      </div>
      <div class="field">
        <label for="c-address">{{ 'Address' | t }}</label>
        <input id="c-address" class="input" name="address" [(ngModel)]="model.address" />
      </div>
      <div class="field">
        <label for="c-notes">{{ 'Notes' | t }}</label>
        <textarea id="c-notes" class="input" name="notes" [(ngModel)]="model.notes"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn" type="button" (click)="cancelled.emit()">{{ 'Cancel' | t }}</button>
        <button class="btn btn-primary" type="submit" [disabled]="form.submitting()">
          {{ form.submitting() ? 'Saving…' : client() ? 'Save changes' : 'Create client' }}
        </button>
      </div>
    </form>
  `,
})
export class ClientForm {
  private readonly api = inject(Api);
  readonly client = input<ClientDto | null>(null);
  readonly saved = output<ClientDto>();
  readonly cancelled = output<void>();

  protected model = { name: '', phone: '', email: '', address: '', notes: '' };
  protected readonly form = new FormState(clientInputSchema);

  ngOnInit(): void {
    const c = this.client();
    if (c) {
      this.model = {
        name: c.name,
        phone: c.phone ?? '',
        email: c.email ?? '',
        address: c.address ?? '',
        notes: c.notes ?? '',
      };
    }
  }

  protected async submit(): Promise<void> {
    const existing = this.client();
    await this.form.submit(this.model, async (value) => {
      const saved = existing ? await this.api.updateClient(existing.id, value) : await this.api.createClient(value);
      this.saved.emit(saved);
    });
  }
}
