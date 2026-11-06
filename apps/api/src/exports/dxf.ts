import {
  LABEL_SIZE_MM,
  LAYER_COLORS,
  LAYER_KEYS,
  MM_TO_PT,
  SYMBOL_STROKE_MM,
  cableSummary,
  componentLabelPosition,
  componentLabelText,
  componentType,
  hexToRgb,
  parseSvgPath,
  wireLabelPosition,
  wireRoute,
  type CableDto,
  type FloorInstallationDto,
  type SymbolPrimitive,
  type Vec2,
} from '@electro/shared';

/**
 * ASCII DXF R12 (AC1009) writer for one floor: the most widely readable DXF flavour (AutoCAD, BricsCAD, LibreCAD,
 * DraftSight, QCAD). Each component type is a block drawn from the same symbol primitives as the editor and PDF;
 * placed components are INSERTs with a LABEL attribute; wires are polylines with their cable as text.
 *
 * Units: metres when the floor is calibrated (true scale, so it overlays the architect's CAD drawing),
 * otherwise PDF points of the plan page. Y is flipped (plans are y-down, DXF is y-up).
 */

/** AutoCAD Color Index entries used to approximate RGB colours (R12 has no true colour). */
const ACI: [number, [number, number, number]][] = [
  [1, [255, 0, 0]],
  [2, [255, 255, 0]],
  [3, [0, 255, 0]],
  [4, [0, 255, 255]],
  [5, [0, 0, 255]],
  [6, [255, 0, 255]],
  [7, [0, 0, 0]],
  [8, [128, 128, 128]],
  [9, [192, 192, 192]],
  [30, [255, 127, 0]],
  [14, [165, 0, 0]],
  [150, [0, 127, 255]],
  [170, [0, 63, 127]],
  [190, [127, 0, 255]],
  [210, [255, 0, 191]],
  [130, [0, 191, 191]],
  [94, [0, 127, 0]],
  [42, [127, 95, 0]],
];

export function nearestAci(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v * 255) as [number, number, number];
  let best = 7;
  let bestD = Infinity;
  for (const [aci, [ar, ag, ab]] of ACI) {
    const d = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2;
    if (d < bestD) {
      bestD = d;
      best = aci;
    }
  }
  return best;
}

export function layerName(key: string): string {
  return `EH-${key.toUpperCase()}`;
}

export function blockName(typeKey: string): string {
  return `EH_${typeKey.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`;
}

