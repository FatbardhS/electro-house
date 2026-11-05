// Generates docs/samples/sample-house-plans.pdf: a two-storey test house drawn at 1:50 on A3 landscape.
// Vector drawing (walls, doors, windows, stairs, dimensions) so calibration can be checked exactly:
// the overall house is 12.00 m × 9.00 m. Run: node scripts/make-sample-plans.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCALE = 50;
const M = (72 / 25.4) * (1000 / SCALE); // PDF points per real metre at 1:50
const W = 1190.55; // A3 landscape
const H = 841.89;
const OX = 150; // where the house's top-left corner sits on the sheet
const OY = 135;
const EXT = 0.3; // exterior wall thickness (m)
const INT = 0.12; // interior wall thickness (m)

const px = (m) => OX + m * M;
const py = (m) => H - (OY + m * M); // PDF y axis points up
const f = (n) => n.toFixed(2);

function page(build) {
  const ops = [];
  const g = {
    raw: (s) => ops.push(s),
    fillRect(x, y, w, h, gray = 0.15) {
      ops.push(`${gray} g ${f(px(x))} ${f(py(y + h))} ${f(w * M)} ${f(h * M)} re f`);
    },
    blank(x, y, w, h) {
      ops.push(`1 g ${f(px(x))} ${f(py(y + h))} ${f(w * M)} ${f(h * M)} re f`);
    },
    line(x1, y1, x2, y2, width = 0.5, gray = 0) {
      ops.push(`${gray} G ${width} w ${f(px(x1))} ${f(py(y1))} m ${f(px(x2))} ${f(py(y2))} l S`);
    },
    lineSheet(x1, y1, x2, y2, width = 0.5) {
      ops.push(`0 G ${width} w ${f(x1)} ${f(H - y1)} m ${f(x2)} ${f(H - y2)} l S`);
    },
    text(x, y, s, size = 10, sheet = false) {
      const X = sheet ? x : px(x);
      const Y = sheet ? H - y : py(y);
      ops.push(`0 g BT /F1 ${size} Tf ${f(X)} ${f(Y)} Td (${s}) Tj ET`);
    },
    // Quarter-circle door swing (Bezier approximation), centre (cx, cy), radius r, from angle a0 (deg, y down).
    arc(cx, cy, r, a0) {
      const k = 0.5523;
      const rad = (d) => (d * Math.PI) / 180;
      const p = (a) => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
      const t = (a) => [-Math.sin(rad(a)), Math.cos(rad(a))];
      const [x0, y0] = p(a0);
      const [x3, y3] = p(a0 + 90);
      const [tx0, ty0] = t(a0);
      const [tx3, ty3] = t(a0 + 90);
      const c1 = [x0 + k * r * tx0, y0 + k * r * ty0];
      const c2 = [x3 - k * r * tx3, y3 - k * r * ty3];
      ops.push(
        `0 G 0.4 w [3 2] 0 d ${f(px(x0))} ${f(py(y0))} m ${f(px(c1[0]))} ${f(py(c1[1]))} ${f(px(c2[0]))} ${f(py(c2[1]))} ${f(px(x3))} ${f(py(y3))} c S [] 0 d`,
      );
    },
  };
  build(g);
  return ops.join('\n');
}

// ── shared drawing helpers ───────────────────────────────────────────────
function exteriorWalls(g) {
  g.fillRect(0, 0, 12, EXT);
  g.fillRect(0, 9 - EXT, 12, EXT);
  g.fillRect(0, 0, EXT, 9);
  g.fillRect(12 - EXT, 0, EXT, 9);
}
const vWall = (g, x, y1, y2) => g.fillRect(x - INT / 2, y1, INT, y2 - y1, 0.25);
const hWall = (g, y, x1, x2) => g.fillRect(x1, y - INT / 2, x2 - x1, INT, 0.25);

/** Window in an exterior wall: opening + three thin lines. side: 'top'|'bottom'|'left'|'right'. */
function windowAt(g, side, from, to) {
  if (side === 'top' || side === 'bottom') {
    const y = side === 'top' ? 0 : 9 - EXT;
    g.blank(from, y, to - from, EXT);
    for (const d of [0, EXT / 2, EXT]) g.line(from, y + d, to, y + d, 0.5);
    g.line(from, y, from, y + EXT, 0.5);
    g.line(to, y, to, y + EXT, 0.5);
  } else {
    const x = side === 'left' ? 0 : 12 - EXT;
    g.blank(x, from, EXT, to - from);
    for (const d of [0, EXT / 2, EXT]) g.line(x + d, from, x + d, to, 0.5);
    g.line(x, from, x + EXT, from, 0.5);
    g.line(x, to, x + EXT, to, 0.5);
  }
}

