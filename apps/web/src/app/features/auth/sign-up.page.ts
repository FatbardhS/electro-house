import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TRIAL_DAYS, signUpSchema } from '@electro/shared';
import { AuthService } from '../../core/auth.service';
import { FormState } from '../../core/forms';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import { AuthShell } from './auth-shell';

@Component({
  selector: 'app-sign-up-page',
  imports: [FormsModule, RouterLink, AuthShell, I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-layout.css',
  template: `
    <app-auth-shell>
      <h1>{{ 'Create your account' | t }}</h1>
      <p class="lead">{{ '{n} days free, no card needed. Your company gets its own private workspace.' | t: { n: trialDays } }}</p>

      @if (form.formError(); as err) {
        <div class="banner banner-error" role="alert">{{ err | tx }}</div>
      }

      <form (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="name">{{ 'Your name' | t }}</label>
          <input id="name" class="input" name="name" autocomplete="name"
                 [(ngModel)]="model.name" [class.invalid]="form.error('name')" />
          @if (form.error('name'); as e) { <span class="field-error">{{ e | tx }}</span> }
        </div>
        <div class="field">
          <label for="org">{{ 'Company name' | t }}</label>
          <input id="org" class="input" name="organizationName" autocomplete="organization"
                 [(ngModel)]="model.organizationName" [class.invalid]="form.error('organizationName')" />
          @if (form.error('organizationName'); as e) { <span class="field-error">{{ e | tx }}</span> }
        </div>
        <div class="field">
          <label for="email">{{ 'Email' | t }}</label>
          <input id="email" class="input" type="email" name="email" autocomplete="email"
                 [(ngModel)]="model.email" [class.invalid]="form.error('email')" />
          @if (form.error('email'); as e) { <span class="field-error">{{ e | tx }}</span> }
        </div>
        <div class="field">
          <label for="password">{{ 'Password' | t }}</label>
          <input id="password" class="input" type="password" name="password" autocomplete="new-password"
                 [(ngModel)]="model.password" [class.invalid]="form.error('password')" />
          @if (form.error('password'); as e) { <span class="field-error">{{ e | tx }}</span> }
          @else { <span class="faint" style="font-size: 12px">{{ 'At least 10 characters.' | t }}</span> }
        </div>
        <button class="btn btn-primary" type="submit" [disabled]="form.submitting()">
          {{ (form.submitting() ? 'Creating account…' : 'Create account') | t }}
        </button>
      </form>
      <p class="switch">{{ 'Already have an account?' | t }} <a routerLink="/sign-in">{{ 'Sign in' | t }}</a></p>
    </app-auth-shell>
  `,
})
export class SignUpPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly model = { name: '', organizationName: '', email: '', password: '' };
  protected readonly form = new FormState(signUpSchema);
  protected readonly trialDays = TRIAL_DAYS;

  protected async submit(): Promise<void> {
    const ok = await this.form.submit(this.model, (v) => this.auth.signUp(v));
    if (ok) await this.router.navigateByUrl('/clients');
  }
}
