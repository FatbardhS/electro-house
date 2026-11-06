import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Router } from '@angular/router';
import type { MaterialDto, MaterialRuleDto, OrganizationSettings } from '@electro/shared';
import { errorMessage } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { ErrorState, LoadingState } from '../../shared/ui/states';
import { CompanySettings } from './company-settings';
import { MaterialRules } from './material-rules';
import { PriceList } from './price-list';
import { BillingPanel } from './billing-panel';
import { TeamPanel } from './team-panel';

type Tab = 'company' | 'prices' | 'rules' | 'team' | 'billing';

/** Company-wide settings: prices and costs, price list, material rules. */
@Component({
  selector: 'app-settings-page',
  imports: [LoadingState, ErrorState, CompanySettings, PriceList, MaterialRules, BillingPanel, TeamPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page wide">
      <div class="page-header">
        <div>
          <h1>Settings</h1>
          <div class="subtitle">Shared by every project of {{ auth.session()?.organization?.name ?? 'your company' }}.</div>
        </div>
      </div>
      <div class="tabs" role="tablist">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" [class.active]="current() === t.id" (click)="go(t.id)">{{ t.label }}</button>
        }
      </div>

      @if (current() === 'team') {
        <app-team-panel />
      } @else if (current() === 'billing') {
        <app-billing-panel [devCheckout]="devCheckout()" [devPortal]="devPortal()" />
      } @else if (settings.error() || materials.error() || rules.error(); as err) {
        <app-error-state [message]="message(err)" (retry)="reloadAll()" />
      } @else if (!settings.hasValue() || !materials.hasValue() || !rules.hasValue()) {
        <app-loading label="Loading settings…" />
      } @else {
        @switch (current()) {
          @case ('company') { <app-company-settings [settings]="settings.value()" [readonly]="readonly()" (changed)="settings.reload()" /> }
          @case ('prices') {
            <app-price-list [materials]="materials.value()" [currency]="settings.value().currency" [readonly]="readonly()" (changed)="materials.reload()" />
          }
          @case ('rules') {
            <app-material-rules [rules]="rules.value()" [materials]="materials.value()" [readonly]="readonly()"
                                [presetTarget]="target() ?? null" (changed)="rules.reload(); materials.reload()" />
          }
        }
      }
    </div>
  `,
  styles: `
    .wide { max-width: 1200px; }
    .tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); overflow-x: auto; }
    .tabs button { padding: 8px 14px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--text-muted);
                   font: 600 13px var(--font); cursor: pointer; white-space: nowrap; }
    .tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
  `,
})
export class SettingsPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Query parameters (bound by the router). */
  readonly tab = input<string>();
  readonly target = input<string>();
  readonly devCheckout = input<string | undefined>(undefined, { alias: 'dev-checkout' });
  readonly devPortal = input<string | undefined>(undefined, { alias: 'dev-portal' });

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'company', label: 'Prices & costs' },
    { id: 'prices', label: 'Price list' },
    { id: 'rules', label: 'Material rules' },
    { id: 'team', label: 'Team' },
    { id: 'billing', label: 'Billing' },
  ];
  protected readonly current = computed<Tab>(() =>
    ['company', 'prices', 'rules', 'team', 'billing'].includes(this.tab() ?? '') ? (this.tab() as Tab) : 'company',
  );
  /** Members cannot change company settings; nobody can while the subscription is inactive. */
  protected readonly readonly = computed(() => {
    const org = this.auth.session()?.organization;
    return org?.role === 'MEMBER' || org?.billing.access === 'read-only';
  });

  protected readonly settings = httpResource<OrganizationSettings>(() => '/api/organization/settings');
  protected readonly materials = httpResource<MaterialDto[]>(() => '/api/materials');
  protected readonly rules = httpResource<MaterialRuleDto[]>(() => '/api/material-rules');
  protected message = errorMessage;

  protected go(tab: Tab): void {
    void this.router.navigate([], { queryParams: { tab }, replaceUrl: true });
  }

  protected reloadAll(): void {
    this.settings.reload();
    this.materials.reload();
    this.rules.reload();
  }
}
