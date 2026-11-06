import type { Vec2 } from './vec.js';

/**
 * Minimal SVG path parser for the symbol catalog (M, L, H, V, C, A, Z, absolute or relative).
 * Output is absolute move/line/cubic/close segments, so a PDF writer can emit them directly.
 * Arcs are converted to cubic Béziers (≤ 90° each).
 */
export type PathSegment =
  | { op: 'M'; to: Vec2 }
  | { op: 'L'; to: Vec2 }
  | { op: 'C'; c1: Vec2; c2: Vec2; to: Vec2 }
  | { op: 'Z' };

const TOKEN = /([MLHVCAZmlhvcaz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g;

export function parseSvgPath(d: string): PathSegment[] {
  const tokens: (string | number)[] = [];
  for (const m of d.matchAll(TOKEN)) tokens.push(m[1] ?? Number(m[2]));
  const out: PathSegment[] = [];
  let i = 0;
  let cmd = '';
  let cur: Vec2 = { x: 0, y: 0 };
  let start: Vec2 = { x: 0, y: 0 };
  const num = (): number => {
    const t = tokens[i++];
    if (typeof t !== 'number') throw new Error(`Invalid path data: "${d}"`);
    return t;
  };
  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') cmd = tokens[i++] as string;
    else if (!cmd) throw new Error(`Invalid path data: "${d}"`);
    const rel = cmd === cmd.toLowerCase();
    const pt = (x: number, y: number): Vec2 => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    switch (cmd.toUpperCase()) {
      case 'M': {
        cur = pt(num(), num());
        start = cur;
        out.push({ op: 'M', to: cur });
        cmd = rel ? 'l' : 'L'; // following pairs are implicit line-tos
        break;
      }
      case 'L':
        cur = pt(num(), num());
        out.push({ op: 'L', to: cur });
        break;
      case 'H': {
        const x = num();
        cur = { x: rel ? cur.x + x : x, y: cur.y };
        out.push({ op: 'L', to: cur });
        break;
      }
      case 'V': {
        const y = num();
        cur = { x: cur.x, y: rel ? cur.y + y : y };
        out.push({ op: 'L', to: cur });
        break;
      }
      case 'C': {
        const c1 = pt(num(), num());
        const c2 = pt(num(), num());
        const to = pt(num(), num());
        out.push({ op: 'C', c1, c2, to });
        cur = to;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num() !== 0;
        const sweep = num() !== 0;
        const to = pt(num(), num());
        out.push(...arcToCubics(cur, to, rx, ry, rot, large, sweep));
        cur = to;
        break;
      }
      case 'Z':
        out.push({ op: 'Z' });
        cur = start;
        break;
      default:
        throw new Error(`Unsupported path command "${cmd}"`);
    }
  }
  return out;
}

/** SVG elliptical arc (endpoint form) as cubic Bézier segments. See SVG 1.1 appendix F.6. */
function arcToCubics(p0: Vec2, p1: Vec2, rxIn: number, ryIn: number, rotDeg: number, large: boolean, sweep: boolean): PathSegment[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) return [{ op: 'L', to: p1 }];
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cxp = (k * rx * y1) / ry;
  const cyp = (-k * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (p0.x + p1.x) / 2;
  const cy = sin * cxp + cos * cyp + (p0.y + p1.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let delta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const n = Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9);
  const step = delta / n;
  const t = (4 / 3) * Math.tan(step / 4);
  const point = (a: number): Vec2 => ({
    x: cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin,
    y: cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos,
  });
  const deriv = (a: number): Vec2 => ({
    x: -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin,
    y: -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos,
  });
  const segs: PathSegment[] = [];
  let a = theta1;
  for (let s = 0; s < n; s++) {
    const b = a + step;
    const pa = point(a);
    const pb = s === n - 1 ? p1 : point(b);
    const da = deriv(a);
    const db = deriv(b);
    segs.push({
      op: 'C',
      c1: { x: pa.x + t * da.x, y: pa.y + t * da.y },
      c2: { x: pb.x - t * db.x, y: pb.y - t * db.y },
      to: pb,
    });
    a = b;
  }
  return segs;
}
