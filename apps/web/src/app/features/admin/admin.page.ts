import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Router } from '@angular/router';
import { ROLE_NAMES, type AdminCompanyDto, type AdminOverviewDto, type AdminUserDetailDto, type AdminUserDto } from '@electro/shared';
import { errorMessage } from '../../core/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import type { TKey } from '../../core/i18n/sq';
import { ErrorState, LoadingState } from '../../shared/ui/states';
import { ActivityFeed } from './activity-feed';
import { SUBSCRIPTION_LABELS, actionLabel, timeAgo } from './admin-format';

type Tab = 'overview' | 'users' | 'companies' | 'activity';
const TABS: Tab[] = ['overview', 'users', 'companies', 'activity'];

function searchParams(text: string): Record<string, string> {
  return text.trim() ? { search: text.trim() } : {};
}

/** Product owner panel: everyone who uses the app and what they do. Only reachable for PLATFORM_ADMIN_EMAILS accounts. */
@Component({
  selector: 'app-admin-page',
  imports: [I18N_PIPES, LoadingState, ErrorState, ActivityFeed],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page wide">
      <div class="page-header">
        <div>
          <h1>{{ 'Admin panel' | t }}</h1>
          <div class="subtitle">{{ 'Every account, company and action in Electro House. Only you can see this page.' | t }}</div>
        </div>
      </div>
      <div class="tabs" role="tablist">
        @for (tb of tabs; track tb.id) {
          <button type="button" role="tab" [class.active]="current() === tb.id" (click)="go(tb.id)">{{ tb.label | t }}</button>
        }
      </div>

      @switch (current()) {
        @case ('overview') {
          @if (overview.error(); as err) {
            <app-error-state [message]="message(err)" (retry)="overview.reload()" />
          } @else if (!overview.hasValue()) {
            <app-loading />
          } @else {
            @let o = overview.value();
            <div class="stats">
              <div class="stat card"><div class="v">{{ o.totals.users }}</div><div class="l">{{ 'Users' | t }}</div>
                <div class="s">+{{ o.signUps.week }} {{ 'this week' | t }}</div></div>
              <div class="stat card"><div class="v">{{ o.active.day }}</div><div class="l">{{ 'Active today' | t }}</div>
                <div class="s">{{ o.active.week }} {{ 'in 7 days' | t }} · {{ o.active.month }} {{ 'in 30 days' | t }}</div></div>
              <div class="stat card"><div class="v">{{ o.openSessions }}</div><div class="l">{{ 'Signed in now' | t }}</div>
                <div class="s">{{ 'users with an open session' | t }}</div></div>
              <div class="stat card"><div class="v">{{ o.totals.companies }}</div><div class="l">{{ 'Companies' | t }}</div>
                <div class="s">{{ subsText(o) }}</div></div>
              <div class="stat card"><div class="v">{{ o.totals.projects }}</div><div class="l">{{ 'Projects' | t }}</div>
                <div class="s">{{ o.totals.clients }} {{ 'clients' | t }} · {{ o.totals.floors }} {{ 'floors' | t }}</div></div>
              <div class="stat card"><div class="v">{{ o.exportsWeek }}</div><div class="l">{{ 'Exports this week' | t }}</div>
                <div class="s">PDF + DXF</div></div>
              <div class="stat card" [class.alert]="o.failedSignIns24h >= 10"><div class="v">{{ o.failedSignIns24h }}</div>
                <div class="l">{{ 'Failed sign-ins (24 h)' | t }}</div><div class="s">{{ 'many in a row can mean password guessing' | t }}</div></div>
            </div>

            <section class="card chart">
              <div class="chart-head">
                <h3>{{ 'Last 30 days' | t }}</h3>
                <div class="legend"><span class="sw active"></span>{{ 'Active users' | t }} <span class="sw signup"></span>{{ 'New accounts' | t }}</div>
              </div>
              <div class="bars" role="img" [attr.aria-label]="'Active users per day' | t">
                @for (d of o.days; track d.day) {
                  <div class="day" [title]="dayTitle(d)">
                    <div class="bar active" [style.height.%]="pct(d.activeUsers)"></div>
                    <div class="bar signup" [style.height.%]="pct(d.signUps)"></div>
                  </div>
                }
              </div>
              <div class="axis faint"><span>{{ o.days[0].day | ldate }}</span><span>{{ o.days[o.days.length - 1].day | ldate }}</span></div>
            </section>

            <section>
              <h3 class="sec">{{ 'Latest activity' | t }}</h3>
              <app-activity-feed [showFilters]="false" [pageSize]="15" (openUser)="openUser($event)" />
            </section>
          }
        }

        @case ('users') {
          <div class="filters">
            <input class="input" type="search" [placeholder]="'Name, email or company' | t" [value]="userSearch()"
                   (input)="userSearch.set($any($event.target).value)" [attr.aria-label]="'Search' | t" />
          </div>
          @if (users.error(); as err) {
            <app-error-state [message]="message(err)" (retry)="users.reload()" />
          } @else if (!users.hasValue()) {
            <app-loading />
          } @else {
            <div class="card list">
              <table class="table dense">
                <thead><tr>
                  <th>{{ 'Name' | t }}</th><th>{{ 'Company' | t }}</th><th>{{ 'Last seen' | t }}</th>
                  <th>{{ 'Last sign-in' | t }}</th><th>{{ 'Sessions' | t }}</th><th>{{ 'Joined' | t }}</th>
                </tr></thead>
                <tbody>
                  @for (u of users.value(); track u.id) {
                    <tr class="clickable" (click)="openUser(u.id)">
                      <td>
                        {{ u.name }} @if (u.isPlatformAdmin) { <span class="badge">{{ 'Product owner' | t }}</span> }
                        <div class="faint small">{{ u.email }}</div>
                      </td>
                      <td>
                        @for (m of u.memberships; track m.organizationId) {
                          <div>{{ m.organizationName }} <span class="faint small">{{ role(m.role) }}</span></div>
                        } @empty { <span class="faint">–</span> }
                      </td>
                      <td [class.online]="isOnline(u.lastSeenAt)">{{ ago(u.lastSeenAt) }}</td>
                      <td class="muted">{{ ago(u.lastSignInAt) }}</td>
                      <td>{{ u.openSessions }}</td>
                      <td class="muted">{{ u.createdAt | ldate }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="muted">{{ 'No users found.' | t }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="faint small">{{ '{n} shown, most recently active first.' | t: { n: users.value().length } }}</p>
          }
        }

        @case ('companies') {
          <div class="filters">
            <input class="input" type="search" [placeholder]="'Company name' | t" [value]="companySearch()"
                   (input)="companySearch.set($any($event.target).value)" [attr.aria-label]="'Search' | t" />
          </div>
          @if (companies.error(); as err) {
            <app-error-state [message]="message(err)" (retry)="companies.reload()" />
          } @else if (!companies.hasValue()) {
            <app-loading />
          } @else {
            <div class="card list">
              <table class="table dense">
                <thead><tr>
                  <th>{{ 'Company' | t }}</th><th>{{ 'Owner' | t }}</th><th>{{ 'Subscription' | t }}</th><th>{{ 'Members' | t }}</th>
                  <th>{{ 'Clients' | t }}</th><th>{{ 'Projects' | t }}</th><th>{{ 'Last activity' | t }}</th><th>{{ 'Created' | t }}</th>
                </tr></thead>
                <tbody>
                  @for (c of companies.value(); track c.id) {
                    <tr class="clickable" (click)="openCompany(c)">
                      <td>{{ c.name }}</td>
                      <td>@if (c.owner; as ow) { {{ ow.name }}<div class="faint small">{{ ow.email }}</div> } @else { – }</td>
                      <td>
                        <span class="badge">{{ subLabel(c.subscriptionStatus) }}</span>
                        @if (c.subscriptionStatus === 'trialing' && c.trialEndsAt) {
                          <div class="faint small">{{ 'until {date}' | t: { date: (c.trialEndsAt | ldate) } }}</div>
                        }
                      </td>
                      <td>{{ c.members }}</td><td>{{ c.clients }}</td><td>{{ c.projects }}</td>
                      <td class="muted">{{ ago(c.lastActivityAt) }}</td>
                      <td class="muted">{{ c.createdAt | ldate }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="8" class="muted">{{ 'No companies found.' | t }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (company(); as c) {
            <section class="card drawer-inline">
              <div class="drawer-head">
                <h3>{{ c.name }}</h3>
                <button class="btn btn-sm btn-ghost" type="button" (click)="company.set(null)">{{ 'Close' | t }}</button>
              </div>
              <app-activity-feed [organizationId]="c.id" [showFilters]="false" [pageSize]="25" (openUser)="openUser($event)" />
            </section>
          }
        }

        @case ('activity') {
          <app-activity-feed (openUser)="openUser($event)" />
        }
      }
    </div>

    @if (userId()) {
      <div class="scrim" (click)="closeUser()"></div>
      <aside class="drawer" role="dialog" [attr.aria-label]="'User' | t">
        @if (user.error(); as err) {
          <app-error-state [message]="message(err)" (retry)="user.reload()" />
        } @else if (!user.hasValue()) {
          <app-loading />
        } @else {
          @let u = user.value();
          <div class="drawer-head">
            <div>
              <h2>{{ u.name }}</h2>
              <div class="muted">{{ u.email }}</div>
            </div>
            <button class="btn btn-sm btn-ghost" type="button" (click)="closeUser()">{{ 'Close' | t }}</button>
          </div>
          <dl class="facts">
            <dt>{{ 'Joined' | t }}</dt><dd>{{ u.createdAt | ldate: true }}</dd>
            <dt>{{ 'Last seen' | t }}</dt><dd>{{ ago(u.lastSeenAt) }}</dd>
            <dt>{{ 'Last sign-in' | t }}</dt><dd>{{ ago(u.lastSignInAt) }}</dd>
            <dt>{{ 'Language' | t }}</dt><dd>{{ u.language === 'sq' ? 'Shqip' : 'English' }}</dd>
            <dt>{{ 'Companies' | t }}</dt>
            <dd>
              @for (m of u.memberships; track m.organizationId) { <div>{{ m.organizationName }} · {{ role(m.role) }}</div> }
              @empty { – }
            </dd>
          </dl>

          <h3 class="sec">{{ 'Open sessions' | t }} · {{ u.sessions.length }}</h3>
          @for (s of u.sessions; track s.id) {
            <div class="small session">{{ 'Signed in {date}' | t: { date: (s.createdAt | ldate: true) } }} · {{ s.organizationName ?? '–' }}
              <span class="faint">{{ 'expires {date}' | t: { date: (s.expiresAt | ldate) } }}</span></div>
          } @empty { <p class="faint small">{{ 'Not signed in anywhere.' | t }}</p> }

          @if (countList(u).length) {
            <h3 class="sec">{{ 'Totals' | t }}</h3>
            <div class="counts">
              @for (c of countList(u); track c.action) { <span class="badge">{{ c.label }}: {{ c.n }}</span> }
            </div>
          }

          <h3 class="sec">{{ 'Activity' | t }}</h3>
          <app-activity-feed [userId]="u.id" [showFilters]="false" [pageSize]="30" />
        }
      </aside>
    }
  `,
  styles: `
    .wide { max-width: 1280px; }
    .tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); overflow-x: auto; }
    .tabs button { padding: 8px 14px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--text-muted);
                   font: 600 13px var(--font); cursor: pointer; white-space: nowrap; }
    .tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
    .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { padding: 14px 16px; }
    .stat .v { font-size: 26px; font-weight: 700; }
    .stat .l { font-weight: 600; margin-top: 2px; }
    .stat .s { color: var(--text-faint); font-size: 12px; margin-top: 4px; }
    .stat.alert { border-color: rgba(240, 106, 106, 0.6); background: var(--danger-soft); }
    .chart { padding: 14px 16px; margin-bottom: 20px; }
    .chart-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .chart-head h3 { margin: 0; }
    .legend { font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-left: 8px; }
    .sw.active, .bar.active { background: var(--accent); }
    .sw.signup, .bar.signup { background: var(--info); }
    .bars { display: flex; align-items: flex-end; gap: 3px; height: 140px; margin-top: 12px; }
    .day { flex: 1; height: 100%; display: flex; align-items: flex-end; gap: 1px; }
    .bar { flex: 1; min-height: 1px; border-radius: 2px 2px 0 0; opacity: 0.85; }
    .day:hover .bar { opacity: 1; }
    .axis { display: flex; justify-content: space-between; font-size: 11px; margin-top: 6px; }
    .sec { margin: 18px 0 10px; font-size: 15px; }
    .filters { display: flex; gap: 8px; margin-bottom: 12px; }
    .filters input { flex: 1; max-width: 420px; }
    .list { overflow-x: auto; }
    .table.dense td, .table.dense th { padding: 8px 12px; vertical-align: top; }
    .small { font-size: 12px; }
    .online { color: var(--accent); font-weight: 600; }
    .drawer-inline { margin-top: 16px; padding: 14px 16px; }
    .drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
    .drawer-head h2, .drawer-head h3 { margin: 0; }
    .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 40; }
    .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(760px, 100vw); z-index: 41; overflow-y: auto;
              background: var(--bg-elev); border-left: 1px solid var(--border-strong); box-shadow: var(--shadow); padding: 20px; }
    .facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
    .facts dt { color: var(--text-faint); }
    .facts dd { margin: 0; }
    .session { padding: 4px 0; border-bottom: 1px solid var(--border); }
    .counts { display: flex; flex-wrap: wrap; gap: 6px; }
    @media (max-width: 640px) { .page { padding: 16px; } .drawer { padding: 16px; } }
  `,
})
export class AdminPage {
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  /** Query parameters (bound by the router). */
  readonly tab = input<string>();
  readonly userId = input<string | undefined>(undefined, { alias: 'user' });

  protected readonly tabs: { id: Tab; label: TKey }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'companies', label: 'Companies' },
    { id: 'activity', label: 'Activity' },
  ];
  protected readonly current = computed<Tab>(() => (TABS.includes(this.tab() as Tab) ? (this.tab() as Tab) : 'overview'));

  protected readonly userSearch = signal('');
  protected readonly companySearch = signal('');
  protected readonly company = signal<AdminCompanyDto | null>(null);

  protected readonly overview = httpResource<AdminOverviewDto>(() => (this.current() === 'overview' ? '/api/admin/overview' : undefined));
  protected readonly users = httpResource<AdminUserDto[]>(() =>
    this.current() === 'users' ? { url: '/api/admin/users', params: searchParams(this.userSearch()) } : undefined,
  );
  protected readonly companies = httpResource<AdminCompanyDto[]>(() =>
    this.current() === 'companies'
      ? { url: '/api/admin/companies', params: searchParams(this.companySearch()) }
      : undefined,
  );
  protected readonly user = httpResource<AdminUserDetailDto>(() => (this.userId() ? `/api/admin/users/${this.userId()}` : undefined));

  private readonly maxDay = computed(() => {
    const days = this.overview.hasValue() ? this.overview.value().days : [];
    return Math.max(1, ...days.map((d) => Math.max(d.activeUsers, d.signUps)));
  });

  protected message = errorMessage;

  protected go(tab: Tab): void {
    this.company.set(null);
    void this.router.navigate([], { queryParams: { tab }, replaceUrl: true });
  }

  protected openUser(id: string): void {
    void this.router.navigate([], { queryParams: { user: id }, queryParamsHandling: 'merge' });
  }

  protected closeUser(): void {
    void this.router.navigate([], { queryParams: { user: null }, queryParamsHandling: 'merge' });
  }

  protected openCompany(c: AdminCompanyDto): void {
    this.company.set(this.company()?.id === c.id ? null : c);
  }

  protected ago(v: string | null): string {
    return timeAgo(v, (d) => this.i18n.date(d));
  }

  /** Seen in the last 10 minutes (last-seen is saved at most every 5 minutes). */
  protected isOnline(v: string | null): boolean {
    return !!v && Date.now() - new Date(v).getTime() < 10 * 60_000;
  }

  protected role(r: keyof typeof ROLE_NAMES): string {
    return this.i18n.tx(ROLE_NAMES[r]);
  }

  protected subLabel(status: string): string {
    return this.i18n.tx(SUBSCRIPTION_LABELS[status] ?? status);
  }

  protected subsText(o: AdminOverviewDto): string {
    return Object.entries(o.subscriptions)
      .map(([k, n]) => `${n} ${this.subLabel(k).toLowerCase()}`)
      .join(' · ');
  }

  protected pct(n: number): number {
    return (n / this.maxDay()) * 100;
  }

  protected dayTitle(d: AdminOverviewDto['days'][number]): string {
    return this.i18n.t('{date}: {active} active, {signUps} new accounts, {signIns} sign-ins, {exports} exports', {
      date: this.i18n.date(d.day),
      active: d.activeUsers,
      signUps: d.signUps,
      signIns: d.signIns,
      exports: d.exports,
    });
  }

  protected countList(u: AdminUserDetailDto): { action: string; label: string; n: number }[] {
    return Object.entries(u.actionCounts)
      .map(([action, n]) => ({ action, label: actionLabel(action), n }))
      .sort((a, b) => b.n - a.n);
  }
}
