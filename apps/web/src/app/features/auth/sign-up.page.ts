import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { signUpSchema } from '@electro/shared';
import { AuthService } from '../../core/auth.service';
import { FormState } from '../../core/forms';
import { BrandMark } from '../../shared/ui/brand-mark';

@Component({
  selector: 'app-sign-up-page',
  imports: [FormsModule, RouterLink, BrandMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-layout.css',
  template: `
    <div class="card auth-card">
      <div class="brand"><app-brand-mark /> Electro House</div>
      <h1>Create your account</h1>
      <p class="lead">Your company gets its own private workspace.</p>

      @if (form.formError(); as err) {
        <div class="banner banner-error" role="alert">{{ err }}</div>
      }

      <form (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="name">Your name</label>
          <input id="name" class="input" name="name" autocomplete="name"
                 [(ngModel)]="model.name" [class.invalid]="form.error('name')" />
          @if (form.error('name'); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label for="org">Company name</label>
          <input id="org" class="input" name="organizationName" autocomplete="organization"
                 [(ngModel)]="model.organizationName" [class.invalid]="form.error('organizationName')" />
          @if (form.error('organizationName'); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" class="input" type="email" name="email" autocomplete="email"
                 [(ngModel)]="model.email" [class.invalid]="form.error('email')" />
          @if (form.error('email'); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" class="input" type="password" name="password" autocomplete="new-password"
                 [(ngModel)]="model.password" [class.invalid]="form.error('password')" />
          @if (form.error('password'); as e) { <span class="field-error">{{ e }}</span> }
          @else { <span class="faint" style="font-size: 12px">At least 10 characters.</span> }
        </div>
        <button class="btn btn-primary" type="submit" [disabled]="form.submitting()">
          {{ form.submitting() ? 'Creating account…' : 'Create account' }}
        </button>
      </form>
      <p class="switch">Already have an account? <a routerLink="/sign-in">Sign in</a></p>
    </div>
  `,
})
export class SignUpPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly model = { name: '', organizationName: '', email: '', password: '' };
  protected readonly form = new FormState(signUpSchema);

  protected async submit(): Promise<void> {
    const ok = await this.form.submit(this.model, (v) => this.auth.signUp(v));
    if (ok) await this.router.navigateByUrl('/clients');
  }
}
