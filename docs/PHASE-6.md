# Phase 6: Validation checks (and optional DXF export)

Status: **6A and 6B implemented** (2026-11-06). Builds on Phases 1–5. Implementation notes in §10.

Goal: before an electrician prints or sends a plan, the app points out what is missing, inconsistent or above the
limits they set, and takes them straight to the problem on the plan.

Phase 6 has two parts that are approved separately:

- **6A: Validation checks** — the main deliverable.
- **6B: DXF export** — optional, for electricians whose architects or engineers work in CAD.

Collaboration (several people editing at once) and AI recognition of walls and rooms are **not** part of this phase:
both are large projects of their own and are listed under "Later" in §6.

---

## 1. Checks (6A)

All checks run in shared code (`packages/shared/src/validation/`) on the data the app already has
(`InstallationDto`, price list, rules), so the editor, the project page and the PDF show the same results.
Each issue has a **severity**, a short message, and what it points at (floor, components, wires, circuit, board).

| # | Check | Severity | Notes |
|---|---|---|---|
| **Drawing** ||||
| D1 | Component with no wire connected | warning | Skips annotations; data/smart devices are *info* (they may be wireless or on a bus) |
| D2 | Wire with a free (unconnected) end | warning | |
| D3 | Two components at (almost) the same spot | warning | Usually an accidental double paste |
| D4 | Same label used twice in the project (e.g. two "L3") | warning | |
| D5 | Floor not calibrated, or calibration marked "check" after a plan change | error / warning | Lengths and the BOM depend on it |
| **Circuits** ||||
| C1 | Component not assigned to a circuit | warning | Skips annotations, boards and data/communication devices |
| C2 | Wire not assigned to a circuit | info | |
| C3 | Wire assigned to a different circuit than both components it connects | warning | |
| C4 | Wire cable smaller than the circuit's cross-section, or a different cable type | warning | |
| C5 | Circuit with no board / no components | warning | already computed in Phase 4, moved here |
| C6 | Estimated current above the breaker rating | error | Phase 4 |
| C7 | Breaker above the limit for the cross-section in the rules profile | error | Phase 4, only if the profile has the limit |
| C8 | **Estimated voltage drop** at the farthest point above the profile limit | warning | see §2 |
| C9 | Circuit category that the profile says needs RCD protection, without an RCD group | warning | see §2 |
| **Boards** ||||
| B1 | Phase imbalance on a board above 20 % | info | Phase 4 showed it, now listed |
| **Materials** ||||
| M1 | Item type with no material rule (not priced) | info | Phase 5 showed it, now listed |
| M2 | Material used in the BOM with price 0 | info | |

No check claims compliance with a standard. Checks C7–C9 only run with the limits the electrician entered.

## 2. New rules-profile settings

Added to the existing per-project rules profile (all optional, empty = check not performed):

- **Maximum voltage drop %** (e.g. 3). The drop is estimated along the **longest cable path from the board** to a
  component of the circuit, following the wires (and floor connections) as a graph:
  `ΔU% = 2·L·I·ρ / (S·U) · 100` single-phase, `√3·L·I·ρ / (S·U) · 100` three-phase, with copper
  ρ = 0.0225 Ω·mm²/m, I = the circuit's estimated current, S = its cross-section. Shown as an estimate.
  If the path cannot be followed (unconnected wires, uncalibrated floor) the check says so instead of guessing.
- **Circuit categories that need RCD protection** (e.g. Sockets, Bathroom, Outdoor). Picked by the electrician.

## 3. Ignoring an issue

Some warnings are intentional (a spare outlet with no wire yet). Each issue has a stable id (check + the ids it
points at); **Ignore** stores that id on the project with who ignored it and when. Ignored issues are hidden by
default, counted separately, and come back automatically if what they point at changes in a way that creates a
*new* issue (a different id). Owner, admin and members can ignore; it's undoable ("Show ignored" → "Restore").

## 4. Screens

- **Editor → new "Checks" tab** (left panel), with a count badge: issues of the current floor plus project-wide ones.
  Clicking an issue selects the components/wires and zooms to them. Issues update live while drawing.