/** DXF R12 text must be single-line; non-ASCII is written as \U+XXXX, which CAD programs decode. */
function dxfText(s: string): string {
  let out = '';
  for (const ch of s.replace(/[\r\n\t]+/g, ' ')) {
    const cp = ch.codePointAt(0)!;
    out += cp < 128 ? ch : cp <= 0xffff ? `\\U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : '?';
  }
  return out;
}

const n = (v: number) => (Math.abs(v) < 1e-12 ? '0' : String(+v.toPrecision(12)));

class DxfOut {
  private readonly lines: string[] = [];
  g(code: number, value: string | number): this {
    this.lines.push(String(code), typeof value === 'number' ? n(value) : value);
    return this;
  }
  toString(): string {
    return this.lines.join('\r\n') + '\r\n';
  }
}

/** Cubic Bézier flattened into points (excluding the start point). */
function flatten(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, steps = 8): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    });
  }
  return out;
}

/** Symbol path → polylines (each a list of points and a closed flag), in symbol mm (y-down). */
function pathPolylines(d: string): { points: Vec2[]; closed: boolean }[] {
  const out: { points: Vec2[]; closed: boolean }[] = [];
  let cur: { points: Vec2[]; closed: boolean } | null = null;
  for (const s of parseSvgPath(d)) {
    if (s.op === 'M') {
      cur = { points: [s.to], closed: false };
      out.push(cur);
    } else if (s.op === 'L') cur?.points.push(s.to);
    else if (s.op === 'C' && cur) cur.points.push(...flatten(cur.points[cur.points.length - 1]!, s.c1, s.c2, s.to));
    else if (s.op === 'Z' && cur) cur.closed = true;
  }
  return out.filter((p) => p.points.length > 1);
}

function writePolyline(out: DxfOut, layer: string, points: Vec2[], closed: boolean, extra: (o: DxfOut) => void = () => undefined): void {
  out.g(0, 'POLYLINE').g(8, layer);
  extra(out);
  out.g(66, 1).g(10, 0).g(20, 0).g(30, 0).g(70, closed ? 1 : 0);
  for (const p of points) out.g(0, 'VERTEX').g(8, layer).g(10, p.x).g(20, p.y).g(30, 0);
  out.g(0, 'SEQEND').g(8, layer);
}

export interface FloorDxfInput {
  floor: FloorInstallationDto;
  projectName: string;
  companyName: string;
}

export function floorToDxf({ floor, projectName, companyName }: FloorDxfInput): string {
  const metric = floor.metresPerUnit !== null;
  /** Drawing units per plan unit. */
  const k = floor.metresPerUnit ?? 1;
  const P = (p: Vec2): Vec2 => ({ x: p.x * k, y: -p.y * k });
  /** Drawing units per paper millimetre of the original plan. */
  const mm = MM_TO_PT * k;
  const byId = new Map(floor.components.map((c) => [c.id, c]));
  const used = [...new Set(floor.components.map((c) => c.typeKey))].filter((t) => componentType(t));
  const out = new DxfOut();

  // ── header ──
  out.g(999, dxfText(`Electro House - ${projectName} - ${floor.name} - ${companyName}`));
  out.g(999, metric ? 'Units: metres (true scale from the floor calibration).' : 'Units: PDF points of the plan page (floor not calibrated: not to scale).');
  out.g(0, 'SECTION').g(2, 'HEADER');
  out.g(9, '$ACADVER').g(1, 'AC1009');
  out.g(9, '$INSUNITS').g(70, metric ? 6 : 0);
  out.g(9, '$LTSCALE').g(40, 1);
  out.g(0, 'ENDSEC');

  // ── tables: line types, layers, text style ──
  out.g(0, 'SECTION').g(2, 'TABLES');
  const ltypes: [string, string, number[]][] = [
    ['CONTINUOUS', 'Solid line', []],
    ['DASHED', 'Dashed __ __', [3, -1.5]],
    ['DOTTED', 'Dotted . . .', [0.4, -1]],
    ['DASHDOT', 'Dash dot __ . __', [3, -1, 0.4, -1]],
  ];
  out.g(0, 'TABLE').g(2, 'LTYPE').g(70, ltypes.length);
  for (const [name, desc, pattern] of ltypes) {
    const scaled = pattern.map((v) => v * mm);
    out.g(0, 'LTYPE').g(2, name).g(70, 0).g(3, desc).g(72, 65).g(73, scaled.length).g(40, scaled.reduce((s, v) => s + Math.abs(v), 0));
    for (const v of scaled) out.g(49, v);
  }
  out.g(0, 'ENDTAB');
  out.g(0, 'TABLE').g(2, 'LAYER').g(70, LAYER_KEYS.length + 1);
  out.g(0, 'LAYER').g(2, '0').g(70, 0).g(62, 7).g(6, 'CONTINUOUS');
  for (const key of LAYER_KEYS) out.g(0, 'LAYER').g(2, layerName(key)).g(70, 0).g(62, nearestAci(LAYER_COLORS[key])).g(6, 'CONTINUOUS');
  out.g(0, 'ENDTAB');
  out.g(0, 'TABLE').g(2, 'STYLE').g(70, 1);
  out.g(0, 'STYLE').g(2, 'STANDARD').g(70, 0).g(40, 0).g(41, 1).g(50, 0).g(71, 0).g(42, 2.5).g(3, 'txt').g(4, '');
  out.g(0, 'ENDTAB');
  out.g(0, 'ENDSEC');

  // ── blocks: one per component type, drawn in symbol millimetres (y flipped), on layer 0 = inherits the insert's layer ──
  out.g(0, 'SECTION').g(2, 'BLOCKS');
  for (const typeKey of used) {
    const type = componentType(typeKey)!;
    out.g(0, 'BLOCK').g(8, '0').g(2, blockName(typeKey)).g(70, 2).g(10, 0).g(20, 0).g(30, 0).g(3, blockName(typeKey));
    const flip = (p: Vec2): Vec2 => ({ x: p.x, y: -p.y });
    for (const p of type.symbol.primitives as readonly SymbolPrimitive[]) {
      if (p.kind === 'path') {
        for (const pl of pathPolylines(p.d)) writePolyline(out, '0', pl.points.map(flip), pl.closed, (o) => o.g(40, SYMBOL_STROKE_MM).g(41, SYMBOL_STROKE_MM));
      } else if (p.kind === 'circle') {
        out.g(0, 'CIRCLE').g(8, '0').g(10, p.cx).g(20, -p.cy).g(30, 0).g(40, p.r);
      } else {
        out.g(0, 'TEXT').g(8, '0').g(10, p.x).g(20, -p.y).g(30, 0).g(40, p.size * 0.72).g(1, dxfText(p.text)).g(72, 1).g(73, 2).g(11, p.x).g(21, -p.y).g(31, 0);
      }
    }
    // Label attribute, placed at the editor's label position relative to the symbol (top-right).
    const r = (type.symbol.hitRadiusMm ?? 3) * 0.9;
    out.g(0, 'ATTDEF').g(8, '0').g(10, r).g(20, r).g(30, 0).g(40, LABEL_SIZE_MM).g(1, '').g(3, 'Label').g(2, 'LABEL').g(70, 0);
    out.g(0, 'ENDBLK').g(8, '0');
  }
  out.g(0, 'ENDSEC');

  // ── entities ──
  out.g(0, 'SECTION').g(2, 'ENTITIES');
  const wiring = layerName('wiring');
  for (const w of floor.wires) {
    const route = wireRoute(w, (id) => byId.get(id)).map(P);
    const lt = w.cable.lineStyle === 'dashed' ? 'DASHED' : w.cable.lineStyle === 'dotted' ? 'DOTTED' : w.cable.lineStyle === 'dash-dot' ? 'DASHDOT' : 'CONTINUOUS';
    writePolyline(out, wiring, route, false, (o) => o.g(6, lt).g(62, nearestAci(w.cable.color)));
    const text = [w.label, cableText(w.cable)].filter(Boolean).join(' ');
    const at = P(wireLabelPosition(wireRoute(w, (id) => byId.get(id))));
    out.g(0, 'TEXT').g(8, wiring).g(62, nearestAci(w.cable.color)).g(10, at.x).g(20, at.y).g(30, 0).g(40, LABEL_SIZE_MM * mm * 0.8).g(1, dxfText(text));
  }
  for (const c of floor.components) {
    if (!componentType(c.typeKey)) continue;
    const layer = layerName(c.layerKey);
    const at = P(c);
    const label = componentLabelText(c) ?? '';
    out.g(0, 'INSERT').g(8, layer).g(66, 1).g(2, blockName(c.typeKey)).g(10, at.x).g(20, at.y).g(30, 0).g(41, mm).g(42, mm).g(43, mm).g(50, -c.rotation);
    const la = P(componentLabelPosition(c));
    out.g(0, 'ATTRIB').g(8, layer).g(10, la.x).g(20, la.y).g(30, 0).g(40, LABEL_SIZE_MM * mm).g(1, dxfText(label)).g(2, 'LABEL').g(70, 0);
    out.g(0, 'SEQEND').g(8, layer);
  }
  out.g(0, 'ENDSEC');
  out.g(0, 'EOF');
  return out.toString();
}

function cableText(c: CableDto): string {
  return c.cableType || c.crossSectionMm2 ? cableSummary(c) : '';
}

/** Safe file name for a floor, e.g. "ground-floor.dxf". */
export function dxfFileName(name: string): string {
  return `${name.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'floor'}.dxf`;
}

