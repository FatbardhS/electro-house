# Phase 5: Reporting and billing

Status: **5A implemented** (2026-11-06); 5B (billing) not started. Builds on Phases 1–4. Implementation notes in §11.

Goal: from the drawn installation, an electrician gets a material list with prices, a cost estimate for the client,
and printable vector PDFs of the plans and schedules. The app can then be sold as a subscription.

Phase 5 is split into two parts that ship and get approved separately:

- **5A: Reporting.** Price list, bill of materials, cost report and PDF exports. Needs nothing from outside.
- **5B: Billing.** Subscriptions with a payment provider. Needs your provider account and decisions on plans (see §7).

---

## 1. Scope

**5A, in scope**
- Company price list: materials with unit, price and supplier code. Import and export as CSV.
- Mapping from each component type and cable type to the materials it consumes (e.g. a double outlet = 1 device + 1 flush box + 1 frame).
- Bill of materials (BOM) per project, computed live from the plans, with **measured** and **allowance**
  quantities shown separately.
- Cost report: materials, labour, markup, VAT, totals. Per-project overrides.
- Vector PDF exports: each floor plan, the full project, legend, circuit list, board schedules, BOM and cost report.
  Choose which layers and which sections to include.

**5A, not in scope**
- Sending quotes to clients, e-signatures, invoices to clients (a later "quotes" feature could build on the cost report).
- Live supplier price feeds (CSV import covers price updates).
- Saved versions of a quote (see §8; the PDF is the frozen record for now).

**5B, in scope:** plans, trial, checkout, customer portal, webhook-driven subscription status, read-only mode when a
subscription lapses. **Not in scope:** usage-based pricing, coupons UI, team seat management beyond a seat count.

---

## 2. Price list and material mapping

All prices belong to the **organization** (company), not to a project, so they are maintained once.

```prisma
model Material {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String   @db.Uuid
  code           String?              // supplier article number, optional
  name           String               // "Flush box 60 mm", "NYM-J 3×1.5 mm²"
  unit           String               // "pcs" | "m" | "pack" | free text
  unitPrice      Decimal  @db.Decimal(12, 4)   // net price in the organization currency
  packSize       Decimal? @db.Decimal(12, 3)   // e.g. 100 (m per drum); BOM can round up to whole packs
  category       String?
  archived       Boolean  @default(false)      // keep history; hidden from pickers
  @@unique([organizationId, code])
}

model MaterialRule {                  // "what a component / cable consumes"
  id             String  @id @default(uuid()) @db.Uuid
  organizationId String  @db.Uuid
  target         String               // "component:outlet.double" | "cable:NYM-J|3|1.5" | "cable:NYM-J|*|*"
  materialId     String  @db.Uuid
  quantity       Decimal @db.Decimal(12, 4)    // per component, or per metre for cables
  labourMinutes  Int     @default(0)            // installation time per unit
}
```

- Money is stored as `Decimal`, never float, and sent to the browser as strings. Calculations use integer
  minor units (cents) in `packages/shared`, so the web preview and the PDF show the same numbers.
- **Organization settings** (new JSON column): currency (ISO code, e.g. EUR), VAT %, default markup %,
  hourly labour rate, waste %, allowance defaults (§3).
- **Starter data:** new companies get an *empty* price list plus an optional "load example materials" button with
  clearly fictional example prices. No real supplier prices are shipped.
- **Unmapped items are never hidden.** A component type or cable with no rule appears in the BOM as
  "no material assigned", with a link to create a rule.

---

## 3. Bill of materials

Computed in `packages/shared/src/reports/` from the existing `InstallationDto` plus the price list and rules,
so the screen and the PDF use the same code. Nothing is stored; it updates as the plans change.

**Components:** count per type → materials via rules.

**Cable per type and size**, in separate columns:

