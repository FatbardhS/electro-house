# Electro House — Architecture Proposal

Status: **approved; Phase 1 implemented** (2026-11-05). Where the implementation differs from the original proposal, see §9.

Product: a 2D electrical installation planner for professional electricians, sold as a subscription (SaaS).
Components and wires are placed and drawn by hand. The app automates measurements, quantities, cable lengths and reports.
AI-generated designs are not part of the MVP.

---

## 1. Repository inspection

- The repository has no commits.
- The only content is an uncommitted Next.js scaffold created earlier in this session, before the stack changed. It contains no project code.
- That scaffold was removed and replaced with the monorepo described below.

---

## 2. Application architecture

### Stack

| Concern | Choice | Notes |
|---|---|---|
| Frontend | **Angular 22** (standalone components, Signals, zoneless) | A single-page app: the editor is a long-lived client-side workspace, so server rendering adds nothing |
| Drawing | **SVG** overlay | Components are vector symbols, and SVG gives crisp output at any zoom, DOM hit-testing and straightforward vector PDF export. One floor has hundreds of objects, well within SVG's comfortable range. |
| PDF rendering | **PDF.js** (`pdfjs-dist`) in its Web Worker | Renders onto a `<canvas>` *underneath* the SVG |
| Backend | **NestJS 12**, REST | Modules match the domain areas |
| Database | **PostgreSQL 17** | |
| ORM | **Prisma 7** (stable) | npm `latest` currently points at a v8 release candidate, so we pin `^7` |
| File storage | **S3-compatible** (MinIO locally; Cloudflare R2 or AWS S3 in production) | Only original PDFs are stored; drawings are never stored as images |
| Validation | **Zod** schemas in a shared package | The **same** schema validates in the browser and in the API (via a ~20-line Nest pipe), so the two sides cannot drift |
| Tests | **Vitest** | Angular 22's default runner, also used for the shared geometry package and the API |
| Auth | Email + password, argon2 hashing, server sessions in an httpOnly cookie | No third-party auth service; it can be swapped later |
| Billing (later) | Stripe Billing | Fits the `Organization` model below; not in Phase 1 |

### Monorepo layout (npm workspaces, no Nx)

```
electro-house/
├─ apps/
│  ├─ web/                     Angular app
│  │  └─ src/app/
│  │     ├─ core/              auth, HTTP interceptors, error handling, API client
│  │     ├─ shared/ui/         buttons, dialogs, empty/loading/error states
│  │     └─ features/
│  │        ├─ auth/           sign in / sign up
│  │        ├─ clients/        client list + client detail
│  │        ├─ projects/       project create/edit, floor management
│  │        └─ editor/         the workspace (see §3)
│  │           ├─ pdf/         PDF.js background renderer (knows nothing about electrics)
│  │           ├─ drawing/     SVG layers, symbols, selection (knows nothing about PDF.js)
│  │           ├─ viewport/    pan/zoom/rotate transform shared by both
│  │           ├─ tools/       pan, select, calibrate, place, wire …
│  │           └─ state/       floor document store (Signals), save queue
│  └─ api/                     NestJS app
│     ├─ src/modules/  auth, organizations, clients, projects, floors, files, drawing
│     └─ prisma/schema.prisma
├─ packages/
│  └─ shared/                  framework-free TypeScript, used by web AND api
│     ├─ geometry/             Vec2, transforms, distances, polyline length
│     ├─ calibration/          scale calculation
│     ├─ domain/               Component / Wire / Connection types
│     └─ schemas/              Zod schemas + DTO types for every endpoint
├─ docker-compose.yml          PostgreSQL + MinIO for local development
└─ docs/
```

`packages/shared` is where the critical maths lives (coordinate transforms, calibration, lengths). It has no Angular or Nest dependency, so it is simple to unit-test.

### Multi-tenancy (built in from day 1)

