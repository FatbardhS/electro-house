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

## 8B (done)

- **One translator for runtime texts** in `packages/shared/src/i18n` (`translateText`, dictionary `sq-runtime.ts`),
  used by the web app and the API. Exact texts first, then templates such as
  `Circuit {c}: estimated {a} A is above its {b} A breaker.` – the values inside are translated too, and decimals
  become Albanian (`2.5` → `2,5`). So check messages, circuit warnings, billing banners, validation and server
  messages appear in Albanian without changing the code that writes them.
- **PDF export in the language of the user who exports** (`apps/api/src/exports/export-lang.ts`): every heading,
  table and paragraph goes through the translator; numbers and money use 1.234,50.
- **DXF stays technical English** (CAD layer and linetype names; R12 DXF does not handle ë/ç reliably).
- **Example price list** is created in the user's language; floor-name presets (Përdhesa, Kati i parë…) follow the
  interface language; units are shown translated (copë, orë…).
- The web app imports only `@electro/shared/i18n` at start-up, so the landing page stays small.
- Tests: translator unit tests; e2e checks for the Albanian example price list and the PDF language.

Not translated on purpose: anything the user typed (client, project, floor, material names) and price lists saved
before this change.
