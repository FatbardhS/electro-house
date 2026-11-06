import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { summaryBanner } from '@electro/shared';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { I18n } from '../../core/i18n/i18n.service';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import { BrandMark } from '../../shared/ui/brand-mark';
import { LangSwitch } from '../../shared/ui/lang-switch';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, BrandMark, LangSwitch, I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="topbar">
      <a class="brand" routerLink="/clients"><app-brand-mark [size]="20" /> Electro House</a>
      <nav>
        <a routerLink="/clients" routerLinkActive="active">{{ 'Clients' | t }}</a>
        <a routerLink="/projects" routerLinkActive="active">{{ 'Projects' | t }}</a>
        <a routerLink="/settings" routerLinkActive="active">{{ 'Settings' | t }}</a>
      </nav>
      <div class="spacer"></div>
      @if (auth.session(); as s) {
        <div class="who">
          <span>{{ s.user.name }}</span>
          @if (s.organizations.length > 1) {
            <select class="switcher" (change)="switchTo($any($event.target).value)" [attr.aria-label]="'Company' | t">
              @for (o of s.organizations; track o.id) { <option [value]="o.id" [selected]="o.id === s.organization.id">{{ o.name }}</option> }
            </select>
          } @else {
            <span class="faint">{{ s.organization.name }}</span>
          }
        </div>
      }
      <app-lang-switch />
      <button class="btn btn-sm btn-ghost" type="button" (click)="auth.signOut()">{{ 'Sign out' | t }}</button>
    </header>
    @if (banner(); as b) {
      <div class="billing-banner" [class]="'billing-banner ' + b.kind" role="status">
        <span>{{ b.text }}</span>
        @if (canManage()) { <a routerLink="/settings" [queryParams]="{ tab: 'billing' }">{{ 'Billing' | t }}</a> }
      </div>
    }
    <main><router-outlet /></main>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 100vh; }
    .topbar {
      display: flex; align-items: center; gap: 24px;
      height: 52px; padding: 0 20px;
      background: var(--bg-elev); border-bottom: 1px solid var(--border);
      position: sticky; top: 0; z-index: 10;
    }
    .brand { display: flex; align-items: center; gap: 8px; color: var(--text); font-weight: 700; }
    .brand:hover { text-decoration: none; }
    nav { display: flex; gap: 4px; }
    nav a {
      padding: 6px 10px; border-radius: var(--radius); color: var(--text-muted); font-weight: 500;
    }
    nav a:hover { color: var(--text); background: var(--bg-elev-2); text-decoration: none; }
    nav a.active { color: var(--accent); background: var(--accent-soft); }
    .spacer { flex: 1; }
    .who { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.2; font-size: 13px; }
    .who .faint { font-size: 11px; }
    .switcher { margin-top: 1px; max-width: 200px; padding: 1px 4px; border: 1px solid var(--border); border-radius: 4px;
                background: var(--bg-input); color: var(--text-muted); font: 11px var(--font); }
    main { flex: 1; }
    .billing-banner { display: flex; gap: 12px; align-items: center; justify-content: center; flex-wrap: wrap;
                      padding: 8px 16px; font-size: 13px; border-bottom: 1px solid var(--border); text-align: center; }
    .billing-banner a { font-weight: 600; }
    .billing-banner.info { background: var(--accent-soft); }
    .billing-banner.warn { background: var(--warn-soft); }
    .billing-banner.error { background: rgba(229, 72, 77, 0.14); }
    @media (max-width: 640px) { .who { display: none; } .topbar { gap: 12px; padding: 0 12px; } }
  `,
})
export class Shell {
  protected readonly auth = inject(AuthService);
  private readonly i18n = inject(I18n);
  protected readonly banner = computed(() => {
    const billing = this.auth.session()?.organization.billing;
    if (!billing) return null;
    const b = summaryBanner(billing);
    this.i18n.lang(); // re-translate on language change
    return b ? { ...b, text: this.i18n.tx(b.text) } : null;
  });
  protected readonly canManage = computed(() => this.auth.session()?.organization.role !== 'MEMBER');

  protected switchTo(organizationId: string): void {
    void this.auth.switchOrganization(organizationId);
  }
}
