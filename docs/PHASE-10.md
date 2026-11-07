# Phase 10 — Guided editor for non-technical users

The plan editor now opens in **Guided** mode. **All tools** (top right) brings back the full editor from before;
the choice is remembered per browser (`localStorage eh.editorMode`).

## 10A — Steps, hints, tiles, progress

- **Step bar** under the toolbar: 1 Plan and scale → 2 Lights → 3 Outlets and switches → 4 Wires → 5 Check and print.
  Done steps turn green. On each floor the editor opens the first step that is not done yet.
- **Left panel** per step (`guide/guide-panel.ts`): one-sentence explanation, the most used items as big tiles,
  a practical tip, and "More items" (the library filtered to the step's categories).
  Step 1 has "Set the scale"; step 4 has "Connect items with a wire" and "Show the items without a wire";
  step 5 shows the checks and "Open materials and print".
- **Hint card** on the plan (`guide/hint-card.ts`): one sentence saying what the next click does, with a Done button.
  It replaces the old hint bar and the "not calibrated" banner in guided mode.
- **Undo, zoom and "Whole plan"** as large buttons on the plan.
- **Right panel** with nothing selected (`guide/progress-panel.ts`): progress per step with counts,
  the checks relevant to the current step ("Worth a look", click to zoom to it) and a "Next" button.
  Floor details are folded under "Plan details". The shortcut list is hidden.
- Rail labels are plainer (Pick, Connect, Move view); Scale, Snap and Lock are hidden (the scale is in step 1).
- Wire panel: cable details are folded under a one-line summary (`Cable: NYM-J 3×1.5 mm² · change`).
- Steps and progress rules: `state/guide.store.ts` (`GUIDE_STEPS`), `state/guide-progress.ts`.
  Progress uses simple counts only (no per-room targets): lights done = at least one light; outlets done =
  at least one outlet and, if there are lights, at least one switch; wires done = every item has a wire;
  check done = all of these and no errors.

## 10B — Easier placing and wiring (guided mode only)

- **Sticks to walls**: outlets, switches, data/TV/phone outlets and wall lights snap to the nearest wall face within
  ~0.8 m on screen and turn to face it (`drawing/wall-snap.ts`). Walls are found in the rendered PDF bitmap:
  a dark band at least 3 px thick that continues sideways, so text, dimension lines, windows and door openings are
  skipped. Alt places freely. The ghost preview shows the final position and rotation.
  Limitation: walls drawn only as two thin outlines (not filled) are not detected; the item then uses the grid.
- **Connect and continue**: in the wire tool, click item A then item B — the wire is drawn with a right-angle bend
  and the tool continues from B, so a chain of outlets is a row of clicks. Esc or Done stops; an unfinished wire is
  dropped. The start item and the item under the pointer get a ring.
- **Cable sizes**: while no cable was chosen yet, new wires get 3×2.5 mm² when an outlet is connected,
  5×2.5 mm² for three-phase/CEE/EV, otherwise 3×1.5 mm² (`drawing/cable-suggest.ts`).

## 10C — Tour and touch

- **Tour** (`guide/tour.ts`): five bubbles on first visit (`localStorage eh.editorTour`), reopened with Help.
- **Touch** (`workspace.ts`): a tap acts with the current tool, a one-finger drag pans, two fingers pinch-zoom
  and pan; bigger pick tolerance and wall reach for fingers.
- **Tablet widths** (≤ 900 px) in guided mode keep both side panels and a one-line toolbar.

## Fix

- The editor's live checks now use this floor's live scale, so "Floor scale" disappears as soon as the scale is
  set (before, it stayed until the page was reloaded).

## Tests

- `wall-snap.spec.ts`, `cable-suggest.spec.ts`, `guide-progress.spec.ts` (web: 37 tests pass), `ng build` passes.
- Checked in the browser on a local test project: tour, scale step, placing lights, wall snapping and rotation,
  connect-and-continue with automatic 2.5 mm² cables, touch tap / drag / pinch, mode switch, tablet layout.
  Not tested on a real touch device.
