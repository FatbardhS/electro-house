import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Router } from '@angular/router';
import type { ClientDto } from '@electro/shared';
import { errorMessage } from '../../core/api-error';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/states';
import { Modal } from '../../shared/ui/modal';
import { ClientForm } from './client-form';
import { I18N_PIPES } from '../../core/i18n/t.pipe';

@Component({
  selector: 'app-clients-page',
  imports: [I18N_PIPES, LoadingState, ErrorState, EmptyState, Modal, ClientForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>{{ 'Clients' | t }}</h1>
          <div class="subtitle">{{ 'Every project belongs to a client. Find work by client name, phone or address.' | t }}</div>
        </div>
        <button class="btn btn-primary" type="button" (click)="creating.set(true)">+ {{ 'New client' | t }}</button>
      </div>

      <input class="input search" type="search" [placeholder]="'Search clients…' | t" [attr.aria-label]="'Search clients' | t"
             [value]="search()" (input)="onSearch($any($event.target).value)" />

      <div class="card">
        @if (clients.error(); as err) {
          <app-error-state [message]="message(err)" (retry)="clients.reload()" />
        } @else if (!clients.hasValue()) {
          <app-loading [label]="'Loading clients…' | t" />
        } @else if (clients.value().length === 0) {
          @if (search()) {
            <app-empty-state [heading]="'No clients match “{q}”' | t: { q: search() }" [text]="'Try a different name, phone or address.' | t" />
          } @else {
            <app-empty-state [heading]="'No clients yet' | t" [text]="'Add your first client, then create projects for them.' | t">
              <button class="btn btn-primary" type="button" (click)="creating.set(true)">+ {{ 'New client' | t }}</button>
            </app-empty-state>
          }
        } @else {
          <table class="table">
            <thead><tr><th>{{ 'Name' | t }}</th><th>{{ 'Phone' | t }}</th><th>{{ 'Address' | t }}</th><th style="text-align: right">{{ 'Projects' | t }}</th></tr></thead>
            <tbody>
              @for (c of clients.value(); track c.id) {
                <tr class="clickable" (click)="open(c)" tabindex="0" (keydown.enter)="open(c)">
                  <td><strong>{{ c.name }}</strong>@if (c.email) {<div class="faint">{{ c.email }}</div>}</td>
                  <td class="muted">{{ c.phone ?? '—' }}</td>
                  <td class="muted">{{ c.address ?? '—' }}</td>
                  <td style="text-align: right">{{ c.projectCount }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </div>

    <app-modal [heading]="'New client' | t" [open]="creating()" (closed)="creating.set(false)">
      @if (creating()) {
        <app-client-form (saved)="onCreated($event)" (cancelled)="creating.set(false)" />
      }
    </app-modal>
  `,
  styles: `.search { max-width: 360px; margin-bottom: 14px; }`,
})
export class ClientsPage {
  private readonly router = inject(Router);
  protected readonly search = signal('');
  protected readonly creating = signal(false);
  private debounce?: ReturnType<typeof setTimeout>;

  protected readonly clients = httpResource<ClientDto[]>(() => {
    const q = this.search().trim();
    return q ? `/api/clients?search=${encodeURIComponent(q)}` : '/api/clients';
  });

  protected message = errorMessage;

  protected onSearch(value: string): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.search.set(value), 250);
  }

  protected open(c: ClientDto): void {
    void this.router.navigate(['/clients', c.id]);
  }

  protected onCreated(c: ClientDto): void {
    this.creating.set(false);
    void this.router.navigate(['/clients', c.id]);
  }
}