| Column | Source |
|---|---|
| Measured | Sum of wire route lengths on calibrated floors (Phase 3) + floor connections (Phase 4) |
| Vertical drops | For each wire end at a component with a mounting height: `ceiling height − mount height` (cable runs in the ceiling), or `mount height` if the floor's routing is set to "in floor". Uses a new `Floor.ceilingHeightMm` (default 2600). |
| Terminations | Fixed reserve per connected end (default 0.2 m) and per end at a distribution board (default 0.5 m) |
| Waste | `waste %` of the sum above (default 5 %) |
| Total | Sum; optionally rounded up to whole packs/drums |

- All allowance defaults are editable in organization settings and can be overridden per project.
- Wires on **uncalibrated floors** are listed with "length unknown" and a warning; they are never estimated silently.
- BOM can be grouped by floor, by circuit or for the whole project.

---

## 4. Cost report

- **Materials:** BOM quantities × unit price.
- **Labour:** sum of `labourMinutes` from rules × quantities, × hourly rate. A manual extra hours line per project.
- **Markup** % on materials (separate from labour), **VAT** %, totals net and gross.
- **Per-project overrides** (new `Project.costSettings` JSON): markup, VAT, hourly rate, extra lines
  (free text + amount, e.g. "Commissioning and testing").
- The report states the price-list date and "estimate, not a binding quote" unless the user edits that text.

---

## 5. PDF exports

**Generated on the server (NestJS) with `pdf-lib`**, because the server has the stored plan PDFs and the result
must look the same everywhere.

- **The architect's plan stays vector.** The original PDF page is embedded with `pdf-lib`'s `embedPage`
  (a form XObject), not rasterised, so text and lines stay sharp and the file stays small. Floor rotation and
  page selection are applied.
- **Symbols and wires are drawn as vectors** from the same `SymbolPrimitive` data the editor uses (catalog
  already defines them in paper millimetres for this reason). Labels, wire colours and line styles match the editor.
- **Layers:** the export dialog lists the floor layers; hidden ones are left out. Optionally each layer becomes a
  PDF optional-content group (toggleable in Acrobat). This is lower priority; if pdf-lib makes it fragile it is dropped
  rather than half-done.
- **Sheet:** paper size and orientation (A4/A3/A2/A1, or "same as plan"), scale note from calibration
  (e.g. "1:100 at A3" when it matches, otherwise "not to a fixed scale"), title block with company, client,
  project, floor, date and revision.
- **Sections** (each optional): cover page, one page per floor, legend (only symbols actually used),
  circuit list, board schedules, floor connections, BOM, cost report.
- **Fonts:** an embedded open-licence font (Noto Sans, via `@pdf-lib/fontkit`) so characters like ², ×, φ, Ω and
  non-English names (ë, ç, ü …) print correctly. The standard PDF fonts cannot.
- **Endpoint:** `POST /api/projects/:id/exports` with the options → returns the PDF as a download. Projects
  with large plans are generated in a few seconds; if that becomes slow, it moves to a background job later.

---

## 6. Screens

- **Settings → Price list:** table with search, add/edit/archive, CSV import (preview of changes before applying) and export.
- **Settings → Material rules:** per component type and cable type, the materials consumed and labour minutes.
- **Settings → Company:** currency, VAT, markup, labour rate, allowances, logo for PDF title blocks.
- **Project → Materials & costs** (new tab on the Circuits & calculations page): BOM with grouping and the
  measured / allowance columns, cost summary, warnings for unmapped items and uncalibrated floors.
- **Project → Export PDF** dialog: sections, floors, layers, paper size; generates and downloads.

---

## 7. Billing (5B)

Proposed shape, to confirm before 5B starts:

- `Organization` gets `subscriptionStatus` (trialing | active | past_due | canceled), `plan`, `trialEndsAt`,
  `currentPeriodEnd`, provider customer and subscription ids.
- Sign-up starts a **14-day trial** without a card. Checkout and plan changes use the provider's hosted pages
  (no card data ever touches our servers). Status changes arrive by **signed webhooks**.
- When a subscription is not active: the company can still sign in, view and export existing projects, but cannot
  create or edit (read-only). Data is never deleted because of billing.
