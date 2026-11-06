# Phase 8 – Albanian first, English second, and a product page

## 8A (done)

**Languages**
- Albanian (`sq`) is the default for everyone; a **SQ | EN** switch is in the top bar and on the sign-in/sign-up pages.
- Switching is instant. Signed in, the choice is saved on the account (`User.language`, `POST /api/auth/language`)
  and applied at every sign-in; signed out it is remembered in the browser. New accounts get the language they
  signed up in.
- Numbers, money and dates follow the language (Albanian: `1.234,50 €`, `06.11.2026`). Chrome and Edge ship no
  Albanian `Intl` data, so the Albanian formats use the de-DE patterns, which match.

**How translation works** (`apps/web/src/app/core/i18n/`)
- The English text is the key: `{{ 'Sign in' | t }}`, `t('Delete {name}?', { name })`.
- Every key must exist in the Albanian dictionary (`sq-*.ts`) – the build fails otherwise, so no screen can be
  left half-translated.
- `| tx` / `tx()` translate text that arrives at runtime (server and validation messages, catalog names) when it
  matches `sq-messages.ts`; anything unknown is shown unchanged.
- Electrical terms are collected in `sq-editor.ts`, `sq-installation.ts` and `sq-messages.ts` for review.

**Product page and sign-in**
- `/` for visitors (and `/welcome` for everyone): animated hero with a self-drawing floor plan, how it works,
  features, a showroom of real app screens, pricing (29 € / user / month, 290 € / year, 14-day trial), FAQ.
- Sign-in, sign-up and invitations use a split layout with the animated plan and rotating highlights.
- Animations respect “reduce motion”.

**Showroom images** (`apps/web/public/showroom/*-sq.webp`, `*-en.webp`)
1. `node scripts/seed-showroom.mjs <email> <password>` – sample house with circuits, symbols and wires.
2. `node scripts/seed-showroom-prices.mjs <email> <password>` – sample materials and rules (fictional prices).
3. `node scripts/capture-showroom.mjs <email> <password> <projectId> <floorId>` – headless Chrome screenshots.

## 8B (next)
- Check messages, warnings and banners generated in `packages/shared` (they still arrive in English).
- Server error messages in the user’s language.
- PDF and DXF exports in the language of whoever exports; example price list created in the current language.
