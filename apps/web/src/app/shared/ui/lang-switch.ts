import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { I18n, type Lang } from '../../core/i18n/i18n.service';

/** SQ | EN toggle. Signed in, the choice is also saved on the account so it follows the user. */
@Component({
  selector: 'app-lang-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="seg" role="group" aria-label="Language / Gjuha">
      <button type="button" [class.on]="i18n.lang() === 'sq'" (click)="pick('sq')" [attr.aria-pressed]="i18n.lang() === 'sq'" title="Shqip">SQ</button>
      <button type="button" [class.on]="i18n.lang() === 'en'" (click)="pick('en')" [attr.aria-pressed]="i18n.lang() === 'en'" title="English">EN</button>
    </div>
  `,
  styles: `
    .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; padding: 2px; background: var(--bg-input); }
    button { border: 0; background: transparent; color: var(--text-muted); font: 600 11px var(--font); letter-spacing: .04em;
             padding: 3px 9px; border-radius: 999px; cursor: pointer; transition: background .2s, color .2s; }
    button:hover { color: var(--text); }
    button.on { background: var(--accent); color: var(--accent-text); }
  `,
})
export class LangSwitch {
  protected readonly i18n = inject(I18n);
  private readonly auth = inject(AuthService);

  protected pick(lang: Lang): void {
    if (this.i18n.lang() === lang) return;
    this.i18n.set(lang);
    if (this.auth.isSignedIn()) void this.auth.saveLanguage(lang);
  }
}
