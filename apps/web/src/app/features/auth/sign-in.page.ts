import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { signInSchema } from '@electro/shared';
import { AuthService } from '../../core/auth.service';
import { FormState } from '../../core/forms';
import { BrandMark } from '../../shared/ui/brand-mark';

@Component({
  selector: 'app-sign-in-page',
  imports: [FormsModule, RouterLink, BrandMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-layout.css',
  template: `
    <div class="card auth-card">
      <div class="brand"><app-brand-mark /> Electro House</div>
      <h1>Sign in</h1>
      <p class="lead">Electrical installation planning for professionals.</p>

      @if (form.formError(); as err) {
        <div class="banner banner-error" role="alert">{{ err }}</div>
      }

      <form (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" class="input" type="email" name="email" autocomplete="email"
                 [(ngModel)]="model.email" [class.invalid]="form.error('email')" required />
          @if (form.error('email'); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" class="input" type="password" name="password" autocomplete="current-password"
                 [(ngModel)]="model.password" [class.invalid]="form.error('password')" required />
          @if (form.error('password'); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <button class="btn btn-primary" type="submit" [disabled]="form.submitting()">
          {{ form.submitting() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
      <p class="switch">New here? <a routerLink="/sign-up">Create an account</a></p>
    </div>
  `,
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Where to go after signing in (from the query string). */
  readonly next = input<string>();

  protected readonly model = { email: '', password: '' };
  protected readonly form = new FormState(signInSchema);

  protected async submit(): Promise<void> {
    const ok = await this.form.submit(this.model, (v) => this.auth.signIn(v));
    if (ok) await this.router.navigateByUrl(safeNext(this.next()));
  }
}

/** Only allow in-app relative redirects. */
export function safeNext(next: string | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/clients';
}
