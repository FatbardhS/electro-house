import type { Vec2 } from '@electro/shared';

/** Reads whether the plan is dark (a drawn line or wall) at a screen pixel. Outside the plan: false. */
export type DarkAt = (x: number, y: number) => boolean;

export interface WallHit {
  /** Screen point on the wall face, nearest to the cursor. */
  face: Vec2;
  /** Unit screen direction from the cursor side towards the wall. */
  toWall: Vec2;
  /** Wall thickness found (screen px). */
  thickness: number;
}

const DIRS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * Finds the nearest wall around a screen point by looking at the rendered plan.
 * A wall is a dark band at least `minThickness` px thick that also continues sideways
 * (so text and thin dimension lines are ignored). Searches left, right, up and down
 * up to `maxDistance` px. If the point is inside a wall, the nearest face is used.
 */
export function findWall(dark: DarkAt, p: Vec2, maxDistance: number, minThickness = 3): WallHit | null {
  const x0 = Math.round(p.x);
  const y0 = Math.round(p.y);
  const maxThick = Math.max(minThickness * 12, 40);

  if (dark(x0, y0)) {
    // Inside a wall: leave it the shortest way; the wall is behind us.
    let best: WallHit | null = null;
    for (const d of DIRS) {
      let e = 1;
      while (e <= maxThick && dark(x0 + d.x * e, y0 + d.y * e)) e++;
      if (e > maxThick) continue;
      let back = 1;
      while (back <= maxThick && dark(x0 - d.x * back, y0 - d.y * back)) back++;
      const thickness = e + back - 1;
      if (thickness < minThickness) continue;
      if (!best || e < Math.hypot(best.face.x - x0, best.face.y - y0)) {
        best = { face: { x: x0 + d.x * e, y: y0 + d.y * e }, toWall: { x: -d.x || 0, y: -d.y || 0 }, thickness };
      }
    }
    return best;
  }

  let best: { hit: WallHit; dist: number } | null = null;
  for (const d of DIRS) {
    let dist = 1;
    while (dist <= maxDistance && !dark(x0 + d.x * dist, y0 + d.y * dist)) dist++;
    if (dist > maxDistance) continue;
    if (best && dist >= best.dist) continue;
    let thickness = 0;
    while (thickness < maxThick && dark(x0 + d.x * (dist + thickness), y0 + d.y * (dist + thickness))) thickness++;
    if (thickness < minThickness) continue;
    // The band must run sideways too: sample a few pixels along the wall at its middle.
    const mid = dist + Math.floor(thickness / 2);
    const side = { x: d.y, y: d.x };
    const reach = Math.max(4, thickness);
    let along = 0;
    for (const s of [-reach, -reach / 2, reach / 2, reach]) {
      const sx = Math.round(x0 + d.x * mid + side.x * s);
      const sy = Math.round(y0 + d.y * mid + side.y * s);
      if (dark(sx, sy)) along++;
    }
    if (along < 3) continue;
    best = { dist, hit: { face: { x: x0 + d.x * (dist - 1), y: y0 + d.y * (dist - 1) }, toWall: d, thickness } };
  }
  return best?.hit ?? null;
}

/**
 * Component rotation (degrees, as stored) that turns the symbol's local +y axis — the side that
 * touches the wall for outlets and switches — towards `towardsWall` (a plan-space direction).
 */
export function rotationTowards(towardsWall: Vec2): number {
  const a = (Math.atan2(-towardsWall.x, towardsWall.y) * 180) / Math.PI;
  const snapped = Math.round(a / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

/** Distance (paper mm) from the insertion point to the wall face, per wall-mounted type; null = not wall-mounted. */
export function wallOffsetMm(typeKey: string): number | null {
  if (typeKey.startsWith('outlet.')) return 2.5;
  if (typeKey === 'comm.rj45' || typeKey === 'comm.phone' || typeKey === 'comm.tv') return 2.5;
  if (typeKey.startsWith('switch.')) return 1.6;
  if (typeKey === 'light.wall') return 3.4;
  return null;
}