/** Door in a wall: opening, leaf and swing. Horizontal wall at y (x from..to) or vertical wall at x (y from..to). */
function doorH(g, y, from, to, thickness, swingDown = true) {
  g.blank(from, y - thickness / 2 - 0.01, to - from, thickness + 0.02);
  const w = to - from;
  if (swingDown) {
    g.line(from, y, from, y + w, 0.6);
    g.arc(from, y, w, 0);
  } else {
    g.line(from, y, from, y - w, 0.6);
    g.arc(from, y, w, 270);
  }
}
function doorV(g, x, from, to, thickness, swingRight = true) {
  g.blank(x - thickness / 2 - 0.01, from, thickness + 0.02, to - from);
  const w = to - from;
  if (swingRight) {
    g.line(x, from, x + w, from, 0.6);
    g.arc(x, from, w, 0);
  } else {
    g.line(x, to, x - w, to, 0.6);
    g.arc(x, to, w, 180);
  }
}

function stairs(g, x1, y1, x2, y2, steps) {
  g.line(x1, y1, x2, y1, 0.5);
  g.line(x1, y2, x2, y2, 0.5);
  g.line(x1, y1, x1, y2, 0.5);
  g.line(x2, y1, x2, y2, 0.5);
  const step = (y2 - y1) / steps;
  for (let i = 1; i < steps; i++) g.line(x1, y1 + i * step, x2, y1 + i * step, 0.3);
  g.line((x1 + x2) / 2, y2 - 0.2, (x1 + x2) / 2, y1 + 0.3, 0.4);
  g.text((x1 + x2) / 2 - 0.2, y1 + 0.25, 'UP', 7);
}

function dimensions(g) {
  // overall width (top) and depth (left), plus an interior reference under the living room
  const dimH = (x1, x2, y, label) => {
    g.line(x1, y, x2, y, 0.4);
    g.line(x1, y - 0.15, x1, y + 0.15, 0.4);
    g.line(x2, y - 0.15, x2, y + 0.15, 0.4);
    g.text((x1 + x2) / 2 - 0.35, y - 0.12, label, 9);
  };
  const dimV = (y1, y2, x, label) => {
    g.line(x, y1, x, y2, 0.4);
    g.line(x - 0.15, y1, x + 0.15, y1, 0.4);
    g.line(x - 0.15, y2, x + 0.15, y2, 0.4);
    g.text(x - 1.15, (y1 + y2) / 2, label, 9);
  };
  dimH(0, 12, -0.8, '12.00 m');
  dimV(0, 9, -0.8, '9.00 m');
  dimH(0, 6, 9.8, '6.00 m');
  dimH(6, 12, 9.8, '6.00 m');
}

function sheetFrame(g, title, pageNo) {
  // border
  g.raw(`0 G 1 w 20 20 ${f(W - 40)} ${f(H - 40)} re S`);
  // title block
  const x = 880;
  const y = 560;
  g.raw(`0 G 0.8 w ${f(x)} ${f(H - y - 240)} 270 240 re S`);
  g.text(x + 12, y + 28, 'SAMPLE HOUSE', 16, true);
  g.text(x + 12, y + 52, title, 12, true);
  g.text(x + 12, y + 84, 'Scale 1:50 at A3', 10, true);
  g.text(x + 12, y + 102, 'Overall 12.00 m x 9.00 m', 10, true);
  g.text(x + 12, y + 120, `Sheet ${pageNo} of 2`, 10, true);
  g.text(x + 12, y + 150, 'Test drawing for Electro House.', 8, true);
  g.text(x + 12, y + 164, 'Not a real building. Calibrate on the', 8, true);
  g.text(x + 12, y + 178, '12.00 m dimension or use paper scale 1:50.', 8, true);
  // scale bar 0-5 m
  const sx = x + 12;
  const sy = y + 212;
  for (let i = 0; i < 5; i++) {
    g.raw(`${i % 2 ? 1 : 0} g 0 G 0.5 w ${f(sx + i * M)} ${f(H - sy - 6)} ${f(M)} 6 re B`);
  }
  for (const i of [0, 1, 5]) g.text(sx + i * M - 2, sy + 18, `${i}`, 7, true);
  g.text(sx + 5 * M + 8, sy + 2, 'm', 8, true);
}

