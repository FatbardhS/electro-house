import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ROLE_NAMES, invitationSignUpSchema, type InvitationPreviewDto, type SessionDto } from '@electro/shared';
import { errorMessage, toApiError } from '../../core/api-error';
import { AuthService } from '../../core/auth.service';
import { FormState } from '../../core/forms';
import { BrandMark } from '../../shared/ui/brand-mark';
import { LoadingState } from '../../shared/ui/states';

/** `/invite/:token`: join a company with an invitation link, as a new or existing user. */
@Component({
  selector: 'app-invitation-page',
  imports: [FormsModule, RouterLink, BrandMark, LoadingState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-layout.css',
  template: `
    <div class="card auth-card">
      <div class="brand"><app-brand-mark /> Electro House</div>
      @if (preview.error(); as err) {
        <h1>Invitation not found</h1>
        <div class="banner banner-error" role="alert">{{ message(err) }}</div>
        <p class="lead"><a routerLink="/sign-in">Go to sign in</a></p>
      } @else if (!preview.hasValue() || !sessionChecked()) {
        <app-loading label="Opening invitation…" />
      } @else {
        @let p = preview.value();
        <h1>Join {{ p.organizationName }}</h1>
        <p class="lead">{{ p.invitedBy }} invited <strong>{{ p.email }}</strong> as <strong>{{ roleName(p.role) }}</strong>.</p>

        @if (p.status !== 'valid') {
          <div class="banner banner-error" role="alert">{{ statusText[p.status] }}</div>
        } @else {
          @if (error(); as e) { <div class="banner banner-error" role="alert">{{ e }}</div> }
          @if (signedInEmail(); as me) {
            @if (me.toLowerCase() === p.email.toLowerCase()) {
              <button class="btn btn-primary" type="button" (click)="accept()" [disabled]="busy()">{{ busy() ? 'Joining…' : 'Join ' + p.organizationName }}</button>
            } @else {
              <div class="banner banner-warn">You are signed in as {{ me }}. This invitation is for {{ p.email }}.</div>
              <button class="btn" type="button" (click)="signOut()">Sign out and continue</button>
            }
          } @else if (p.accountExists) {
            <p>You already have an account. Sign in with {{ p.email }} to join.</p>
            <a class="btn btn-primary" routerLink="/sign-in" [queryParams]="{ next: '/invite/' + token() }">Sign in to join</a>
          } @else {
            @if (form.formError(); as err) { <div class="banner banner-error" role="alert">{{ err }}</div> }
            <form (ngSubmit)="signUp()" novalidate>
              <div class="field">
                <label for="email">Email</label>
                <input id="email" class="input" type="email" [value]="p.email" disabled />
              </div>
              <div class="field">
                <label for="name">Your name</label>
                <input id="name" class="input" name="name" autocomplete="name" [(ngModel)]="model.name" [class.invalid]="form.error('name')" />
                @if (form.error('name'); as e) { <span class="field-error">{{ e }}</span> }
              </div>
              <div class="field">
                <label for="password">Password</label>
                <input id="password" class="input" type="password" name="password" autocomplete="new-password"
                       [(ngModel)]="model.password" [class.invalid]="form.error('password')" />
                @if (form.error('password'); as e) { <span class="field-error">{{ e }}</span> }
                @else { <span class="faint" style="font-size: 12px">At least 10 characters.</span> }
              </div>
              <button class="btn btn-primary" type="submit" [disabled]="form.submitting()">
                {{ form.submitting() ? 'Creating account…' : 'Create account and join' }}</button>
            </form>
          }
        }
      }
    </div>
  `,
})
export class InvitationPage {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  readonly token = input.required<string>();

  protected readonly preview = httpResource<InvitationPreviewDto>(() => `/api/invitations/${encodeURIComponent(this.token())}`);
  protected readonly sessionChecked = signal(false);
  protected readonly signedInEmail = computed(() => this.auth.session()?.user.email ?? null);
  protected readonly form = new FormState(invitationSignUpSchema);
  protected readonly model = { name: '', password: '' };
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly statusText = {
    used: 'This invitation has already been used.',
    revoked: 'This invitation was withdrawn. Ask for a new one.',
    expired: 'This invitation has expired. Ask for a new one.',
    valid: '',
  } as const;
  protected message = errorMessage;

  constructor() {
    // Works signed in or out: find out which, without redirecting.
    this.auth
      .ensureLoaded()
      .catch(() => null)
      .finally(() => this.sessionChecked.set(true));
  }

  protected roleName(role: keyof typeof ROLE_NAMES): string {
    return ROLE_NAMES[role];
  }

  protected async accept(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      const s = await firstValueFrom(this.http.post<SessionDto>(`/api/invitations/${this.token()}/accept`, {}));
      this.auth.adopt(s);
      window.location.assign('/clients'); // fresh start inside the new company
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async signUp(): Promise<void> {
    await this.form.submit(this.model, async (v) => {
      const s = await firstValueFrom(this.http.post<SessionDto>(`/api/invitations/${this.token()}/sign-up`, v));
      this.auth.adopt(s);
      await this.router.navigateByUrl('/clients');
    });
  }

  protected async signOut(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/sign-out', {})).catch(() => undefined);
    this.auth.markSignedOut();
    // Stay here: the page now offers sign-in or sign-up for the invited email.
    window.location.reload();
  }
}
