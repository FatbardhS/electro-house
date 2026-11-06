import {
  LineCapStyle,
  LineJoinStyle,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb as pdfRgb,
  setDashPattern,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
  type PDFDocument,
  type PDFEmbeddedPage,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib';
import {
  LABEL_SIZE_MM,
  LAYER_COLORS,
  MM_TO_PT,
  PAPER_SIZES_MM,
  WIRE_WIDTH_MM,
  componentLabelPosition,
  componentLabelText,
  dashArray,
  hitRadius,
  wireLabelPosition,
  wireRoute,
  type ComponentDto,
  type FloorInstallationDto,
  type LayerKey,
  type PaperOption,
  type PlanRotation,
  type Vec2,
} from '@electro/shared';
import { IDENTITY, MM, compose, cm, polylineOps, rgb, safeText, symbolOps, textOpsYDown, type Fonts, type Matrix6 } from './pdf-graphics.js';
import { tr } from './export-lang.js';

/** The plan page embedded as a vector form XObject, with the facts needed to place it. */
export interface EmbeddedPlan {
  page: PDFEmbeddedPage;
  /** Unrotated size of the embedded box (crop box) in points. */
  width: number;
  height: number;
  /** The page's own /Rotate (0, 90, 180, 270). Plan coordinates include it, the embedded XObject does not. */
  rotate: PlanRotation;
}

export interface TitleBlock {
  company: string;
  companyLines: string[];
  logo: PDFImage | null;
  project: string;
  client: string;
  address: string;
  date: string;
}

export interface SheetInput {
  floor: FloorInstallationDto;
  plan: EmbeddedPlan | null;
  /** Shown when the plan could not be embedded. */
  planProblem: string | null;
  viewRotation: PlanRotation;
  paper: PaperOption;
  orientation: 'auto' | 'portrait' | 'landscape';
  hiddenLayers: ReadonlySet<LayerKey>;
  title: TitleBlock;
  sheetNumber: number;
  sheetCount: number;
}

const STANDARD_SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000];
const MARGIN = 10 * MM;
const BOTTOM = 13 * MM; // leaves room for the page footer
const TITLE_H = 30 * MM;
const DARK = pdfRgb(0.07, 0.09, 0.11);
const MUTED = pdfRgb(0.42, 0.45, 0.5);

/** Maps the embedded (unrotated, y-up) page box into plan coordinates (page /Rotate applied, y-down). */
function embeddedToPlan(rotate: PlanRotation, w: number, h: number): Matrix6 {
  switch (rotate) {
    case 0:
      return { a: 1, b: 0, c: 0, d: -1, e: 0, f: h };
    case 90:
      return { a: 0, b: 1, c: 1, d: 0, e: 0, f: 0 };
    case 180:
      return { a: -1, b: 0, c: 0, d: 1, e: w, f: 0 };
    case 270:
      return { a: 0, b: -1, c: -1, d: 0, e: h, f: w };
  }
}

/** The editor's view rotation (plan → rotated box, both y-down). Same as the editor's rotationMatrix. */
function viewRotationMatrix(w: number, h: number, rotation: PlanRotation): Matrix6 {
  switch (rotation) {
    case 0:
      return IDENTITY;
    case 90:
      return { a: 0, b: 1, c: -1, d: 0, e: h, f: 0 };
    case 180:
      return { a: -1, b: 0, c: 0, d: -1, e: w, f: h };
    case 270:
      return { a: 0, b: -1, c: 1, d: 0, e: 0, f: w };
  }
}

/** Plan-space bounding box of what is drawn (used when there is no plan page). */
function contentBounds(floor: FloorInstallationDto): { min: Vec2; max: Vec2 } | null {
  const pts: Vec2[] = [];
  const byId = new Map(floor.components.map((c) => [c.id, c]));
  for (const c of floor.components) {
    const r = hitRadius(c) * 2;
    pts.push({ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r });
  }
  for (const w of floor.wires) pts.push(...wireRoute(w, (id) => byId.get(id)));
  if (!pts.length) return null;
  return {
    min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
    max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
  };
}

function scaleText(denominator: number | null): string {
  return denominator === null ? tr('Not to scale') : `1:${denominator}`;
}

