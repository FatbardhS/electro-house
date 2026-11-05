# Phase 3: Wiring engine

Status: **implemented** (2026-11-06).

## What it does

- **Wire tool (W).** Click a component to start at its connection point, click on the plan to add bends,
  click another component to finish there. Double-click, Enter or right-click finishes at a free point;
  Esc cancels; Backspace removes the last bend.
- **Horizontal / vertical segments by default.** Each new segment follows the screen axis that is closest to the
  cursor; when finishing on a component an elbow is inserted automatically so the last leg is an L-shape.
  Hold **Shift** for any angle. Points snap to the grid (Alt to place freely).
- **Connections are data.** Each wire end is either a foreign key to a component (`Wire.fromComponentId` /
  `toComponentId`, plus a port id) or a free point. The position of a connected end is derived from the
  component, so moving a component moves its wire ends and updates the length.
- **Moving.** Moving one connected component keeps the wire's bends; moving both ends (or a selected wire)
  moves the whole route.
- **Editing.** Select a wire and drag its handles: round handles move bends and ends; small handles on segment
  midpoints add a bend; double-click a bend to remove it. Dropping an end on a component connects it; dragging
  it elsewhere disconnects it. The wire panel also has **Disconnect** buttons.
- **Deleting a component** keeps its wires and leaves a free end where it was (undo reconnects). The API refuses
  to delete a component that still has a wire attached unless the wire is detached in the same change.
- **Branching** is done through components with several wires, typically a junction box (`dist.junction-box`).
- **Cable properties:** label, cable type, conductors, cross-section, voltage, installation method,
  colour and line style (solid, dashed, dotted, dash-dot), description. New wires reuse the last cable chosen.
- **Length.** Measured route length from the calibrated scale is shown per wire and as a floor total.
  Installation allowances (vertical drops, board tails, waste) are added separately in Phase 5.
- Copy / paste / duplicate / copy-to-floor keep wires connected to the copied components; ends connected to
  components that were not copied become free ends.

## Data

`Wire` table: `fromComponentId`, `fromPortId`, `fromX`, `fromY`, the same for `to`, `points` (JSON array of
bend points in plan coordinates), `cable` (JSON validated by `cableSchema`), `circuitId` (used in Phase 4), label,
description. Drawing ops `upsertWire` / `deleteWire` are part of the same atomic batch as component ops.

## Not done

- Snapping routes to walls: needs wall recognition from the PDF (Phase 6 "AI floor-plan recognition").
- Automatic routing suggestions (Phase 6).
- Components currently have a single connection point at their insertion point; multiple named terminals per
  device (e.g. L/N/PE, switch legs) are not modelled.