- Admin-only "Billing" page shows plan, status, next payment, link to the provider's portal.

**Needs your input:** which payment provider (Stripe is the plan, but it is not available in every country, e.g.
Paddle or Lemon Squeezy act as merchant of record and handle VAT for you), plan names and prices, monthly/yearly,
and whether seats are per user.

---

## 8. Data changes (migration `reporting`)

- New tables `Material`, `MaterialRule`.
- `Organization.settings` (JSON, validated by a shared Zod schema), `Project.costSettings` (JSON),
  `Floor.ceilingHeightMm` (Int, default 2600) and `Floor.cableRouting` ("ceiling" | "floor", default "ceiling").
- Billing columns on `Organization` arrive in 5B's own migration.
- Saved quote versions (a frozen copy of BOM + prices) are *not* stored now; the exported PDF serves as the record.
  They can be added later without changing the above.

---

## 9. Testing

- Shared unit tests: allowance calculation, rule matching (exact cable key before wildcard), money rounding,
  pack rounding, VAT/markup totals, uncalibrated floor handling.
- API e2e: price list CRUD and CSV import, organization isolation (second test company cannot see prices),
  export endpoint returns a valid PDF with the expected page count.
- PDF check: generated file opened with pdf.js in tests (text of title block, legend entries present; plan page
  embedded as a vector XObject, not an image).
- Browser test on the demo project: price list → rules → BOM numbers → PDF download.

## 10. Order of work (5A)

1. Shared: settings schemas, BOM + allowance + cost calculations with tests.
2. API: migration, price list / rules / settings endpoints, CSV import.
3. Web: settings pages, Materials & costs tab.
4. API: PDF export (plan embedding, symbols, wires, title block), then schedule/BOM/cost pages.
5. Web: export dialog. Phase 5A report.

---

## 11. 5A implementation notes (differences from the proposal)

- **Where things live:** shared calculations in `packages/shared/src/reports/` (settings, price list + rules + CSV,
  take-off / BOM / costs, export options); API modules `pricing/` (settings, materials, rules, CSV) and `exports/`
  (PDF); web pages `features/settings/` and the *Materials & costs* tab + *Export PDF* dialog in `features/installation/`.
- **Project cost overrides** are stored in the existing `Project.settings` JSON (key `costSettings`), next to the
  electrical profile, instead of a new `Project.costSettings` column.
- **Money:** stored as `Decimal` in the database, sent to the browser as numbers (≤ 4 decimals). Every line total and
  sum is rounded to cents in shared code, so the screen and the PDF always show identical amounts.
- **Rule matching:** for a cable, only the rules of the *most specific* matching target apply (`NYM-J|3|1.5` beats
  `NYM-J|*|*`). A material needed by every cable (e.g. conduit) must therefore also be added to the specific targets.
- **Annotations** (notes, markers) are never counted as material.
- **Font:** DejaVu Sans (open licence, npm `dejavu-fonts-ttf`) instead of Noto Sans; it covers the same characters
  needed here and ships as plain TTF files. Fonts are subset, so a typical export is 20–60 kB plus the plan pages.
- **Plan embedding:** the plan page's crop box is embedded with `pdf-lib` `embedPage` as a form XObject; the page's own
  `/Rotate` and the editor's view rotation are both applied. A plan that cannot be read (damaged/protected) prints a
  note on the sheet and the export still succeeds.
- **Scale:** on A4–A1, calibrated floors print at the next standard scale that fits (1:50, 1:100, 1:125 …) with a
  scale bar; "same size as the plan" keeps the original scale. Floors without a plan print at natural size.
- **Not done:** layers as PDF optional-content groups (toggleable in Acrobat) were left out, as allowed in §5; hidden
  layers are simply not drawn. No company logo upload limit beyond 300 kB, no quote versions (§8).
- **Tests:** API e2e timeout raised to 20 s because the embedded `prisma dev` database sometimes stalls for 5–8 s.