// ── Ground floor ─────────────────────────────────────────────────────────
const ground = page((g) => {
  exteriorWalls(g);
  vWall(g, 6, EXT, 9 - EXT);
  hWall(g, 5, EXT, 3.5); // living / dining (partly open)
  hWall(g, 4.5, 6, 12 - EXT); // kitchen / hall
  vWall(g, 8.5, 4.5, 9 - EXT);
  hWall(g, 6.5, 8.5, 12 - EXT);

  windowAt(g, 'top', 1.5, 3.5);
  windowAt(g, 'top', 8, 10.5);
  windowAt(g, 'left', 2, 3.5);
  windowAt(g, 'left', 6, 8);
  windowAt(g, 'right', 1.5, 3);
  windowAt(g, 'right', 7, 8.2);
  windowAt(g, 'bottom', 1.5, 3.5);

  doorH(g, 9 - EXT / 2, 6.6, 7.6, EXT, false); // entrance
  doorH(g, 4.5, 6.9, 7.8, INT, false); // hall → kitchen
  doorV(g, 6, 2, 2.9, INT, false); // living → kitchen
  doorV(g, 6, 5.6, 6.5, INT, false); // dining → hall
  doorV(g, 8.5, 4.9, 5.7, INT, true); // hall → WC
  doorV(g, 8.5, 7.1, 8, INT, true); // hall → office

  stairs(g, 6.3, 5.6, 7.6, 8.4, 12);

  g.text(1.8, 2.6, 'LIVING ROOM', 11);
  g.text(2.2, 3.1, '26.0 m2', 8);
  g.text(2.2, 7, 'DINING', 11);
  g.text(2.3, 7.5, '20.5 m2', 8);
  g.text(8.2, 2.3, 'KITCHEN', 11);
  g.text(8.3, 2.8, '24.4 m2', 8);
  g.text(9.7, 5.6, 'WC', 10);
  g.text(9.5, 7.8, 'OFFICE', 10);
  g.text(6.2, 5.2, 'HALL', 9);

  dimensions(g);
  sheetFrame(g, 'Ground floor plan', 1);
});

// ── First floor ──────────────────────────────────────────────────────────
const first = page((g) => {
  exteriorWalls(g);
  vWall(g, 6, EXT, 9 - EXT);
  hWall(g, 4.5, EXT, 6);
  hWall(g, 4.5, 6, 12 - EXT);
  vWall(g, 8.5, 4.5, 9 - EXT);

  windowAt(g, 'top', 1.8, 3.8);
  windowAt(g, 'top', 8, 10.5);
  windowAt(g, 'left', 6, 7.8);
  windowAt(g, 'right', 1.5, 3);
  windowAt(g, 'right', 6.2, 7.2);
  windowAt(g, 'bottom', 2, 4);

  doorV(g, 6, 3.2, 4.1, INT, false); // landing → bedroom 1
  doorV(g, 6, 4.9, 5.8, INT, false); // landing → bedroom 2
  doorH(g, 4.5, 6.9, 7.8, INT, false); // landing → master bedroom
  doorV(g, 8.5, 5.2, 6, INT, true); // landing → bathroom

  stairs(g, 6.3, 5.6, 7.6, 8.4, 12);

  g.text(2, 2.3, 'BEDROOM 1', 11);
  g.text(2.3, 2.8, '22.6 m2', 8);
  g.text(2, 6.8, 'BEDROOM 2', 11);
  g.text(2.3, 7.3, '23.0 m2', 8);
  g.text(7.4, 2.3, 'MASTER BEDROOM', 11);
  g.text(8.3, 2.8, '24.4 m2', 8);
  g.text(9.4, 6.6, 'BATHROOM', 10);
  g.text(6.2, 5.2, 'LANDING', 9);

  dimensions(g);
  sheetFrame(g, 'First floor plan', 2);
});

// ── PDF assembly ─────────────────────────────────────────────────────────
const contents = [ground, first];
const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
const kids = [];
for (const c of contents) {
  const pageId = objects.length;
  const contentId = pageId + 1;
  kids.push(`${pageId} 0 R`);
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
  );
  objects.push(`<< /Length ${Buffer.byteLength(c, 'latin1')} >>\nstream\n${c}\nendstream`);
}
objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;

let out = '%PDF-1.4\n';
const offsets = [];
for (let i = 1; i < objects.length; i++) {
  offsets[i] = Buffer.byteLength(out, 'latin1');
  out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
}
const xref = Buffer.byteLength(out, 'latin1');
out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
for (let i = 1; i < objects.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info << /Title (Sample House - test floor plans 1:50) >> >>\nstartxref\n${xref}\n%%EOF\n`;

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'samples', 'sample-house-plans.pdf');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, Buffer.from(out, 'latin1'));
console.log(`Wrote ${target} (${Buffer.byteLength(out, 'latin1')} bytes)`);
