import { planToScreen, wireRoute, type ComponentLookup, type Vec2, type ViewState, type WireDto } from '@electro/shared';

/** Editable points of a selected wire, in screen coordinates. */
export type WireHandle =
  | { kind: 'end'; which: 'from' | 'to'; x: number; y: number }
  | { kind: 'vertex'; index: number; x: number; y: number }
  /** Midpoint of segment `index` (between route points index and index+1): dragging inserts a bend there. */
  | { kind: 'mid'; index: number; x: number; y: number };

export const HANDLE_RADIUS_PX = 6;

export function wireHandles(w: WireDto, lookup: ComponentLookup, view: ViewState): WireHandle[] {
  const route = wireRoute(w, lookup).map((p) => planToScreen(view, p));
  const out: WireHandle[] = [];
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 4 * HANDLE_RADIUS_PX) {
      out.push({ kind: 'mid', index: i, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }
  w.points.forEach((_, i) => out.push({ kind: 'vertex', index: i, ...route[i + 1]! }));
  out.push({ kind: 'end', which: 'from', ...route[0]! });
  out.push({ kind: 'end', which: 'to', ...route[route.length - 1]! });
  return out;
}

export function handleAt(handles: readonly WireHandle[], screen: Vec2): WireHandle | null {
  // Ends and vertices win over midpoints when they overlap.
  let best: WireHandle | null = null;
  let bestD = HANDLE_RADIUS_PX + 2;
  for (const h of handles) {
    const d = Math.hypot(h.x - screen.x, h.y - screen.y) - (h.kind === 'mid' ? 1 : 0);
    if (d <= bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/** Points the next segment from `from` towards `to` along screen-horizontal or screen-vertical. */
export function orthoPoint(from: Vec2, to: Vec2, toScreen: (p: Vec2) => Vec2, toPlan: (p: Vec2) => Vec2): Vec2 {
  const a = toScreen(from);
  const b = toScreen(to);
  return toPlan(Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
}

/** Elbow that makes the last leg from `from` to `to` an L-shape on screen (horizontal first). */
export function elbow(from: Vec2, to: Vec2, toScreen: (p: Vec2) => Vec2, toPlan: (p: Vec2) => Vec2): Vec2 | null {
  const a = toScreen(from);
  const b = toScreen(to);
  if (Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5) return null;
  return toPlan({ x: b.x, y: a.y });
}
