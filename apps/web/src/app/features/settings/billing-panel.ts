import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PAST_DUE_GRACE_DAYS, PLAN, daysUntil, formatMoney, type BillingDto, type BillingInterval } from '@electro/shared';
import { errorMessage, toApiError } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { ErrorState, LoadingState } from '../../shared/ui/states';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import type { TKey } from '../../core/i18n/sq';
import { I18n, t, tx } from '../../core/i18n/i18n.service';

const STATUS_TEXT: Record<BillingDto['status'], TKey> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment failed',
  canceled: 'Cancelled (until period end)',
  expired: 'Not active (read-only)',
};

/** Subscription status, subscribe / manage buttons, and (development only) the simulated checkout and portal. */
@Component({
  selector: 'app-billing-panel',
  imports: [I18N_PIPES, LoadingState, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (billing.error(); as err) {
      <app-error-state [message]="message(err)" (retry)="billing.reload()" />
    } @else if (!billing.hasValue()) {
      <app-loading [label]="'Loading billing…' | t" />
    } @else {
      @let b = billing.value();
      @if (error(); as e) { <div class="banner banner-error" role="alert">{{ e | tx }}</div> }

      @if (b.provider === 'dev' && devCheckout()) {
        <section class="card dev">
          <h3>{{ 'Test checkout' | t }} <span class="tag">{{ 'development – no real payment' | t }}</span></h3>
          <p>{{ 'This stands in for the payment provider\’s checkout page. Completing it sends a signed test webhook through the same code path as a real payment.' | t }}</p>
          <div class="row">
            <button class="btn btn-primary" type="button" (click)="completeDevCheckout()" [disabled]="busy()">{{ 'Complete test payment' | t }}</button>
            <button class="btn" type="button" (click)="clearParams()">{{ 'Cancel' | t }}</button>
          </div>
        </section>
      }
      @if (b.provider === 'dev' && devPortal() && b.hasSubscription) {
        <section class="card dev">
          <h3>{{ 'Test customer portal' | t }} <span class="tag">{{ 'development – no real payment' | t }}</span></h3>
          <p>{{ 'Simulate what would happen in the provider\’s portal or after a payment attempt.' | t }}</p>
          <div class="row wrap">
            <button class="btn btn-sm" type="button" (click)="simulate('cancel')" [disabled]="busy()">{{ 'Cancel at period end' | t }}</button>
            <button class="btn btn-sm" type="button" (click)="simulate('resume')" [disabled]="busy()">{{ 'Resume' | t }}</button>
            <button class="btn btn-sm" type="button" (click)="simulate('payment_failed')" [disabled]="busy()">{{ 'Payment fails' | t }}</button>
            <button class="btn btn-sm" type="button" (click)="simulate('payment_succeeded')" [disabled]="busy()">{{ 'Payment succeeds' | t }}</button>
            <button class="btn btn-sm btn-danger" type="button" (click)="simulate('end_now')" [disabled]="busy()">{{ 'End subscription now' | t }}</button>
            <button class="btn btn-sm btn-ghost" type="button" (click)="clearParams()">{{ 'Close' | t }}</button>
          </div>
        </section>
      }

      @if (b.provider === 'none') {
        <section class="card off"><h3>{{ 'Billing is not enabled on this server' | t }}</h3>
          <p class="faint small">{{ 'This is a test installation: every company has full access and nothing is charged.' | t }}</p></section>
      }
      <div class="grid">
        <section class="card status">
          <h3>{{ 'Subscription' | t }}</h3>
          <dl>
            <dt>{{ 'Status' | t }}</dt><dd><span class="pill" [class]="'pill ' + b.status">{{ statusText[b.status] | t }}</span></dd>
            @if (b.status === 'trialing') {
              <dt>{{ 'Trial ends' | t }}</dt><dd>{{ b.trialEndsAt | ldate }} ({{ '{n} day(s) left' | t: { n: days(b.trialEndsAt) } }})</dd>
            }
            @if (b.interval) { <dt>{{ 'Billing' | t }}</dt><dd>{{ (b.interval === 'year' ? 'Yearly' : 'Monthly') | t }}</dd> }
            @if (b.currentPeriodEnd && b.status !== 'expired') {
              <dt>{{ (b.cancelAtPeriodEnd ? 'Ends on' : 'Next payment') | t }}</dt><dd>{{ b.currentPeriodEnd | ldate }}</dd>
            }
            @if (b.status === 'past_due' && b.pastDueSince) {
              <dt>{{ 'Full access until' | t }}</dt><dd>{{ graceEnd(b.pastDueSince) | ldate }}</dd>
            }
            <dt>{{ 'Users' | t }}</dt><dd>{{ b.members }} ({{ 'billed per user' | t }}{{ b.hasSubscription ? ', ' + ('{n} seat(s) on the subscription' | t: { n: b.seats }) : '' }})</dd>
            <dt>{{ 'Access' | t }}</dt><dd>{{ (b.access === 'full' ? 'Full' : 'Read-only: view and export only') | t }}</dd>
          </dl>
          @if (b.hasSubscription && canManage()) {
            <div class="row"><button class="btn" type="button" (click)="portal()" [disabled]="busy()">{{ 'Manage billing' | t }}</button></div>
            <p class="faint small">{{ 'Change payment method, download invoices, switch plan or cancel.' | t }}</p>
          }
        </section>

        @if (canSubscribe()) {
          <section class="card plans">
            <h3>{{ (b.access === 'read-only' ? 'Renew to keep editing' : 'Subscribe') | t }}</h3>
            <p class="faint small">{{ 'One plan with everything included, priced per user. Prices are net; VAT is added at checkout where it applies.' | t }}</p>
            <div class="options">
              @for (i of intervals; track i) {
                <div class="option">
                  <div class="price">{{ price(i) }}</div>
                  <div class="faint small">{{ (i === 'year' ? 'per user / year (2 months free)' : 'per user / month') | t }}</div>
                  <div class="faint small">{{ '{n} user(s): {total}' | t: { n: b.members, total: total(i, b.members) } }}</div>
                  <button class="btn" [class.btn-primary]="i === 'year'" type="button" (click)="checkout(i)" [disabled]="busy() || !canManage()">
                    {{ (i === 'year' ? 'Subscribe yearly' : 'Subscribe monthly') | t }}</button>
                </div>
              }
            </div>
            @if (!canManage()) { <p class="faint small">{{ 'Ask the owner or an admin of your company to subscribe.' | t }}</p> }
            @if (b.provider === 'dev') { <p class="faint small">{{ 'Development mode: checkout is simulated, no payment is taken.' | t }}</p> }
          </section>
        }
      </div>
      <p class="faint small">{{ 'Your data is never deleted because of billing. Without an active subscription, projects stay viewable and exportable.' | t }}</p>
    }
  `,
  styles: `
    .banner { margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 12px; align-items: start; }
    .card { padding: 14px 16px; }
    h3 { margin: 0 0 10px; font-size: 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0 0 12px; font-size: 13px; }
    dt { color: var(--text-muted); }
    dd { margin: 0; }
    .pill { padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--bg-elev-2); }
    .pill.active, .pill.trialing { color: var(--accent); background: var(--accent-soft); }
    .pill.past_due, .pill.canceled { color: var(--warn); background: var(--warn-soft); }
    .pill.expired { color: #e5484d; background: rgba(229, 72, 77, 0.14); }
    .row { display: flex; gap: 8px; }
    .row.wrap { flex-wrap: wrap; }
    .small { font-size: 12px; }
    .options { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 10px 0; }
    .option { border: 1px solid var(--border); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 4px; }
    .option .btn { margin-top: 8px; }
    .price { font-size: 22px; font-weight: 700; }
    .dev { margin-bottom: 16px; border-color: var(--warn); }
    .off { margin-bottom: 16px; }
    .dev p { font-size: 13px; color: var(--text-muted); margin: 0 0 10px; }
    .tag { font-size: 11px; font-weight: 600; color: var(--warn); background: var(--warn-soft); padding: 2px 8px; border-radius: 999px; }
    @media (max-width: 520px) { .options { grid-template-columns: 1fr; } }
  `,
})
export class BillingPanel {
  private readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  /** Token from a simulated (dev provider) checkout redirect. */
  readonly devCheckout = input<string | undefined>();
  readonly devPortal = input<string | undefined>();

  protected readonly billing = httpResource<BillingDto>(() => '/api/billing');
  protected readonly intervals: BillingInterval[] = ['month', 'year'];
  protected readonly statusText = STATUS_TEXT;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected message = errorMessage;

  protected readonly canManage = computed(() => this.auth.session()?.organization.role !== 'MEMBER');
  protected readonly canSubscribe = computed(() => {
    const b = this.billing.value();
    return !!b && b.provider !== 'none' && (!b.hasSubscription || b.status === 'expired');
  });

  protected days(iso: string | null): number {
    return daysUntil(iso);
  }
  protected graceEnd(iso: string): Date {
    return new Date(Date.parse(iso) + PAST_DUE_GRACE_DAYS * 86_400_000);
  }
  protected price(i: BillingInterval): string {
    return this.i18n.money(PLAN.pricePerSeat[i], PLAN.currency).replace(/[.,]00(?=\D|$)/, '');
  }
  protected total(i: BillingInterval, users: number): string {
    return `${this.i18n.money(PLAN.pricePerSeat[i] * Math.max(1, users), PLAN.currency)} / ${t(i === 'year' ? 'year' : 'month')}`;
  }

  protected async checkout(interval: BillingInterval): Promise<void> {
    await this.run(async () => {
      const { url } = await firstValueFrom(this.http.post<{ url: string }>('/api/billing/checkout', { interval }));
      this.go(url);
    });
  }

  protected async portal(): Promise<void> {
    await this.run(async () => {
      const { url } = await firstValueFrom(this.http.post<{ url: string }>('/api/billing/portal', {}));
      this.go(url);
    });
  }

  protected async completeDevCheckout(): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.http.post<BillingDto>('/api/billing/dev/complete', { token: this.devCheckout() }));
      await this.afterChange();
    });
  }

  protected async simulate(action: string): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.http.post<BillingDto>('/api/billing/dev/simulate', { action }));
      this.billing.reload();
      await this.auth.refresh();
    });
  }

  protected clearParams(): void {
    void this.router.navigate([], { queryParams: { tab: 'billing' }, replaceUrl: true });
  }

  private async afterChange(): Promise<void> {
    this.clearParams();
    this.billing.reload();
    await this.auth.refresh();
  }

  /** Provider pages are external; the dev provider returns an in-app URL. */
  private go(url: string): void {
    const u = new URL(url, window.location.origin);
    if (u.origin === window.location.origin) void this.router.navigateByUrl(u.pathname + u.search);
    else window.location.assign(url);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
