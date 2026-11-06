import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  ASSIGNABLE_ROLES,
  PLAN,
  ROLE_NAMES,
  canManageMember,
  canManageTeam,
  formatMoney,
  inviteSchema,
  type AssignableRole,
  type BillingDto,
  type CreatedInvitationDto,
  type InvitationDto,
  type MemberDto,
  type Role,
  type TeamDto,
} from '@electro/shared';
import { errorMessage, toApiError } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../shared/ui/confirm-dialog';
import { ErrorState, LoadingState } from '../../shared/ui/states';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import { I18n, t, tx } from '../../core/i18n/i18n.service';

/** Members and roles of the company, pending invitations, and the invite form (copy-link delivery). */
@Component({
  selector: 'app-team-panel',
  imports: [I18N_PIPES, LoadingState, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (team.error(); as err) {
      <app-error-state [message]="message(err)" (retry)="team.reload()" />
    } @else if (!team.hasValue()) {
      <app-loading [label]="'Loading team…' | t" />
    } @else {
      @let t = team.value();
      @if (error(); as e) { <div class="banner banner-error" role="alert">{{ e | tx }}</div> }

      @if (manager()) {
        <form class="card invite" (submit)="$event.preventDefault(); invite()">
          <h3>{{ 'Invite someone' | t }}</h3>
          <div class="row">
            <input class="input email" type="email" [placeholder]="'name@example.com' | t" [value]="email()" (input)="email.set(val($event))" [attr.aria-label]="'Email' | t" />
            <select class="input" (change)="role.set($any(val($event)))" [attr.aria-label]="'Role' | t">
              @for (r of roles; track r) { <option [value]="r" [selected]="r === role()">{{ roleNames[r] | tx }}</option> }
            </select>
            <button class="btn btn-primary" type="submit" [disabled]="busy()">{{ 'Create invitation link' | t }}</button>
          </div>
          <p class="faint small">{{ seatNote() }} {{ 'Admins can manage prices, billing and the team; members work on projects.' | t }}</p>
          @if (created(); as c) {
            <div class="link">
              <div class="small"><strong>{{ 'Send this link to {email}' | t: { email: c.invitation.email } }}</strong>
                {{ '(by email, WhatsApp…). It works once, for that email address, until {date}. It is shown only now.' | t: { date: (c.invitation.expiresAt | ldate) } }}</div>
              <div class="row">
                <input class="input mono" readonly [value]="c.link" (focus)="$any($event.target).select()" [attr.aria-label]="'Invitation link' | t" />
                <button class="btn" type="button" (click)="copy(c.link)">{{ (copied() ? 'Copied' : 'Copy link') | t }}</button>
              </div>
            </div>
          }
        </form>
      }

      <section class="card">
        <h3>{{ 'Members' | t }} · {{ t.members.length }}</h3>
        <table class="table dense">
          <thead><tr><th>{{ 'Name' | t }}</th><th>{{ 'Email' | t }}</th><th>{{ 'Role' | t }}</th><th>{{ 'Joined' | t }}</th><th></th></tr></thead>
          <tbody>
            @for (m of t.members; track m.userId) {
              <tr>
                <td>{{ m.name }} @if (m.userId === me()) { <span class="faint small">{{ '(you)' | t }}</span> }</td>
                <td class="faint">{{ m.email }}</td>
                <td>
                  @if (canChange(m)) {
                    <select class="cell" (change)="changeRole(m, $any(val($event)))" [attr.aria-label]="'Role of {name}' | t: { name: m.name }">
                      @for (r of roles; track r) { <option [value]="r" [selected]="r === m.role">{{ roleNames[r] | tx }}</option> }
                    </select>
                  } @else { {{ roleNames[m.role] }} }
                </td>
                <td class="faint">{{ m.joinedAt | ldate }}</td>
                <td class="acts">
                  @if (myRole() === 'OWNER' && m.role === 'ADMIN') {
                    <button class="btn btn-sm btn-ghost" type="button" (click)="transfer(m)" [disabled]="busy()">{{ 'Make owner' | t }}</button>
                  }
                  @if (canChange(m)) {
                    <button class="btn btn-sm btn-ghost btn-danger" type="button" (click)="remove(m)" [disabled]="busy()">{{ 'Remove' | t }}</button>
                  }
                  @if (m.userId === me() && m.role !== 'OWNER') {
                    <button class="btn btn-sm btn-ghost btn-danger" type="button" (click)="leave()" [disabled]="busy()">{{ 'Leave company' | t }}</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </section>

      @if (manager()) {
        <section class="card">
          <h3>{{ 'Pending invitations' | t }} · {{ t.invitations.length }}</h3>
          @if (t.invitations.length === 0) {
            <p class="faint small pad">{{ 'No pending invitations.' | t }}</p>
          } @else {
            <table class="table dense">
              <thead><tr><th>{{ 'Email' | t }}</th><th>{{ 'Role' | t }}</th><th>{{ 'Invited by' | t }}</th><th>{{ 'Expires' | t }}</th><th></th></tr></thead>
              <tbody>
                @for (i of t.invitations; track i.id) {
                  <tr>
                    <td>{{ i.email }}</td>
                    <td>{{ roleNames[i.role] }}</td>
                    <td class="faint">{{ i.invitedBy }}</td>
                    <td class="faint">{{ i.expiresAt | ldate }}</td>
                    <td class="acts">
                      <button class="btn btn-sm btn-ghost" type="button" (click)="newLink(i)" [disabled]="busy()"
                              [title]="'The old link stops working' | t">{{ 'New link' | t }}</button>
                      <button class="btn btn-sm btn-ghost btn-danger" type="button" (click)="revoke(i)" [disabled]="busy()">{{ 'Revoke' | t }}</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      } @else {
        <p class="faint small">{{ 'Only the owner or an admin can invite people or change roles.' | t }}</p>
      }
    }
  `,
  styles: `
    .banner { margin-bottom: 12px; }
    .card { margin-bottom: 16px; }
    .invite { padding: 14px 16px; }
    h3 { margin: 0; padding: 12px 16px; font-size: 14px; border-bottom: 1px solid var(--border); }
    .invite h3 { padding: 0 0 10px; border: 0; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .row .email { flex: 1 1 240px; width: auto; }
    .row select, .row .btn { flex: 0 0 auto; width: auto; }
    .row .mono { flex: 1 1 320px; font-size: 12px; }
    .small { font-size: 12px; }
    .pad { padding: 12px 16px; margin: 0; }
    .link { margin-top: 12px; padding: 12px; border: 1px solid var(--accent); border-radius: 8px; background: var(--accent-soft);
            display: flex; flex-direction: column; gap: 8px; }
    .dense th, .dense td { padding: 7px 12px; font-size: 13px; }
    .acts { text-align: right; white-space: nowrap; }
    .cell { height: 28px; padding: 0 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-input); color: var(--text); font: inherit; }
    @media (max-width: 640px) { .dense td:nth-child(2), .dense th:nth-child(2), .dense td:nth-child(4), .dense th:nth-child(4) { display: none; } }
  `,
})
export class TeamPanel {
  private readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmService);

  protected readonly team = httpResource<TeamDto>(() => '/api/team');
  private readonly billing = httpResource<BillingDto>(() => '/api/billing');
  protected readonly roles = ASSIGNABLE_ROLES;
  protected readonly roleNames = ROLE_NAMES;
  protected readonly email = signal('');
  protected readonly role = signal<AssignableRole>('MEMBER');
  protected readonly created = signal<CreatedInvitationDto | null>(null);
  protected readonly copied = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected message = errorMessage;

  protected readonly me = computed(() => this.auth.session()?.user.id ?? null);
  protected readonly myRole = computed<Role>(() => this.auth.session()?.organization.role ?? 'MEMBER');
  protected readonly manager = computed(() => canManageTeam(this.myRole()));
  /** What a new user costs, shown before inviting. */
  protected readonly seatNote = computed(() => {
    const b = this.billing.value();
    if (!b) return '';
    if (b.hasSubscription && b.status !== 'expired' && b.interval) {
      return t('Each user is a seat: a new member adds {price} per {interval} (prorated from the next bill).', { price: this.i18n.money(PLAN.pricePerSeat[b.interval], PLAN.currency), interval: t(b.interval === 'year' ? 'year' : 'month') });
    }
    return t('Each user will be a paid seat once you subscribe; nothing is charged during the trial.');
  });

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value.trim();
  }

  protected canChange(m: MemberDto): boolean {
    return m.userId !== this.me() && canManageMember(this.myRole(), m.role);
  }

  protected async invite(): Promise<void> {
    const check = inviteSchema.safeParse({ email: this.email(), role: this.role() });
    if (!check.success) {
      this.error.set(check.error.issues[0]?.message ?? t('Invalid invitation.'));
      return;
    }
    await this.run(async () => {
      const c = await firstValueFrom(this.http.post<CreatedInvitationDto>('/api/team/invitations', check.data));
      this.created.set(c);
      this.copied.set(false);
      this.email.set('');
    });
  }

  protected newLink(i: InvitationDto): Promise<void> {
    return this.run(async () => {
      const c = await firstValueFrom(this.http.post<CreatedInvitationDto>('/api/team/invitations', { email: i.email, role: i.role }));
      this.created.set(c);
      this.copied.set(false);
    });
  }

  protected async copy(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      this.copied.set(true);
    } catch {
      this.error.set(t('Copying is blocked by the browser; select the link and copy it by hand.'));
    }
  }

  protected revoke(i: InvitationDto): Promise<void> {
    return this.run(async () => {
      await firstValueFrom(this.http.delete(`/api/team/invitations/${i.id}`));
      if (this.created()?.invitation.id === i.id) this.created.set(null);
    });
  }

  protected changeRole(m: MemberDto, role: AssignableRole): Promise<void> {
    return this.run(() => firstValueFrom(this.http.patch(`/api/team/members/${m.userId}`, { role })));
  }

  protected async remove(m: MemberDto): Promise<void> {
    const ok = await this.confirm.ask({
      title: t('Remove {name}?', { name: m.name }),
      message: t('{name} loses access to this company at once. Their projects and drawings stay in the company.', { name: m.name }),
      confirmLabel: t('Remove'),
      danger: true,
    });
    if (!ok) return;
    await this.run(async () => {
      const r = await firstValueFrom(this.http.delete<{ seatsError: string | null }>(`/api/team/members/${m.userId}`));
      if (r.seatsError) this.error.set(tx(r.seatsError));
    });
  }

  protected async transfer(m: MemberDto): Promise<void> {
    const ok = await this.confirm.ask({
      title: t('Make {name} the owner?', { name: m.name }),
      message: t('{name} becomes the owner of the company and you become an admin. Only the new owner can undo this.', { name: m.name }),
      confirmLabel: t('Transfer ownership'),
      danger: true,
    });
    if (!ok) return;
    await this.run(async () => {
      await firstValueFrom(this.http.post('/api/team/transfer-ownership', { userId: m.userId }));
      await this.auth.refresh();
    });
  }

  protected async leave(): Promise<void> {
    const name = this.auth.session()?.organization.name ?? t('this company');
    const ok = await this.confirm.ask({
      title: t('Leave {name}?', { name }),
      message: t('You lose access to its projects. You will be signed out; sign in again to open your other companies, if any.'),
      confirmLabel: t('Leave company'),
      danger: true,
    });
    if (!ok) return;
    await this.run(async () => {
      await firstValueFrom(this.http.post('/api/team/leave', {}));
      this.auth.markSignedOut();
      window.location.assign('/sign-in');
    }, false);
  }

  private async run(action: () => Promise<unknown>, reload = true): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      if (reload) {
        this.team.reload();
        this.billing.reload();
      }
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
