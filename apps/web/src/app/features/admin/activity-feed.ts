import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ACTIVITY_ACTION_KEYS, type ActivityEventDto, type ActivityPageDto } from '@electro/shared';
import { errorMessage } from '../../core/api-error';
import { I18n } from '../../core/i18n/i18n.service';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import { ErrorState, LoadingState } from '../../shared/ui/states';
import { actionKind, actionLabel, deviceOf, timeAgo } from './admin-format';

/** Activity log, newest first, with filters and "load more". Optionally fixed to one user or company. */
@Component({
  selector: 'app-activity-feed',
  imports: [I18N_PIPES, LoadingState, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showFilters()) {
      <div class="filters">
        <input class="input" type="search" [placeholder]="'Email, company, project or IP' | t" [value]="search()"
               (input)="search.set($any($event.target).value)" (keydown.enter)="reload()" [attr.aria-label]="'Search' | t" />
        <select class="input" (change)="action.set($any($event.target).value); reload()" [attr.aria-label]="'Action' | t">
          <option value="">{{ 'All actions' | t }}</option>
          @for (a of actions; track a) { <option [value]="a" [selected]="a === action()">{{ label(a) }}</option> }
        </select>
        <button class="btn" type="button" (click)="reload()">{{ 'Search' | t }}</button>
        <button class="btn btn-ghost" type="button" (click)="reload()" [title]="'Refresh' | t">↻</button>
      </div>
    }

    @if (error(); as e) {
      <app-error-state [message]="e" (retry)="reload()" />
    } @else if (events() === null) {
      <app-loading [label]="'Loading activity…' | t" />
    } @else if (events()!.length === 0) {
      <p class="muted empty">{{ 'No activity yet.' | t }}</p>
    } @else {
      <div class="card list">
        <table class="table dense">
          <thead>
            <tr>
              <th>{{ 'When' | t }}</th><th>{{ 'What' | t }}</th>
              @if (!userId()) { <th>{{ 'Who' | t }}</th> }
              @if (!organizationId()) { <th>{{ 'Company' | t }}</th> }
              <th>{{ 'Device' | t }}</th>
            </tr>
          </thead>
          <tbody>
            @for (e of events(); track e.id) {
              <tr>
                <td class="when" [title]="e.createdAt | ldate: true">{{ ago(e.createdAt) }}<div class="faint small">{{ e.createdAt | ldate: true }}</div></td>
                <td>
                  <span class="kind" [class]="'kind kind-' + kind(e.action)">{{ label(e.action) }}</span>
                  @if (e.targetName) { <div class="small target">{{ e.targetName }}</div> }
                </td>
                @if (!userId()) {
                  <td>
                    @if (e.userId) {
                      <a href="" (click)="$event.preventDefault(); openUser.emit(e.userId)">{{ e.userName ?? e.email }}</a>
                      @if (e.userName) { <div class="faint small">{{ e.email }}</div> }
                    } @else { <span class="muted">{{ e.email ?? '–' }}</span> }
                  </td>
                }
                @if (!organizationId()) { <td class="muted">{{ e.organizationName ?? '–' }}</td> }
                <td class="faint small">{{ device(e.userAgent) }}<div class="mono">{{ e.ip }}</div></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (cursor()) {
        <div class="more"><button class="btn" type="button" [disabled]="busy()" (click)="loadMore()">{{ 'Load older' | t }}</button></div>
      }
    }
  `,
  styles: `
    .filters { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .filters input { flex: 1; min-width: 200px; }
    .filters select { max-width: 260px; }
    .list { overflow-x: auto; }
    .table.dense td, .table.dense th { padding: 8px 12px; vertical-align: top; }
    .when { white-space: nowrap; }
    .small { font-size: 12px; }
    .target { color: var(--text-muted); margin-top: 2px; }
    .kind { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; border: 1px solid var(--border); }
    .kind-auth { color: var(--info); border-color: rgba(108, 182, 255, 0.35); }
    .kind-work { color: var(--accent); border-color: rgba(62, 207, 142, 0.35); }
    .kind-export { color: #c4a7ff; border-color: rgba(196, 167, 255, 0.35); }
    .kind-team { color: var(--warn); border-color: rgba(242, 184, 75, 0.35); }
    .kind-warn { color: var(--danger); border-color: rgba(240, 106, 106, 0.45); background: var(--danger-soft); }
    .more { display: flex; justify-content: center; margin-top: 12px; }
    .empty { padding: 16px 0; }
  `,
})
export class ActivityFeed {
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18n);
  readonly userId = input<string | null>(null);
  readonly organizationId = input<string | null>(null);
  readonly showFilters = input(true);
  readonly pageSize = input(50);
  readonly openUser = output<string>();

  protected readonly actions = ACTIVITY_ACTION_KEYS;
  protected readonly search = signal('');
  protected readonly action = signal('');
  protected readonly events = signal<ActivityEventDto[] | null>(null);
  protected readonly cursor = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    effect(() => {
      this.userId();
      this.organizationId();
      untracked(() => this.reload());
    });
  }

  reload(): void {
    this.events.set(null);
    this.cursor.set(null);
    void this.fetch(null);
  }

  protected loadMore(): void {
    void this.fetch(this.cursor());
  }

  private async fetch(before: string | null): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    let params = new HttpParams().set('limit', this.pageSize());
    if (this.userId()) params = params.set('userId', this.userId()!);
    if (this.organizationId()) params = params.set('organizationId', this.organizationId()!);
    if (this.action()) params = params.set('action', this.action());
    if (this.search().trim()) params = params.set('search', this.search().trim());
    if (before) params = params.set('before', before);
    try {
      const page = await firstValueFrom(this.http.get<ActivityPageDto>('/api/admin/activity', { params }));
      this.events.set(before ? [...(this.events() ?? []), ...page.events] : page.events);
      this.cursor.set(page.nextCursor);
    } catch (err) {
      this.error.set(errorMessage(err));
      if (!before) this.events.set([]);
    } finally {
      this.busy.set(false);
    }
  }

  protected label = actionLabel;
  protected kind = actionKind;
  protected device = deviceOf;
  protected ago(v: string): string {
    return timeAgo(v, (d) => this.i18n.dateTime(d));
  }
}