/** Draws one floor plan sheet: plan page, wires, symbols, labels, frame, title block and scale bar. */
export function drawPlanSheet(doc: PDFDocument, fonts: Fonts, input: SheetInput): PDFPage {
  const { floor, plan } = input;

  // 1. Plan space size (and an offset when the drawing has no plan page behind it).
  let planW: number;
  let planH: number;
  let offset: Matrix6 = IDENTITY;
  if (plan) {
    const swap = plan.rotate === 90 || plan.rotate === 270;
    planW = swap ? plan.height : plan.width;
    planH = swap ? plan.width : plan.height;
  } else {
    const b = contentBounds(floor);
    const pad = 20 * MM_TO_PT;
    const min = b ? { x: b.min.x - pad, y: b.min.y - pad } : { x: 0, y: 0 };
    planW = b ? b.max.x - b.min.x + 2 * pad : 595;
    planH = b ? b.max.y - b.min.y + 2 * pad : 842;
    offset = { a: 1, b: 0, c: 0, d: 1, e: -min.x, f: -min.y };
  }
  const rot = viewRotationMatrix(planW, planH, input.viewRotation);
  const swapView = input.viewRotation === 90 || input.viewRotation === 270;
  const boxW = swapView ? planH : planW;
  const boxH = swapView ? planW : planH;

  // 2. Sheet size.
  let sheetW: number;
  let sheetH: number;
  if (input.paper === 'plan') {
    sheetW = boxW + 2 * MARGIN;
    sheetH = boxH + MARGIN + BOTTOM + TITLE_H + 4 * MM;
  } else {
    const p = PAPER_SIZES_MM[input.paper];
    const landscape = input.orientation === 'landscape' || (input.orientation === 'auto' && boxW > boxH);
    sheetW = (landscape ? p.height : p.width) * MM;
    sheetH = (landscape ? p.width : p.height) * MM;
  }
  const page = doc.addPage([sheetW, sheetH]);

  // 3. Drawing area and scale.
  const area = { x: MARGIN, y: BOTTOM + TITLE_H + 4 * MM, w: sheetW - 2 * MARGIN, h: sheetH - MARGIN - BOTTOM - TITLE_H - 4 * MM };
  const mpu = floor.metresPerUnit;
  let k: number;
  let denominator: number | null = null;
  if (input.paper === 'plan') {
    k = 1;
    if (mpu) {
      const exact = (mpu * 1000 * MM_TO_PT) / k;
      const std = STANDARD_SCALES.find((s) => Math.abs(s - exact) / s < 0.02);
      denominator = std ?? Math.round(exact);
    }
  } else {
    // Without a plan page the drawing can be tiny (one board); never enlarge it beyond its paper size.
    const fit = Math.min(area.w / boxW, area.h / boxH, plan ? Infinity : 1);
    k = fit;
    if (mpu) {
      // Print at the next standard scale that fits (e.g. 1:100), so the sheet can be measured with a scale rule.
      const fitDen = (mpu * 1000 * MM_TO_PT) / fit;
      const std = STANDARD_SCALES.find((s) => s >= fitDen - 1e-9);
      if (std) {
        denominator = std;
        k = (mpu * 1000 * MM_TO_PT) / std;
      }
    }
  }
  const ox = area.x + (area.w - boxW * k) / 2;
  const oy = area.y + (area.h - boxH * k) / 2;
  const toSheet: Matrix6 = { a: k, b: 0, c: 0, d: -k, e: ox, f: oy + boxH * k };
  const planToSheet = compose(toSheet, compose(rot, offset));

  const ops: PDFOperator[] = [pushGraphicsState(), rectangle(area.x, area.y, area.w, area.h), clip(), endPath()];

  // 4. The architect's plan, as vectors.
  if (plan) {
    ops.push(pushGraphicsState(), cm(compose(planToSheet, embeddedToPlan(plan.rotate, plan.width, plan.height))));
    page.pushOperators(...ops);
    ops.length = 0;
    page.drawPage(plan.page, { x: 0, y: 0 }); // emits q, cm, Do, Q inside the transform above
    ops.push(popGraphicsState());
  }

  // 5. Wires and components in plan space.
  ops.push(pushGraphicsState(), cm(planToSheet));
  const byId = new Map(floor.components.map((c) => [c.id, c]));
  const visible = (c: ComponentDto) => !input.hiddenLayers.has(c.layerKey as LayerKey);
  const labelSize = LABEL_SIZE_MM * MM_TO_PT;
  if (!input.hiddenLayers.has('wiring')) {
    for (const w of floor.wires) {
      const route = wireRoute(w, (id) => byId.get(id));
      const dash = dashArray(w.cable.lineStyle);
      ops.push(
        pushGraphicsState(),
        setStrokingRgbColor(...rgb(w.cable.color)),
        setLineWidth(WIRE_WIDTH_MM * MM_TO_PT),
        setLineCap(LineCapStyle.Round),
        setLineJoin(LineJoinStyle.Round),
        setDashPattern(dash ? dash.split(' ').map(Number) : [], 0),
        ...polylineOps(route),
        stroke(),
        popGraphicsState(),
      );
      if (w.label) {
        const at = wireLabelPosition(route);
        ops.push(...textOpsYDown(page, w.label, at.x, at.y, { font: fonts.bold, size: labelSize, color: w.cable.color, halo: 0.6 }));
      }
    }
  }
  for (const c of floor.components) {
    if (!visible(c)) continue;
    const color = LAYER_COLORS[c.layerKey as LayerKey] ?? '#111827';
    const a = (c.rotation * Math.PI) / 180;
    const s = MM_TO_PT;
    ops.push(pushGraphicsState(), cm({ a: s * Math.cos(a), b: s * Math.sin(a), c: -s * Math.sin(a), d: s * Math.cos(a), e: c.x, f: c.y }));
    ops.push(...symbolOps(page, fonts, c.typeKey, color), popGraphicsState());
    const label = componentLabelText(c);
    if (label) {
      const at = componentLabelPosition(c);
      ops.push(...textOpsYDown(page, label, at.x, at.y, { font: fonts.bold, size: labelSize, color, halo: 0.6 }));
    }
  }
  ops.push(popGraphicsState(), popGraphicsState());
  page.pushOperators(...ops);

  // 6. Frame, problem note, title block, scale bar.
  page.drawRectangle({ x: area.x, y: area.y, width: area.w, height: area.h, borderColor: DARK, borderWidth: 0.6 });
  if (input.planProblem) {
    page.drawText(safeText(fonts.regular, tr(input.planProblem)), { x: area.x + 4 * MM, y: area.y + area.h - 7 * MM, size: 8, font: fonts.regular, color: pdfRgb(0.62, 0.35, 0.02) });
  }
  drawTitleBlock(page, fonts, input, { x: MARGIN, y: BOTTOM, w: sheetW - 2 * MARGIN, h: TITLE_H }, denominator, mpu ? mpu / k : null);
  return page;
}

