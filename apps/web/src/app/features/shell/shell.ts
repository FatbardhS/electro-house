import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { BrandMark } from '../../shared/ui/brand-mark';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, BrandMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="topbar">
      <a class="brand" routerLink="/clients"><app-brand-mark [size]="20" /> Electro House</a>
      <nav>
        <a routerLink="/clients" routerLinkActive="active">Clients</a>
        <a routerLink="/projects" routerLinkActive="active">Projects</a>
        <a routerLink="/settings" routerLinkActive="active">Settings</a>
      </nav>
      <div class="spacer"></div>
      @if (auth.session(); as s) {
        <div class="who">
          <span>{{ s.user.name }}</span>
          <span class="faint">{{ s.organization.name }}</span>
        </div>
      }
      <button class="btn btn-sm btn-ghost" type="button" (click)="auth.signOut()">Sign out</button>
    </header>
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
    main { flex: 1; }
    @media (max-width: 640px) { .who { display: none; } .topbar { gap: 12px; padding: 0 12px; } }
  `,
})
export class Shell {
  protected readonly auth = inject(AuthService);
}
