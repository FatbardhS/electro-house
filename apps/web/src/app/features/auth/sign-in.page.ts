import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TRIAL_DAYS, signInSchema } from '@electro/shared';
import { AuthService } from '../../core/auth.service';
import { FormState } from '../../core/forms';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import { AuthShell } from './auth-shell';

@Component({
  selector: 'app-sign-in-page',
  imports: [FormsModule, RouterLink, AuthShell, I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-layout.css',
  template: `
    <app-auth-shell>
      <h1>{{ 'Welcome back' | t }}</h1>
      <p class="lead">{{ 'Sign in to continue planning your installations.' | t }}</p>

      @if (form.formError(); as err) {
        <div class="banner banner-error" role="alert">{{ err | tx }}</div>
      }

      <form (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="email">{{ 'Email' | t }}</label>
          <input id="email" class="input" type="email" name="email" autocomplete="email"
                 [(ngModel)]="model.email" [class.invalid]="form.error('email')" required />
          @if (form.error('email'); as e) { <span class="field-error">{{ e | tx }}</span> }
        </div>
        <div class="field">
          <label for="password">{{ 'Password' | t }}</label>
          <input id="password" class="input" type="password" name="password" autocomplete="current-password"
                 [(ngModel)]="model.password" [class.invalid]="form.error('password')" required />
          @if (form.error('password'); as e) { <span class="field-error">{{ e | tx }}</span> }
        </div>
        <button class="btn btn-primary" type="submit" [disabled]="form.submitting()">
          {{ (form.submitting() ? 'Signing in…' : 'Sign in') | t }}
        </button>
      </form>
      <p class="switch">{{ 'New here?' | t }} <a routerLink="/sign-up">{{ 'Create an account – {n} days free' | t: { n: trialDays } }}</a></p>
    </app-auth-shell>
  `,
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Where to go after signing in (from the query string). */
  readonly next = input<string>();

  protected readonly model = { email: '', password: '' };
  protected readonly form = new FormState(signInSchema);
  protected readonly trialDays = TRIAL_DAYS;

  protected async submit(): Promise<void> {
    const ok = await this.form.submit(this.model, (v) => this.auth.signIn(v));
    if (ok) await this.router.navigateByUrl(safeNext(this.next()));
  }
}

/** Only allow in-app relative redirects. */
export function safeNext(next: string | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/clients';
}
