import { describe, expect, it } from 'vitest';
import { findWall, rotationTowards, wallOffsetMm } from './wall-snap';

/** A horizontal wall from y=50 to y=57 (8 px thick), x 0..200, plus a thin 1 px line at x=20. */
const plan = (x: number, y: number) => (y >= 50 && y <= 57 && x >= 0 && x <= 200) || (x === 20 && y >= 0 && y <= 200);

describe('findWall', () => {
  it('finds the face of a thick wall below the point', () => {
    const hit = findWall(plan, { x: 100, y: 30 }, 40);
    expect(hit).not.toBeNull();
    expect(hit!.toWall).toEqual({ x: 0, y: 1 });
    expect(hit!.face).toEqual({ x: 100, y: 49 });
    expect(hit!.thickness).toBe(8);
  });

  it('finds the wall above when the point is under it', () => {
    const hit = findWall(plan, { x: 100, y: 70 }, 40);
    expect(hit!.toWall).toEqual({ x: 0, y: -1 });
    expect(hit!.face).toEqual({ x: 100, y: 58 });
  });

  it('ignores thin lines', () => {
    expect(findWall(plan, { x: 26, y: 150 }, 20)).toBeNull();
  });

  it('returns null when nothing is in reach', () => {
    expect(findWall(plan, { x: 100, y: 0 }, 20)).toBeNull();
  });

  it('moves out of a wall to its nearest face', () => {
    const hit = findWall(plan, { x: 100, y: 52 }, 40);
    expect(hit!.face).toEqual({ x: 100, y: 49 });
    expect(hit!.toWall).toEqual({ x: 0, y: 1 });
  });
});

describe('rotationTowards', () => {
  it('maps the symbol +y side to the wall', () => {
    expect(rotationTowards({ x: 0, y: 1 })).toBe(0);
    expect(rotationTowards({ x: 0, y: -1 })).toBe(180);
    expect(rotationTowards({ x: 1, y: 0 })).toBe(270);
    expect(rotationTowards({ x: -1, y: 0 })).toBe(90);
  });
});

describe('wallOffsetMm', () => {
  it('knows wall-mounted types', () => {
    expect(wallOffsetMm('outlet.double')).toBe(2.5);
    expect(wallOffsetMm('switch.single')).toBe(1.6);
    expect(wallOffsetMm('light.ceiling')).toBeNull();
  });
});