- **Project → Circuits & calculations → new "Checks" tab**: all issues of the project grouped by severity and floor,
  with **Show on plan** (opens the editor on that floor with the items selected, via `?select=` in the URL),
  ignore / restore, and filters.
- **Project page**: a small summary ("2 errors, 5 warnings") next to the Circuits & calculations button.
- **Export PDF**: a new optional section **Checks** (open issues), and the export dialog warns if there are errors
  (export is still allowed).

## 5. DXF export (6B, optional)

- One **DXF file per floor** (ASCII DXF R12, readable by AutoCAD, BricsCAD, LibreCAD, DraftSight), or a ZIP of all floors.
- Units in metres when the floor is calibrated (true scale), otherwise in plan points with a note.
- **Layers** named like the app's layers (`EH-LIGHTING`, `EH-OUTLETS`, `EH-WIRING`…) with their colours.
- Each component type is a **block** (symbol drawn from the same primitives as the editor and PDF), inserted with its
  rotation and label as an attribute; wires are polylines with the cable text as their label.
- The architect's plan is **not** included (DXF cannot reference a PDF page reliably); the file is meant to be
  overlaid on the architect's own CAD drawing, which is usually what they ask for.
- No DXF **import** (rendering CAD files as plan backgrounds is a large feature of its own).

## 6. Later (not in Phase 6)

- Team invites and roles UI (needed for real per-seat billing) — a small phase on its own, recommended next.
- Real-time collaboration, AI recognition of walls/rooms, DXF/DWG import.

## 7. Data changes

- `Project.settings.ignoredIssues`: `{ id, ignoredBy, ignoredAt }[]` (JSON, no new table).
- Rules profile gets `maxVoltageDropPct: number | null` and `rcdRequiredCategories: string[]` (JSON, defaults empty).
- No migration needed for 6A. 6B needs none either.

## 8. Testing

- Shared unit tests per check (positive and negative cases), voltage-drop path finding (branches, floor links,
  broken paths), stable issue ids.
- API e2e: ignore / restore, isolation between companies, export with the Checks section.
- Browser: editor Checks tab click-to-select/zoom, project Checks tab, "Show on plan" deep link.
- 6B: DXF output parsed back in tests (layers, blocks, entity counts), and opened in LibreCAD if available.

## 9. Order of work

1. Shared checks + voltage-drop path finding, with tests.
2. Profile settings + ignore/restore API.
3. Project Checks tab, editor Checks tab, deep link, project summary.
4. PDF Checks section and export warning. Report 6A.
5. (If approved) DXF export. Report 6B.

---

## 10. Implementation notes (differences from the proposal)

- **Code:** checks and voltage drop in `packages/shared/src/validation/checks.ts`; ignore / restore in the installation
  API (`POST /api/projects/:id/ignored-issues` and `/restore`); DXF in `apps/api/src/exports/dxf.ts` with a small ZIP
  writer (`zip.ts`, Node's built-in deflate and CRC-32, no dependency); `GET /api/projects/:id/dxf[?floorId=]`.
- **B1 (unbalanced phases)** only runs for boards whose circuits use more than one phase; otherwise every
  single-phase house would be flagged.
- **D1 / C1:** smart-home and communication devices without a wire are *info* (they may be wireless or on a bus);
  communication devices are not expected on a power circuit.
- **Voltage drop** follows only wires and floor connections **assigned to that circuit**, and adds the vertical drops
  at each connected end. If a component cannot be reached that way, C8 says so (info) instead of estimating.
- **Ignored issues** are stored in `Project.settings.ignoredIssues` (max 500 per project), with the user's name and time.
- **PDF:** the Checks section is **off by default** (the PDF often goes to the client); the export dialog warns when
  there are errors but still exports.
- **Editor:** a Checks tab (left panel tabs are now a 2×2 grid) that updates live while drawing; clicking an issue
  selects and zooms to it; `?select=id,id` opens the editor with those items selected.
- **DXF:** R12 ASCII. Bézier parts of symbols are flattened to polylines; filled symbol areas are outlines only
  (R12 has no hatch); colours are mapped to the nearest AutoCAD colour index; non-ASCII text is written as `\U+XXXX`.
  Verified with an independent parser (`dxf-parser`) in tests — **not opened in a CAD program**, because none is
  installed on the development machine.
