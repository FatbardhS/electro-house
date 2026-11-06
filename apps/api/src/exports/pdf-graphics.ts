import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {
  PDFDocument,
  PDFName,
  TextRenderingMode,
  appendBezierCurve,
  beginText,
  closePath,
  concatTransformationMatrix,
  endText,
  fill,
  fillAndStroke,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setFontAndSize,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  stroke,
  LineCapStyle,
  LineJoinStyle,
  type PDFFont,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib';
import { componentType, hexToRgb, parseSvgPath, SYMBOL_STROKE_MM, type PathSegment, type SymbolPrimitive, type Vec2 } from '@electro/shared';

/** PDF points per millimetre. */
export const MM = 72 / 25.4;

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

const require = createRequire(import.meta.url);
let fontBytes: Promise<[Buffer, Buffer]> | null = null;

/**
 * Embeds DejaVu Sans (open licence, covers Latin/Greek/Cyrillic, ², ×, φ, Ω, ⚠ …), subset to the glyphs used.
 * The 14 standard PDF fonts only cover WinAnsi and cannot print names like "Ω" or many non-English letters.
 */
export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  fontBytes ??= Promise.all([
    readFile(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf')),
    readFile(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf')),
  ]);
  const [regular, bold] = await fontBytes;
  return {
    regular: await doc.embedFont(regular, { subset: true }),
    bold: await doc.embedFont(bold, { subset: true }),
  };
}

/** Replaces characters the font has no glyph for, so they never print as empty boxes. */
const charsetCache = new WeakMap<PDFFont, Set<number>>();
export function safeText(font: PDFFont, text: string): string {
  let set = charsetCache.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charsetCache.set(font, set);
  }
  let out = '';
  for (const ch of text.replace(/[\r\n\t]+/g, ' ')) out += set.has(ch.codePointAt(0)!) ? ch : '?';
  return out;
}

const fontKeys = new WeakMap<PDFPage, Map<PDFFont, PDFName>>();
function fontKey(page: PDFPage, font: PDFFont): PDFName {
  let m = fontKeys.get(page);
  if (!m) {
    m = new Map();
    fontKeys.set(page, m);
  }
  let key = m.get(font);
  if (!key) {
    key = page.node.newFontDictionary(font.name, font.ref);
    m.set(font, key);
  }
  return key;
}

export interface Matrix6 {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Matrix6 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** m1 ∘ m2: apply m2 first, then m1. */
export function compose(m1: Matrix6, m2: Matrix6): Matrix6 {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function cm(m: Matrix6): PDFOperator {
  return concatTransformationMatrix(m.a, m.b, m.c, m.d, m.e, m.f);
}

export function rgb(hex: string): [number, number, number] {
  return hexToRgb(hex);
}

export function pathOps(segments: readonly PathSegment[]): PDFOperator[] {
  const ops: PDFOperator[] = [];
  for (const s of segments) {
    if (s.op === 'M') ops.push(moveTo(s.to.x, s.to.y));
    else if (s.op === 'L') ops.push(lineTo(s.to.x, s.to.y));
    else if (s.op === 'C') ops.push(appendBezierCurve(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.to.x, s.to.y));
    else ops.push(closePath());
  }
  return ops;
}

export function polylineOps(points: readonly Vec2[]): PDFOperator[] {
  return points.map((p, i) => (i === 0 ? moveTo(p.x, p.y) : lineTo(p.x, p.y)));
}

/** Circle as four Bézier arcs. */
export function circleOps(cx: number, cy: number, r: number): PDFOperator[] {
  const k = 0.5522847498 * r;
  return [
    moveTo(cx + r, cy),
    appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
    appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
    appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
    appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
    closePath(),
  ];
}

export interface TextStyle {
  font: PDFFont;
  size: number;
  color: string;
  align?: 'left' | 'center' | 'right';
  /** 'central' centres the text vertically on y (like SVG dominant-baseline="central"). */
  baseline?: 'alphabetic' | 'central';
  /** White outline width behind the text (like the editor's label halo), in the current units. */
  halo?: number;
}

/**
 * Text in a y-DOWN coordinate system (plan space or symbol space): the text matrix flips it upright again.
 */
export function textOpsYDown(page: PDFPage, text: string, x: number, y: number, s: TextStyle): PDFOperator[] {
  const t = safeText(s.font, text);
  if (!t) return [];
  const w = s.font.widthOfTextAtSize(t, s.size);
  const dx = s.align === 'center' ? -w / 2 : s.align === 'right' ? -w : 0;
  const dy = s.baseline === 'central' ? s.size * 0.36 : 0;
  const key = fontKey(page, s.font);
  const enc = s.font.encodeText(t);
  const ops: PDFOperator[] = [pushGraphicsState()];
  const run = (mode: TextRenderingMode) => [
    beginText(),
    setFontAndSize(key, s.size),
    setTextRenderingMode(mode),
    setTextMatrix(1, 0, 0, -1, x + dx, y + dy),
    showText(enc),
    endText(),
  ];
  if (s.halo) {
    ops.push(setStrokingRgbColor(1, 1, 1), setLineWidth(s.halo), setLineJoin(LineJoinStyle.Round), ...run(TextRenderingMode.Outline));
  }
  ops.push(setFillingRgbColor(...rgb(s.color)), ...run(TextRenderingMode.Fill), popGraphicsState());
  return ops;
}

const parsedPaths = new Map<string, PathSegment[]>();
function parsed(d: string): PathSegment[] {
  let p = parsedPaths.get(d);
  if (!p) {
    p = parseSvgPath(d);
    parsedPaths.set(d, p);
  }
  return p;
}

/**
 * A catalog symbol, drawn in its own paper-millimetre space (y down, origin at the insertion point).
 * The caller sets the transformation matrix (position, rotation, scale) before.
 */
export function symbolOps(page: PDFPage, fonts: Fonts, typeKey: string, color: string): PDFOperator[] {
  const type = componentType(typeKey);
  if (!type) return [];
  const [r, g, b] = rgb(color);
  const ops: PDFOperator[] = [
    pushGraphicsState(),
    setStrokingRgbColor(r, g, b),
    setLineWidth(SYMBOL_STROKE_MM),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
  ];
  const paint = (fillMode: 'none' | 'stroke' | 'paper' | undefined): PDFOperator[] => {
    if (fillMode === 'stroke') return [setFillingRgbColor(r, g, b), fillAndStroke()];
    if (fillMode === 'paper') return [setFillingRgbColor(1, 1, 1), fillAndStroke()];
    return [stroke()];
  };
  for (const p of type.symbol.primitives as readonly SymbolPrimitive[]) {
    if (p.kind === 'path') ops.push(...pathOps(parsed(p.d)), ...paint(p.fill));
    else if (p.kind === 'circle') ops.push(...circleOps(p.cx, p.cy, p.r), ...paint(p.fill));
    else ops.push(...textOpsYDown(page, p.text, p.x, p.y, { font: fonts.bold, size: p.size, color, align: 'center', baseline: 'central' }));
  }
  ops.push(popGraphicsState());
  return ops;
}

/** Fills a rectangle (y-up page space). */
export function fillRectOps(x: number, y: number, w: number, h: number, color: string): PDFOperator[] {
  return [pushGraphicsState(), setFillingRgbColor(...rgb(color)), moveTo(x, y), lineTo(x + w, y), lineTo(x + w, y + h), lineTo(x, y + h), closePath(), fill(), popGraphicsState()];
}
