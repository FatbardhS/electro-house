import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient, httpResource } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PAST_DUE_GRACE_DAYS, PLAN, daysUntil, formatMoney, type BillingDto, type BillingInterval } from '@electro/shared';
import { errorMessage, toApiError } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { ErrorState, LoadingState } from '../../shared/ui/states';

const STATUS_TEXT: Record<BillingDto['status'], string> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment failed',
  canceled: 'Cancelled (until period end)',
  expired: 'Not active (read-only)',
};

/** Subscription status, subscribe / manage buttons, and (development only) the simulated checkout and portal. */
@Component({
  selector: 'app-billing-panel',
  imports: [DatePipe, LoadingState, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (billing.error(); as err) {
      <app-error-state [message]="message(err)" (retry)="billing.reload()" />
    } @else if (!billing.hasValue()) {
      <app-loading label="Loading billing…" />
    } @else {
      @let b = billing.value();
      @if (error(); as e) { <div class="banner banner-error" role="alert">{{ e }}</div> }

      @if (b.provider === 'dev' && devCheckout()) {
        <section class="card dev">
          <h3>Test checkout <span class="tag">development – no real payment</span></h3>
          <p>This stands in for the payment provider's checkout page. Completing it sends a signed test webhook through the
            same code path as a real payment.</p>
          <div class="row">
            <button class="btn btn-primary" type="button" (click)="completeDevCheckout()" [disabled]="busy()">Complete test payment</button>
            <button class="btn" type="button" (click)="clearParams()">Cancel</button>
          </div>
        </section>
      }
      @if (b.provider === 'dev' && devPortal() && b.hasSubscription) {
        <section class="card dev">
          <h3>Test customer portal <span class="tag">development – no real payment</span></h3>
          <p>Simulate what would happen in the provider's portal or after a payment attempt.</p>
          <div class="row wrap">
            <button class="btn btn-sm" type="button" (click)="simulate('cancel')" [disabled]="busy()">Cancel at period end</button>
            <button class="btn btn-sm" type="button" (click)="simulate('resume')" [disabled]="busy()">Resume</button>
            <button class="btn btn-sm" type="button" (click)="simulate('payment_failed')" [disabled]="busy()">Payment fails</button>
            <button class="btn btn-sm" type="button" (click)="simulate('payment_succeeded')" [disabled]="busy()">Payment succeeds</button>
            <button class="btn btn-sm btn-danger" type="button" (click)="simulate('end_now')" [disabled]="busy()">End subscription now</button>
            <button class="btn btn-sm btn-ghost" type="button" (click)="clearParams()">Close</button>
          </div>
        </section>
      }

      @if (b.provider === 'none') {
        <section class="card off"><h3>Billing is not enabled on this server</h3>
          <p class="faint small">This is a test installation: every company has full access and nothing is charged.</p></section>
      }
      <div class="grid">
        <section class="card status">
          <h3>Subscription</h3>
          <dl>
            <dt>Status</dt><dd><span class="pill" [class]="'pill ' + b.status">{{ statusText[b.status] }}</span></dd>
            @if (b.status === 'trialing') {
              <dt>Trial ends</dt><dd>{{ b.trialEndsAt | date: 'mediumDate' }} ({{ days(b.trialEndsAt) }} day(s) left)</dd>
            }
            @if (b.interval) { <dt>Billing</dt><dd>{{ b.interval === 'year' ? 'Yearly' : 'Monthly' }}</dd> }
            @if (b.currentPeriodEnd && b.status !== 'expired') {
              <dt>{{ b.cancelAtPeriodEnd ? 'Ends on' : 'Next payment' }}</dt><dd>{{ b.currentPeriodEnd | date: 'mediumDate' }}</dd>
            }
            @if (b.status === 'past_due' && b.pastDueSince) {
              <dt>Full access until</dt><dd>{{ graceEnd(b.pastDueSince) | date: 'mediumDate' }}</dd>
            }
            <dt>Users</dt><dd>{{ b.members }} (billed per user{{ b.hasSubscription ? ', ' + b.seats + ' seat(s) on the subscription' : '' }})</dd>
            <dt>Access</dt><dd>{{ b.access === 'full' ? 'Full' : 'Read-only: view and export only' }}</dd>
          </dl>
          @if (b.hasSubscription && canManage()) {
            <div class="row"><button class="btn" type="button" (click)="portal()" [disabled]="busy()">Manage billing</button></div>
            <p class="faint small">Change payment method, download invoices, switch plan or cancel.</p>
          }
        </section>

        @if (canSubscribe()) {
          <section class="card plans">
            <h3>{{ b.access === 'read-only' ? 'Renew to keep editing' : 'Subscribe' }}</h3>
            <p class="faint small">One plan with everything included, priced per user. Prices are net; VAT is added at checkout where it applies.</p>
            <div class="options">
              @for (i of intervals; track i) {
                <div class="option">
                  <div class="price">{{ price(i) }}</div>
                  <div class="faint small">per user / {{ i === 'year' ? 'year (2 months free)' : 'month' }}</div>
                  <div class="faint small">{{ b.members }} user(s): {{ total(i, b.members) }}</div>
                  <button class="btn" [class.btn-primary]="i === 'year'" type="button" (click)="checkout(i)" [disabled]="busy() || !canManage()">
                    Subscribe {{ i === 'year' ? 'yearly' : 'monthly' }}</button>
                </div>
              }
            </div>
            @if (!canManage()) { <p class="faint small">Ask the owner or an admin of your company to subscribe.</p> }
            @if (b.provider === 'dev') { <p class="faint small">Development mode: checkout is simulated, no payment is taken.</p> }
          </section>
        }
      </div>
      <p class="faint small">Your data is never deleted because of billing. Without an active subscription, projects stay viewable and exportable.</p>
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
    return formatMoney(PLAN.pricePerSeat[i], PLAN.currency).replace('.00', '');
  }
  protected total(i: BillingInterval, users: number): string {
    return `${formatMoney(PLAN.pricePerSeat[i] * Math.max(1, users), PLAN.currency)} / ${i}`;
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
