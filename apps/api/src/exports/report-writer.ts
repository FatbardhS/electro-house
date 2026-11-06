import { rgb as pdfRgb, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import { MM, safeText, type Fonts } from './pdf-graphics.js';

const A4 = { width: 210 * MM, height: 297 * MM };
const MARGIN = 15 * MM;
const TEXT = pdfRgb(0.07, 0.09, 0.11);
const MUTED = pdfRgb(0.42, 0.45, 0.5);
const RULE = pdfRgb(0.82, 0.84, 0.87);
const HEAD_BG = pdfRgb(0.94, 0.95, 0.96);
const WARN = pdfRgb(0.62, 0.35, 0.02);

export interface Column {
  label: string;
  /** Relative width. */
  width: number;
  align?: 'left' | 'right';
}

export interface TableOptions {
  size?: number;
  /** Rows drawn in bold (e.g. totals). */
  boldRows?: ReadonlySet<number>;
  /** Called to draw extra graphics in a cell (e.g. a symbol); text of that cell is still drawn. */
  drawCell?: (row: number, col: number, page: PDFPage, x: number, yTop: number, w: number, h: number) => void;
  /** Minimum row height in points. */
  minRowHeight?: number;
}

/** Splits text into lines that fit `width`; long words are cut. */
export function wrapText(font: PDFFont, text: string, size: number, width: number): string[] {
  const words = safeText(font, text).split(' ');
  const lines: string[] = [];
  let line = '';
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  for (let word of words) {
    while (!fits(word) && word.length > 1) {
      // hard-break a word that is wider than the column
      let cut = word.length - 1;
      while (cut > 1 && !fits((line ? line + ' ' : '') + word.slice(0, cut))) cut--;
      lines.push((line ? line + ' ' : '') + word.slice(0, cut));
      line = '';
      word = word.slice(cut);
    }
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

/**
 * Flowing A4 report pages (cover, schedules, BOM, costs) with a running header, page breaks inside
 * tables (header row repeated) and page numbers added at the end.
 */
export class ReportWriter {
  page!: PDFPage;
  y = 0;
  private section = '';
  private landscape = false;

  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: Fonts,
    private readonly headerRight: string,
  ) {}

  get width(): number {
    return this.page.getWidth() - 2 * MARGIN;
  }
  get left(): number {
    return MARGIN;
  }

  /** Starts a new section on a new page. */
  startSection(title: string, landscape = false): void {
    this.section = title;
    this.landscape = landscape;
    this.addPage();
  }

  private addPage(continued = false): void {
    const size: [number, number] = this.landscape ? [A4.height, A4.width] : [A4.width, A4.height];
    this.page = this.doc.addPage(size);
    const top = this.page.getHeight() - MARGIN;
    const title = continued ? `${this.section} (continued)` : this.section;
    this.page.drawText(safeText(this.fonts.bold, title), { x: MARGIN, y: top - 12, size: 14, font: this.fonts.bold, color: TEXT });
    const right = safeText(this.fonts.regular, this.headerRight);
    const rw = this.fonts.regular.widthOfTextAtSize(right, 8.5);
    this.page.drawText(right, { x: this.page.getWidth() - MARGIN - rw, y: top - 10, size: 8.5, font: this.fonts.regular, color: MUTED });
    this.page.drawLine({ start: { x: MARGIN, y: top - 18 }, end: { x: this.page.getWidth() - MARGIN, y: top - 18 }, thickness: 0.6, color: RULE });
    this.y = top - 32;
  }

  /** Ensures `h` points of space are left; otherwise continues on a new page. Returns true on a page break. */
  ensure(h: number): boolean {
    if (this.y - h >= MARGIN + 14) return false;
    this.addPage(true);
    return true;
  }

  heading(text: string, size = 11.5): void {
    this.ensure(size * 3);
    this.y -= 4;
    this.page.drawText(safeText(this.fonts.bold, text), { x: MARGIN, y: this.y - size, size, font: this.fonts.bold, color: TEXT });
    this.y -= size + 8;
  }

  paragraph(text: string, opts: { size?: number; muted?: boolean; warn?: boolean; bold?: boolean } = {}): void {
    const size = opts.size ?? 9;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const color = opts.warn ? WARN : opts.muted ? MUTED : TEXT;
    for (const line of wrapText(font, text, size, this.width)) {
      this.ensure(size * 1.4);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font, color });
      this.y -= size * 1.4;
    }
    this.y -= 4;
  }

  space(h: number): void {
    this.y -= h;
  }

  /** Two-column "label: value" block (cover page, summaries). */
  keyValues(rows: [string, string][], opts: { size?: number; labelWidth?: number } = {}): void {
    const size = opts.size ?? 10;
    const lw = opts.labelWidth ?? 45 * MM;
    for (const [k, v] of rows) {
      const lines = wrapText(this.fonts.regular, v || '—', size, this.width - lw);
      this.ensure(lines.length * size * 1.45);
      this.page.drawText(safeText(this.fonts.regular, k), { x: MARGIN, y: this.y - size, size, font: this.fonts.regular, color: MUTED });
      lines.forEach((l, i) => this.page.drawText(l, { x: MARGIN + lw, y: this.y - size - i * size * 1.3, size, font: this.fonts.regular, color: TEXT }));
      this.y -= lines.length * size * 1.3 + size * 0.5;
    }
    this.y -= 4;
  }

  table(columns: Column[], rows: string[][], opts: TableOptions = {}): void {
    const size = opts.size ?? 8.5;
    const pad = 3;
    const lineH = size * 1.25;
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const drawRow = (cells: string[], font: PDFFont, rowIndex: number | null, header: boolean) => {
      const wrapped = cells.map((t, i) => wrapText(font, t ?? '', size, widths[i]! - 2 * pad));
      const h = Math.max(header ? 0 : (opts.minRowHeight ?? 0), Math.max(...wrapped.map((l) => l.length)) * lineH + 2 * pad);
      if (!header && this.ensure(h)) drawHeader();
      const top = this.y;
      if (header) this.page.drawRectangle({ x: MARGIN, y: top - h, width: this.width, height: h, color: HEAD_BG });
      let x = MARGIN;
      wrapped.forEach((lines, i) => {
        const w = widths[i]!;
        if (rowIndex !== null && opts.drawCell) opts.drawCell(rowIndex, i, this.page, x, top, w, h);
        lines.forEach((line, li) => {
          const tw = font.widthOfTextAtSize(line, size);
          const tx = columns[i]!.align === 'right' ? x + w - pad - tw : x + pad;
          this.page.drawText(line, { x: tx, y: top - pad - size * 0.85 - li * lineH, size, font, color: header ? MUTED : TEXT });
        });
        x += w;
      });
      this.page.drawLine({ start: { x: MARGIN, y: top - h }, end: { x: MARGIN + this.width, y: top - h }, thickness: 0.4, color: RULE });
      this.y = top - h;
    };
    const drawHeader = () => drawRow(columns.map((c) => c.label), this.fonts.bold, null, true);
    this.ensure(lineH * 4);
    drawHeader();
    rows.forEach((r, i) => drawRow(r, opts.boldRows?.has(i) ? this.fonts.bold : this.fonts.regular, i, false));
    this.y -= 10;
  }

  /** Adds "page x of n" and a footer line to every page of the document (call once, at the end). */
  finish(footer: string): void {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const label = `Page ${i + 1} of ${pages.length}`;
      const w = this.fonts.regular.widthOfTextAtSize(label, 7.5);
      p.drawText(label, { x: p.getWidth() - MARGIN - w, y: 8 * MM, size: 7.5, font: this.fonts.regular, color: MUTED });
      p.drawText(safeText(this.fonts.regular, footer), { x: MARGIN, y: 8 * MM, size: 7.5, font: this.fonts.regular, color: MUTED });
    });
  }
}
