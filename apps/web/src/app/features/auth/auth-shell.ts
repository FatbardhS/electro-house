import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PLAN, TRIAL_DAYS } from '@electro/shared';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import type { TKey } from '../../core/i18n/sq';
import { BrandMark } from '../../shared/ui/brand-mark';
import { LangSwitch } from '../../shared/ui/lang-switch';
import { PlanAnimation } from '../../shared/ui/plan-animation';

const HIGHLIGHTS: readonly TKey[] = [
  'Draw lights, sockets and switches straight on the architect’s PDF.',
  'Wire lengths and the material list are calculated for you.',
  'Checks warn you about overloaded circuits and missing protection.',
  'Export a clean PDF plan and DXF for the client and the site.',
];

/** Split layout for sign-in, sign-up and invitations: the form on the left, an animated showcase on the right. */
@Component({
  selector: 'app-auth-shell',
  imports: [RouterLink, BrandMark, LangSwitch, PlanAnimation, I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="layout">
      <section class="form-side">
        <header>
          <a class="brand" routerLink="/"><app-brand-mark /> Electro House</a>
          <app-lang-switch />
        </header>
        <div class="form-wrap"><ng-content /></div>
        <footer><a routerLink="/">← {{ 'Discover Electro House' | t }}</a></footer>
      </section>

      <aside class="show-side" aria-hidden="true">
        <div class="orb o1"></div><div class="orb o2"></div>
        <div class="show-inner">
          <span class="chip">⚡ {{ 'Electrical planning for professionals' | t }}</span>
          <h2>{{ 'From the architect’s plan to a finished installation plan in minutes.' | t }}</h2>
          <div class="stage">
            <app-plan-animation />
            <div class="float f1"><strong>42,6 m</strong><span>{{ 'cable NYM 3×1,5' | t }}</span></div>
            <div class="float f2"><span class="ok">✓</span>{{ 'All checks passed' | t }}</div>
          </div>
          <p class="ticker">
            @for (h of highlights; track h; let i = $index) {
              <span [class.on]="i === current()">{{ h | t }}</span>
            }
          </p>
          <div class="price">
            <strong>{{ price }} €</strong> {{ '/ user / month' | t }} · {{ '{n} days free' | t: { n: trialDays } }}
          </div>
        </div>
      </aside>
    </div>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: var(--bg); }
    .layout { display: grid; grid-template-columns: minmax(360px, 520px) 1fr; min-height: 100vh; }
    .form-side { display: flex; flex-direction: column; padding: 24px clamp(20px, 4vw, 48px); }
    header { display: flex; align-items: center; justify-content: space-between; }
    .brand { display: flex; align-items: center; gap: 10px; color: var(--text); font-weight: 700; font-size: 16px; }
    .brand:hover { text-decoration: none; }
    .form-wrap { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 32px 0;
                 animation: rise .6s cubic-bezier(.2,.7,.2,1) both; }
    footer { font-size: 13px; }
    footer a { color: var(--text-muted); }
    .show-side { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;
                 padding: 40px; border-left: 1px solid var(--border);
                 background: radial-gradient(circle at 70% 20%, rgba(62,207,142,.16), transparent 50%),
                             radial-gradient(circle at 10% 90%, rgba(108,182,255,.10), transparent 45%), #0b0e10; }
    .orb { position: absolute; border-radius: 50%; filter: blur(60px); opacity: .5; animation: drift 14s ease-in-out infinite alternate; }
    .o1 { width: 320px; height: 320px; background: rgba(62,207,142,.25); top: -80px; right: -60px; }
    .o2 { width: 260px; height: 260px; background: rgba(108,182,255,.18); bottom: -60px; left: 10%; animation-delay: -6s; }
    .show-inner { position: relative; width: min(640px, 100%); display: flex; flex-direction: column; gap: 18px; }
    .chip { align-self: flex-start; padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;
            color: var(--accent); background: var(--accent-soft); border: 1px solid rgba(62,207,142,.3); }
    h2 { font-size: clamp(20px, 2.2vw, 28px); line-height: 1.25; letter-spacing: -.02em;
         background: linear-gradient(90deg, #fff, #9df5cb, #fff); background-size: 200% auto;
         -webkit-background-clip: text; background-clip: text; color: transparent; animation: shine 6s linear infinite; }
    .stage { position: relative; }
    .float { position: absolute; display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-radius: 10px;
             background: rgba(22,26,29,.92); border: 1px solid var(--border); box-shadow: var(--shadow); font-size: 12px;
             backdrop-filter: blur(6px); opacity: 0; animation: pop .6s cubic-bezier(.3,1.5,.5,1) forwards, bob 5s ease-in-out infinite; }
    .float strong { font: 700 15px var(--mono); color: var(--accent); }
    .float span { color: var(--text-muted); }
    .f1 { left: -14px; bottom: 14%; animation-delay: 4.6s, 5.2s; }
    .f2 { right: -10px; top: 8%; animation-delay: 5.2s, 5.8s; }
    .ok { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--accent); color: var(--accent-text) !important; font-weight: 800; }
    .ticker { position: relative; height: 44px; margin: 0; color: var(--text-muted); font-size: 15px; }
    .ticker span { position: absolute; inset: 0; opacity: 0; transform: translateY(10px); transition: opacity .6s, transform .6s; }
    .ticker span.on { opacity: 1; transform: none; }
    .price { font-size: 13px; color: var(--text-muted); }
    .price strong { color: var(--text); font-size: 16px; }
    @keyframes rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
    @keyframes pop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: scale(1); } }
    @keyframes bob { 0%, 100% { translate: 0 0; } 50% { translate: 0 -8px; } }
    @keyframes drift { to { transform: translate(-40px, 50px) scale(1.15); } }
    @keyframes shine { to { background-position: 200% center; } }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .show-side { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } .float { opacity: 1; } }
  `,
})
export class AuthShell {
  protected readonly highlights = HIGHLIGHTS;
  protected readonly current = signal(0);
  protected readonly trialDays = TRIAL_DAYS;
  protected readonly price = PLAN.pricePerSeat.month;

  constructor() {
    const timer = setInterval(() => this.current.update((i) => (i + 1) % HIGHLIGHTS.length), 3800);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