/** Bottom strip: company | project | floor | scale + sheet. `metresPerPoint` = real metres per sheet point. */
function drawTitleBlock(
  page: PDFPage,
  fonts: Fonts,
  input: SheetInput,
  box: { x: number; y: number; w: number; h: number },
  denominator: number | null,
  metresPerPoint: number | null,
): void {
  const t = input.title;
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: DARK, borderWidth: 0.6 });
  const cols = [0.3, 0.3, 0.2, 0.2].map((f) => f * box.w);
  let x = box.x;
  const cellTexts: { label: string; lines: string[]; big?: string }[] = [
    { label: '', lines: t.companyLines, big: t.company },
    { label: tr('Project'), lines: [t.client, t.address].filter(Boolean), big: t.project },
    { label: tr('Drawing'), lines: [tr('Electrical installation plan')], big: input.floor.name },
    {
      label: tr('Scale'),
      lines: [`${input.paper === 'plan' ? tr('Original plan size') : input.paper} · ${t.date}`, tr(`Sheet ${input.sheetNumber} of ${input.sheetCount}`)],
      big: scaleText(denominator),
    },
  ];
  cellTexts.forEach((cell, i) => {
    const w = cols[i]!;
    if (i > 0) page.drawLine({ start: { x, y: box.y }, end: { x, y: box.y + box.h }, thickness: 0.6, color: DARK });
    const tx = x + 3 * MM;
    let ty = box.y + box.h - 5 * MM;
    if (i === 0 && t.logo) {
      const s = Math.min((10 * MM) / t.logo.height, (w - 6 * MM) / t.logo.width);
      const lh = t.logo.height * s;
      page.drawImage(t.logo, { x: tx, y: box.y + box.h - 3 * MM - lh, width: t.logo.width * s, height: lh });
      ty -= lh + 1 * MM;
    }
    if (cell.label) {
      page.drawText(cell.label.toUpperCase(), { x: tx, y: ty + 1.2 * MM, size: 6, font: fonts.bold, color: MUTED });
      ty -= 3 * MM;
    }
    if (cell.big) {
      page.drawText(fit(fonts, cell.big, 11, w - 6 * MM, true), { x: tx, y: ty - 2 * MM, size: 11, font: fonts.bold, color: DARK });
      ty -= 6 * MM;
    }
    for (const line of cell.lines) {
      if (ty < box.y + 2.5 * MM) break;
      page.drawText(fit(fonts, line, 7.5, w - 6 * MM, false), { x: tx, y: ty - 1 * MM, size: 7.5, font: fonts.regular, color: DARK });
      ty -= 3.6 * MM;
    }

    x += w;
  });

  // Scale bar in the scale cell: the largest of 1/2/5 × 10^n metres that fits in 40 mm.
  if (metresPerPoint) {
    const maxPt = Math.min(40 * MM, cols[3]! - 8 * MM);
    const maxM = maxPt * metresPerPoint;
    const pow = 10 ** Math.floor(Math.log10(maxM));
    const lenM = [5, 2, 1].map((m) => m * pow).find((m) => m <= maxM) ?? pow;
    const lenPt = lenM / metresPerPoint;
    const bx = box.x + cols[0]! + cols[1]! + cols[2]! + 3 * MM;
    const by = box.y + 4 * MM;
    for (let i = 0; i < 4; i++) {
      page.drawRectangle({ x: bx + (i * lenPt) / 4, y: by, width: lenPt / 4, height: 1.6 * MM, color: i % 2 ? pdfRgb(1, 1, 1) : DARK, borderColor: DARK, borderWidth: 0.4 });
    }
    page.drawText('0', { x: bx - 1, y: by + 2.4 * MM, size: 6, font: fonts.regular, color: DARK });
    const end = `${lenM} m`;
    page.drawText(end, { x: bx + lenPt - fonts.regular.widthOfTextAtSize(end, 6) / 2, y: by + 2.4 * MM, size: 6, font: fonts.regular, color: DARK });
  }
}

function fit(fonts: Fonts, text: string, size: number, width: number, bold: boolean): string {
  const font = bold ? fonts.bold : fonts.regular;
  let t = safeText(font, text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > width) t = t.slice(0, -1);
  return t + '…';
}