Every business row belongs to an `Organization` (the electrician's company, which will be the paying customer).
Every API query is scoped by the `organizationId` from the session, and the backend checks it, never the client.
This enables team seats, Stripe billing and sharing later without a migration of existing data.

---

## 3. SVG + PDF.js integration

The editor is a stack of absolutely positioned layers inside one viewport element:

```
<div class="viewport">            ← receives pointer/wheel events, owns the view transform
  <canvas class="pdf-layer">      ← PDF.js raster. Pure background. No electrical knowledge.
  <svg class="drawing-layer">     ← all electrical objects, in plan coordinates
    <g [attr.transform]="viewMatrix">
      <g layer="wiring">…</g>
      <g layer="lighting">…</g>
      … one <g> per layer (visible/locked flags) …
      <g layer="annotations">…</g>
    </g>
    <g class="overlay">           ← tool previews, selection boxes, calibration line (screen space)
  </svg>
</div>
```

**Separation rule:** `pdf/` receives only *which page* and *which view transform*, and produces pixels. `drawing/` receives only the floor document and the view transform, and produces SVG. Neither imports the other. The `viewport/` service is the single source of the transform both of them read.

### Keeping large PDFs usable

- PDF.js parses and renders in its Web Worker, so the UI thread stays free.
- While zooming or panning, the existing bitmap is moved and scaled with a CSS transform: instant, slightly blurry.
- About 150 ms after the gesture stops, the page is re-rendered at the new resolution for the **visible area only**. The canvas is capped at about 16 megapixels, so a 1:50 A0 plan at 800% zoom does not allocate gigabytes.
- Any render still in progress is cancelled (`renderTask.cancel()`) when a new one starts.
- The PDF is loaded from a short-lived presigned S3 URL with HTTP range requests, so PDF.js streams only the parts it needs.

### Why not draw the PDF inside the SVG?

An `<image>` inside the SVG would make export and hit-testing harder and would tie re-rendering of the PDF to every SVG change. Keeping them as siblings that share one transform is simpler and faster.

---

## 4. Database schema (Prisma)

```prisma
// ── Accounts & tenancy ────────────────────────────────────────
model Organization {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  createdAt DateTime @default(now())
  members   Membership[]
  clients   Client[]
  projects  Project[]
  files     StoredFile[]
  // Stripe customer/subscription fields added in the billing phase
}

model User {
  id           String   @id @default(uuid()) @db.Uuid
  email        String   @unique
  name         String
  passwordHash String
  createdAt    DateTime @default(now())
  memberships  Membership[]
  sessions     Session[]
}

model Membership {
  organizationId String @db.Uuid
  userId         String @db.Uuid
  role           MemberRole @default(OWNER)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([organizationId, userId])
}
enum MemberRole { OWNER ADMIN MEMBER }

model Session {
  id        String   @id                // random 256-bit token, stored hashed
  userId    String   @db.Uuid
  expiresAt DateTime
  user      User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// ── Clients & projects ────────────────────────────────────────
model Client {
  id             String  @id @default(uuid()) @db.Uuid
  organizationId String  @db.Uuid
  name           String                 // person or company name; the primary way projects are found
  email          String?
  phone          String?
  address        String?
  notes          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  projects       Project[]
  @@index([organizationId, name])
}

model Project {
  id              String        @id @default(uuid()) @db.Uuid
  organizationId  String        @db.Uuid
  clientId        String        @db.Uuid
  name            String
  propertyAddress String?
  description     String?
  status          ProjectStatus @default(PLANNING)
  settings        Json          @default("{}")   // validated by Zod: units, default voltage, standard profile …
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  organization    Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  client          Client        @relation(fields: [clientId], references: [id], onDelete: Restrict)
  floors          Floor[]
  @@index([organizationId, clientId])
}
enum ProjectStatus { PLANNING IN_PROGRESS COMPLETED }

// ── Floors & plans ────────────────────────────────────────────
model Floor {
  id           String   @id @default(uuid()) @db.Uuid
  projectId    String   @db.Uuid
  name         String                  // "Basement", "Ground floor", or any custom name
  sortOrder    Int                     // basement = -1, ground = 0, first = 1 … (drives the floor selector)
  planFileId   String?  @db.Uuid       // null = no PDF uploaded yet
  planPage     Int      @default(1)    // which page of the PDF is this floor's plan
  planRotation Int      @default(0)    // 0 | 90 | 180 | 270, a VIEW setting, never applied to stored coordinates
  calibration  Json?                   // see §6; null = not calibrated
  backgroundLocked Boolean @default(true)
  revision     Int      @default(0)    // incremented on every saved drawing change (optimistic concurrency)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  project      Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  planFile     StoredFile? @relation(fields: [planFileId], references: [id], onDelete: SetNull)
  layers       Layer[]
  components   Component[]
  wires        Wire[]
  @@index([projectId, sortOrder])
}

model StoredFile {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String   @db.Uuid
  storageKey     String   @unique         // S3 object key
  originalName   String
  mimeType       String                   // only application/pdf for now; checked by magic bytes, not just extension
  sizeBytes      Int
  pageCount      Int
  sha256         String
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  floors         Floor[]
}

// ── Drawing (Phase 2–3; schema defined now so Phase 1 does not need rework) ──
model Layer {
  id        String  @id @default(uuid()) @db.Uuid
  floorId   String  @db.Uuid
  key       String                       // "wiring" | "lighting" | "outlets" | "switches" | "data" | "smart" | "boards" | "annotations" | custom
  name      String
  visible   Boolean @default(true)
  locked    Boolean @default(false)
  sortOrder Int
  floor     Floor @relation(fields: [floorId], references: [id], onDelete: Cascade)
  @@unique([floorId, key])
}

model Component {
  id          String  @id @db.Uuid            // generated on the client (UUID v7) so undo/redo and offline edits are stable
  floorId     String  @db.Uuid
  layerKey    String
  typeKey     String                          // e.g. "outlet.double", resolved in the component catalog
  label       String?                         // e.g. "S1", "L-03"
  x           Float                           // plan coordinates (§6)
  y           Float
  rotation    Float   @default(0)             // degrees
  mountHeightMm Int?
  properties  Json    @default("{}")          // validated by the type's Zod schema
  circuitId   String? @db.Uuid                // Phase 4
  floor       Floor @relation(fields: [floorId], references: [id], onDelete: Cascade)
  @@index([floorId])
}

model Wire {
  id          String @id @db.Uuid
  floorId     String @db.Uuid
  points      Json                            // [{x,y}, …] interior vertices in plan coordinates
  fromComponentId String? @db.Uuid           // the connection, as data
  fromPortId      String?                     // connection point id on the component type
  toComponentId   String? @db.Uuid
  toPortId        String?
  cableTypeKey    String?
  conductors      Int?
  crossSectionMm2 Float?
  circuitId       String? @db.Uuid
  properties  Json   @default("{}")
  floor       Floor @relation(fields: [floorId], references: [id], onDelete: Cascade)
  @@index([floorId])
  @@index([fromComponentId])
  @@index([toComponentId])
}

// Circuits, DistributionBoards, VerticalLinks (between floors), MaterialPrices, CustomComponentTypes
// are designed in Phase 4/5 against this same structure.
```

Why components and wires are **rows**, not one JSON blob per floor:
- Reports (counts, cable totals, circuit loads) become plain SQL.
- Two electricians can later edit different objects without overwriting each other.
- Connections can be checked by the database (`fromComponentId` points at a real component).

---

## 5. Component and connection data structures (`packages/shared/domain`)

```ts
type Vec2 = { x: number; y: number };   // always plan coordinates (§6)

/** Catalog entry, defined in code. New products are added here without touching the editor. */
interface ComponentType {
  key: string;                   // "switch.two-way"
  category: 'lighting' | 'outlet' | 'switch' | 'distribution' | 'communication'
          | 'smart' | 'renewable' | 'annotation';
  name: string;
  defaultLayer: LayerKey;
  symbol: SymbolDef;             // SVG paths following IEC 60617-style conventions, drawn around (0,0)
  size: Vec2;                    // nominal symbol size in plan units at 1:1
  ports: PortDef[];              // connection points, in the symbol's local coordinates
  propertiesSchema: ZodSchema;   // validates Component.properties for this type
}

interface PortDef { id: string; offset: Vec2; kind: 'power' | 'control' | 'data' | 'any' }

/** One placed component instance. */
interface Component {
  id: string;                    // UUID v7
  floorId: string;
  typeKey: string;
  layerKey: LayerKey;
  label?: string;
  position: Vec2;                // plan coordinates; zoom/pan/rotate NEVER change this
  rotation: number;              // degrees, component's own rotation
  mountHeightMm?: number;
  properties: Record<string, unknown>;
  circuitId?: string;
}

/** A cable route. Geometry and connectivity are both explicit data. */
interface Wire {
  id: string;
  floorId: string;
  from: WireEnd;
  to: WireEnd;
  points: Vec2[];                // interior bend points only
  cable: { typeKey?: string; conductors?: number; crossSectionMm2?: number };
  circuitId?: string;
  properties: Record<string, unknown>;
}

type WireEnd =
  | { kind: 'port'; componentId: string; portId: string }  // attached: position is DERIVED from the component
  | { kind: 'free'; point: Vec2 };                         // not yet connected
```

Key rules:
- **A wire end attached to a port stores no coordinates.** Its position is computed from the component's position, rotation and the port offset. When a component moves, its wires follow automatically and lengths are recalculated; they cannot go out of sync.
- **Branching** goes through a component: a junction box, or a small "junction point" type with several ports. Every T-split is therefore a real, countable object, which is also how electricians document it.
- **Wire length** = sum of segment lengths through `[startPort, …points, endPort]` × `metresPerUnit` from calibration. It is computed, not stored. Reports later add explicit, configurable allowances (vertical drops to mount height, board tails, waste %) shown **separately** from the measured length.
- **Undo/redo (Phase 2):** every edit is a command with `apply` and `invert` on the floor document. One floor = one history stack, so floors have independent drawing states.

---

## 6. Coordinate transformations and scale calibration

### Coordinate spaces

| Space | Unit | Who uses it |
|---|---|---|
| **Plan space** | PDF points (1/72 inch) of the *unrotated* PDF page, origin at its top-left | **All stored data.** Components, wires, calibration points |
| **Screen space** | CSS pixels inside the viewport | Pointer events, overlays |

There is exactly one transform between them, kept in the `viewport` service:

```
screen = T(pan) · S(zoom) · R(planRotation, around page centre) · plan
plan   = inverse of the above
```

- Zoom, pan and plan rotation change **only this matrix**. Stored coordinates never change.
- Rotating the plan rotates the PDF *and* the drawing together, so nothing drifts.
- The PDF canvas is rendered with the same matrix (PDF.js `viewport` with scale × devicePixelRatio and the same rotation), so the background and SVG are aligned by construction.
- Wheel zoom keeps the point under the cursor fixed: `pan' = cursor − (cursor − pan) · (zoom'/zoom)`.
- Using PDF points as plan units means coordinates do not depend on render resolution, screen DPI or zoom.

Tests will cover: `toPlan(toScreen(p)) ≈ p` for all rotations and zooms; zoom-at-cursor keeps the cursor point fixed; fit-to-screen for every rotation.

### Scale calibration

```ts
interface Calibration {
  method: 'two-point' | 'paper-scale';
  p1?: Vec2; p2?: Vec2;          // plan coordinates of the picked points (two-point)
  realDistanceMm?: number;       // entered by the user
  paperScale?: number;           // e.g. 50 for 1:50 (paper-scale)
  metresPerUnit: number;         // the derived result used by all measurements
  calibratedAt: string;
}
```

1. **Two-point** (works for any plan, including scans): the user clicks two points on a known dimension, e.g. a wall marked 4.00 m, and enters the distance.
   `metresPerUnit = realDistance / |p2 − p1|`.
   Points snap to the cursor with a magnifier, and the user is warned if the two points are less than 50 screen px apart, because short references give poor accuracy.
2. **Paper scale** (precise for vector PDFs exported from CAD): 1 PDF point = 0.3528 mm on paper, so at 1:50, `metresPerUnit = 0.0003528 × 50`.
   The app lets the user verify this by measuring a known dimension after choosing it.

- Calibration is stored per floor. Recalibrating updates every length immediately, because lengths are derived.
- A floor without calibration shows lengths as "not calibrated", never a guessed value.
- **Measure tool** (Phase 1): click two or more points to see the distance in metres. This is how the user checks the calibration.
- **Replacing a floor's PDF** keeps components and wires, but marks calibration as *needs checking* and asks the user to confirm, because the new file may differ in scale or offset. A two-point alignment tool for moved plans is listed for Phase 2.

---

## 7. Saving and recovery

1. Every change goes to the in-memory floor store (Signals) and is written immediately to an **IndexedDB journal**, so a crash or refresh loses nothing.
2. A save queue sends batched operations to `PATCH /floors/:id/drawing` with `baseRevision`, at most once every 1–2 s.
3. The server applies the batch in one transaction and increments `Floor.revision`.
   If the revision does not match (edited elsewhere), it returns `409` and the client reloads and re-applies. This is the foundation for multi-user editing later.
4. When a floor is opened, any unsent journal entries are replayed first.
5. The top bar shows the save state: *Saved* / *Saving…* / *Offline: changes kept locally* / *Error* with details.

Phase 1 uses this path for floor settings (calibration, rotation, page, lock). Phase 2 adds components.

---

## 8. Phased implementation plan

Each phase ends with: what was built, files changed, how to test it, what is incomplete, and a passing build. The next phase does not start until the current one works.

### Phase 1 — Foundation
1. Monorepo: npm workspaces, `docker-compose.yml` (PostgreSQL + MinIO), environment validation at API start-up.
2. API: Prisma schema + migrations (§4), auth (sign up / sign in / sign out, organization created on sign-up), Zod validation pipe, consistent error format.
3. Clients: list (searchable by name), create, edit, delete (blocked while the client still has projects).
4. Projects: create under a client, edit, status, delete; project overview page.
5. Floors: add (preset names or custom), rename, reorder, delete with confirmation; upload or replace a PDF (validation: PDF magic bytes, ≤ 100 MB, page count read on the server).
6. Editor workspace: PDF background, wheel zoom at cursor, pan (middle mouse / space+drag / pan tool), fit to screen, rotate 90°, page selector, fullscreen, grid toggle, background lock, floor switcher.
7. Scale calibration (two-point and paper scale) and a measure tool.
8. Autosave of floor settings with the journal and save status (§7).
9. Loading, empty and error states on every page.
10. Tests: coordinate transforms, zoom-at-cursor, fit-to-screen, calibration maths, polyline length, API input validation, org scoping (a user cannot read another organization's client).

**Not in Phase 1:** placing components, wiring, undo/redo of drawing edits, billing.

### Phase 2 — Electrical editor
Component catalog with symbols, drag-and-drop placement, selection and multi-select, move/rotate/delete/copy/paste/duplicate, properties panel, layers (show/hide/lock), undo/redo, grid snapping, copy components to another floor.

### Phase 3 — Wiring engine
Wire tool with orthogonal segments, port snapping, vertex editing, cable properties and colours/line styles, live length calculation, branching through junctions, disconnect/delete.

### Phase 4 — Electrical management
Circuits, distribution boards and board schedule, vertical links between floors, connected-load and quantity calculations, with rules tied to a selectable, clearly labelled standards profile and no compliance claims.

### Phase 5 — Reporting and billing
Material price list, bill of materials with measured vs estimated quantities, cost report, vector PDF exports (per floor, full project, legend, schedules, selectable layers), Stripe subscriptions.

### Phase 6 — Advanced
Validation checks (disconnected components, overloaded circuits), collaboration, DXF import/export, AI plan recognition.

---

## 9. Phase 1 implementation notes (differences from the proposal)

- **Session table:** stores `tokenHash` (SHA-256 of the cookie token) plus `organizationId`, so the active company is part of the session.
- **`Floor.backgroundLocked` defaults to `false`.** A new floor must be free to choose its page and get its first calibration. The lock protects the page selection and an *existing* calibration; an uncalibrated floor can always be calibrated.
- **`Floor.calibrationNeedsCheck`** is set when the PDF is replaced or the plan page changes on a calibrated floor. The editor asks the user to confirm or recalibrate.
- **Layer, Component and Wire tables are not created yet.** They arrive with Phase 2–3 migrations, together with the code that uses them; the schema in §4 is the plan for them.
- **Storage driver:** `STORAGE_DRIVER=s3` (MinIO / R2 / S3, presigned read URLs) or `local` (files on disk served by the API with HTTP Range support). `local` is for development only and is refused when `NODE_ENV=production`.
- **Local database without Docker:** `prisma dev` (Prisma's embedded Postgres) works; always use a dedicated `electro` database, never `template1`.
- **Rate limiting:** sign-in 10/min, sign-up 5/min, everything else 600/min per client (disabled only under the test runner).
- **CSRF:** SameSite=Lax session cookie + state-changing requests must come from `WEB_ORIGIN`.
- **Undo/redo** is not in Phase 1: there are no drawing edits yet. It arrives with the Phase 2 command history.
