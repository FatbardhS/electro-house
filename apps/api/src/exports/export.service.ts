import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PDFDocument, popGraphicsState, pushGraphicsState, type PDFImage } from 'pdf-lib';
import {
  CATEGORY_NAMES,
  CHECKS,
  applyIgnored,
  runChecks,
  type MaterialDto,
  type MaterialRuleDto,
  EXPORT_SECTION_NAMES,
  LAYER_COLORS,
  LAYER_NAMES,
  boardSchedules,
  buildBom,
  circuitLoads,
  componentType,
  costSummary,
  effectiveCostSettings,
  groupTakeoff,
  normalizeRotation,
  readOrganizationSettings,
  takeoff,
  type ExportOptions,
  type InstallationDto,
  type LayerKey,
  type PlanRotation,
} from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { InstallationService } from '../installation/installation.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { MM, cm, embedFonts, symbolOps, type Fonts } from './pdf-graphics.js';
import { drawPlanSheet, type EmbeddedPlan, type TitleBlock } from './plan-sheet.js';
import { ReportWriter } from './report-writer.js';
import { dxfFileName, floorToDxf } from './dxf.js';
import { zip } from './zip.js';
import { money, n0, n1, n2, q, tr } from './export-lang.js';


/** Builds the project PDF: vector floor plans over the original plan pages, schedules, BOM and costs. */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly installation: InstallationService,
    private readonly pricing: PricingService,
  ) {}

  /** Interface language of a user (Albanian unless they chose English). */
  async userLanguage(userId: string): Promise<'sq' | 'en'> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { language: true } });
    return u?.language === 'en' ? 'en' : 'sq';
  }

  async exportProject(organizationId: string, projectId: string, opts: ExportOptions): Promise<{ bytes: Uint8Array; fileName: string }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      include: {
        client: { select: { name: true } },
        organization: { select: { name: true, settings: true } },
        floors: { orderBy: { sortOrder: 'asc' }, include: { planFile: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found.');
    const [inst, materials, rules] = await Promise.all([
      this.installation.get(organizationId, projectId),
      this.pricing.listMaterials(organizationId),
      this.pricing.listRules(organizationId),
    ]);
    const org = readOrganizationSettings(project.organization.settings);
    const date = new Date().toISOString().slice(0, 10);
    const sections = new Set(opts.sections);
    const hidden = new Set<LayerKey>(opts.hiddenLayers);
    const floorOrder = opts.floorIds.length ? opts.floorIds : inst.floors.map((f) => f.floorId);
    const floors = floorOrder.map((id) => inst.floors.find((f) => f.floorId === id)).filter((f) => !!f);

    const doc = await PDFDocument.create();
    doc.setTitle(tr(`${project.name} – electrical installation`));
    doc.setAuthor(project.organization.name);
    doc.setCreator('Electro House');
    doc.setProducer('Electro House');
    const fonts = await embedFonts(doc);
    const logo = await this.embedLogo(doc, org.logoDataUrl);
    const w = new ReportWriter(doc, fonts, `${project.name} · ${project.client.name}`);
    const title: TitleBlock = {
      company: project.organization.name,
      companyLines: [org.company.address, [org.company.phone, org.company.email].filter(Boolean).join(' · '), org.company.website].filter(Boolean),
      logo,
      project: project.name,
      client: project.client.name,
      address: project.propertyAddress ?? '',
      date,
    };

    if (sections.has('cover')) this.cover(w, title, project.description, floors.map((f) => f.name), opts, logo);

    if (sections.has('floors')) {
      const plans = await this.embedPlans(doc, project.floors);
      floors.forEach((f, i) => {
        const dbFloor = project.floors.find((x) => x.id === f.floorId)!;
        const embedded = plans.get(f.floorId);
        drawPlanSheet(doc, fonts, {
          floor: f,
          plan: embedded && 'page' in embedded ? embedded : null,
          planProblem: embedded && 'problem' in embedded ? embedded.problem : null,
          viewRotation: normalizeRotation(dbFloor.planRotation) as PlanRotation,
          paper: opts.paper,
          orientation: opts.orientation,
          hiddenLayers: hidden,
          title,
          sheetNumber: i + 1,
          sheetCount: floors.length,
        });
      });
    }

    if (sections.has('legend')) this.legend(w, fonts, floors, hidden);
    const loads = circuitLoads(inst);
    if (sections.has('circuits')) this.circuits(w, inst, loads);
    if (sections.has('boards')) this.boards(w, inst, loads);
    if (sections.has('links')) this.links(w, inst);

    const eff = effectiveCostSettings(org, inst.costSettings);
    const t = takeoff(inst, eff.allowances);
    const bomOpts = { allowances: eff.allowances, roundToPacks: eff.roundToPacks };
    const projectBom = buildBom(t, materials, rules, bomOpts);
    if (sections.has('bom')) {
      w.startSection(EXPORT_SECTION_NAMES.bom);
      const groups =
        opts.bomGrouping === 'project'
          ? [{ id: 'project', name: '', bom: projectBom }]
          : groupTakeoff(t, inst, opts.bomGrouping).map((g) => ({ id: g.id, name: g.name, bom: buildBom(g.takeoff, materials, rules, bomOpts) }));
      w.paragraph(
        `Cable lengths: measured from the calibrated plans, plus vertical drops to mounting heights, reserves of ${eff.allowances.endReserveM} m per connection ` +
          `and ${eff.allowances.boardTailM} m at distribution boards, plus ${eff.allowances.wastePct} % waste. Prices are net, in ${eff.currency}.`,
        { muted: true, size: 8.5 },
      );
      for (const g of groups) {
        if (g.name) w.heading(g.name);
        if (g.bom.cables.length) {
          w.table(
            [
              { label: 'Cable', width: 30 },
              { label: 'Runs', width: 8, align: 'right' },
              { label: 'Measured m', width: 12, align: 'right' },
              { label: 'Drops m', width: 11, align: 'right' },
              { label: 'Reserves m', width: 12, align: 'right' },
              { label: 'Waste m', width: 11, align: 'right' },
              { label: 'Total m', width: 11, align: 'right' },
            ],
            g.bom.cables.map((c) => [
              c.unknownRuns ? `${c.key} (${c.unknownRuns} not measured)` : c.key,
              String(c.runs),
              n1(c.measuredM),
              n1(c.dropsM),
              n1(c.terminationsM),
              n1(c.wasteM),
              n1(c.totalM),
            ]),
          );
        }
        if (g.bom.lines.length) {
          const rows = g.bom.lines.map((l) => [
            l.material.code ?? '',
            l.material.name,
            q(l.quantity),
            l.packs !== null ? `${l.packs} × ${q(l.material.packSize!)}` : '',
            l.material.unit,
            n2(l.material.unitPrice),
            n2(l.total),
          ]);
          rows.push(['', 'Materials (net)', '', '', '', '', n2(g.bom.materialsNet)]);
          w.table(
            [
              { label: 'Code', width: 13 },
              { label: 'Material', width: 37 },
              { label: 'Needed', width: 10, align: 'right' },
              { label: 'Packs', width: 11, align: 'right' },
              { label: 'Unit', width: 7 },
              { label: 'Unit price', width: 11, align: 'right' },
              { label: 'Total', width: 11, align: 'right' },
            ],
            rows,
            { boldRows: new Set([rows.length - 1]) },
          );
        } else {
          w.paragraph('No priced materials.', { muted: true });
        }
      }
      if (projectBom.unmapped.length) {
        w.heading('Not priced (no material rule)', 10);
        w.paragraph(projectBom.unmapped.map((u) => `${tr(u.label)}: ${q(u.quantity)} ${tr(u.unit)}`).join(' · '), { warn: true, size: 8.5 });
      }
      if (projectBom.unknownRuns) {
        w.paragraph(`${projectBom.unknownRuns} wire(s) are on floors without a scale calibration; their length is not included.`, { warn: true, size: 8.5 });
      }
    }

    if (sections.has('costs')) {
      const s = costSummary(projectBom, eff, inst.costSettings);
      w.startSection(EXPORT_SECTION_NAMES.costs);
      const rows: string[][] = [
        ['Materials', money(s.materialsNet, s.currency)],
        [`Markup on materials (${s.markupPct} %)`, money(s.markup, s.currency)],
        [`Labour (${q(s.ruleHours + s.extraHours)} h × ${n2(s.hourlyRate)})`, money(s.labour, s.currency)],
        ...s.extraLines.map((l) => [l.text, money(l.amount, s.currency)]),
        ['Total net', money(s.net, s.currency)],
        [`VAT (${s.vatPct} %)`, money(s.vat, s.currency)],
        ['Total', money(s.gross, s.currency)],
      ];
      w.table([{ label: 'Item', width: 70 }, { label: 'Amount', width: 30, align: 'right' }], rows, {
        size: 10,
        boldRows: new Set([rows.length - 3, rows.length - 1]),
      });
      if (projectBom.unmapped.length) {
        w.paragraph(`${projectBom.unmapped.length} item type(s) have no material rule and are not included in the materials amount.`, { warn: true });
      }
      w.paragraph(s.note, { muted: true });
    }

    if (sections.has('checks')) this.checks(w, inst, materials, rules);

    if (doc.getPageCount() === 0) w.startSection('Electrical installation');
    w.finish(`${project.organization.name} · ${project.name} · ${date}`);
    const bytes = await doc.save();
    const slug = project.name.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'project';
    return { bytes, fileName: `${slug}-electrical.pdf` };
  }

  /** One floor as DXF, or every floor in a ZIP. Reading only: works while read-only too. */
  async exportDxf(organizationId: string, projectId: string, floorId: string | null): Promise<{ bytes: Buffer; fileName: string; contentType: string }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { name: true, organization: { select: { name: true } } },
    });
    if (!project) throw new NotFoundException('Project not found.');
    const inst = await this.installation.get(organizationId, projectId);
    const render = (f: InstallationDto['floors'][number]) =>
      Buffer.from(floorToDxf({ floor: f, projectName: project.name, companyName: project.organization.name }), 'utf8');
    if (floorId) {
      const floor = inst.floors.find((f) => f.floorId === floorId);
      if (!floor) throw new NotFoundException('Floor not found.');
      return { bytes: render(floor), fileName: dxfFileName(floor.name), contentType: 'application/dxf' };
    }
    if (!inst.floors.length) throw new NotFoundException('The project has no floors.');
    const slug = project.name.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'project';
    return {
      bytes: zip(inst.floors.map((f, i) => ({ name: `${String(i + 1).padStart(2, '0')}-${dxfFileName(f.name)}`, data: render(f) }))),
      fileName: `${slug}-dxf.zip`,
      contentType: 'application/zip',
    };
  }

  // ── sections ──

  private cover(w: ReportWriter, t: TitleBlock, description: string | null, floorNames: string[], opts: ExportOptions, logo: PDFImage | null): void {
    w.startSection('Electrical installation');
    if (logo) {
      const s = Math.min((22 * MM) / logo.height, (70 * MM) / logo.width);
      w.page.drawImage(logo, { x: w.left, y: w.y - logo.height * s, width: logo.width * s, height: logo.height * s });
      w.space(logo.height * s + 8 * MM);
    }
    w.paragraph(t.project, { size: 20, bold: true });
    w.space(4);
    w.keyValues([
      ['Client', t.client],
      ['Property address', t.address],
      ['Floors', floorNames.join(', ')],
      ['Date', t.date],
      ['Prepared by', [t.company, ...t.companyLines].join('\n')],
    ]);
    if (description) w.paragraph(description, { muted: true });
    w.heading('Contents', 10.5);
    w.paragraph(opts.sections.filter((s) => s !== 'cover').map((s) => tr(EXPORT_SECTION_NAMES[s])).join(' · '));
    if (opts.hiddenLayers.length) {
      w.paragraph(tr('Layers not shown on the plans: {l}.').replace('{l}', opts.hiddenLayers.map((l) => tr(LAYER_NAMES[l])).join(', ')), { muted: true, size: 8.5 });
    }
    w.space(6);
    w.paragraph(
      'Loads, currents and quantities are planning estimates calculated from the drawings and the rules entered by the electrician. ' +
        'They are not a certified design calculation; verify against the applicable standards before installation.',
      { muted: true, size: 8 },
    );
  }

  private legend(w: ReportWriter, fonts: Fonts, floors: InstallationDto['floors'], hidden: ReadonlySet<LayerKey>): void {
    const counts = new Map<string, { count: number; layer: LayerKey }>();
    for (const f of floors) {
      for (const c of f.components) {
        if (hidden.has(c.layerKey as LayerKey)) continue;
        const e = counts.get(c.typeKey) ?? { count: 0, layer: c.layerKey as LayerKey };
        e.count++;
        counts.set(c.typeKey, e);
      }
    }
    const items = [...counts]
      .map(([typeKey, e]) => ({ typeKey, ...e, type: componentType(typeKey) }))
      .sort((a, b) => (a.type?.category ?? '').localeCompare(b.type?.category ?? '') || (a.type?.name ?? '').localeCompare(b.type?.name ?? ''));
    w.startSection(EXPORT_SECTION_NAMES.legend);
    if (!items.length) return w.paragraph('No components on the exported floors.', { muted: true });
    w.table(
      [
        { label: 'Symbol', width: 14 },
        { label: 'Name', width: 40 },
        { label: 'Category', width: 28 },
        { label: 'Count', width: 10, align: 'right' },
      ],
      items.map((i) => ['', i.type?.name ?? i.typeKey, i.type ? CATEGORY_NAMES[i.type.category] : '', String(i.count)]),
      {
        size: 9,
        minRowHeight: 13 * MM,
        drawCell: (row, col, page, x, top, cw, h) => {
          if (col !== 0) return;
          const item = items[row]!;
          // Symbols are drawn in paper mm around (0,0); 1.4× makes small symbols readable in the table.
          const s = MM * 1.4;
          page.pushOperators(
            pushGraphicsState(),
            cm({ a: s, b: 0, c: 0, d: -s, e: x + cw / 2, f: top - h / 2 }),
            ...symbolOps(page, fonts, item.typeKey, LAYER_COLORS[item.layer] ?? '#111827'),
            popGraphicsState(),
          );
        },
      },
    );
  }

  private circuits(w: ReportWriter, inst: InstallationDto, loads: ReturnType<typeof circuitLoads>): void {
    w.startSection(EXPORT_SECTION_NAMES.circuits, true);
    if (!loads.length) return w.paragraph('No circuits.', { muted: true });
    const boardName = this.boardNames(inst);
    const sorted = [...loads].sort((a, b) => a.circuit.number.localeCompare(b.circuit.number, undefined, { numeric: true }));
    w.table(
      [
        { label: 'No.', width: 5 },
        { label: 'Circuit', width: 17 },
        { label: 'Category', width: 10 },
        { label: 'Board', width: 10 },
        { label: 'Phase', width: 7 },
        { label: 'Protection', width: 10 },
        { label: 'RCD', width: 10 },
        { label: 'Cable', width: 11 },
        { label: 'Items', width: 5, align: 'right' },
        { label: 'Load W', width: 7, align: 'right' },
        { label: 'Ib A', width: 6, align: 'right' },
        { label: 'Cable m', width: 7, align: 'right' },
      ],
      sorted.map((l) => {
        const c = l.circuit;
        return [
          c.number,
          c.name,
          c.category,
          c.boardComponentId ? (boardName.get(c.boardComponentId) ?? '?') : '—',
          c.phase,
          `${c.protection} ${c.breakerCurve ?? ''}${c.breakerRatingA ? `${c.breakerRatingA} A` : ''}`.trim(),
          c.rcdGroup ? `${c.rcdGroup}${c.residualCurrentMa ? ` ${c.residualCurrentMa} mA` : ''}` : '—',
          [c.cableType, c.crossSectionMm2 ? `${c.crossSectionMm2} mm²` : ''].filter(Boolean).join(' '),
          String(l.componentCount),
          n0(l.loadW),
          l.designCurrentA === null ? '—' : n1(l.designCurrentA),
          n1(l.cableM),
        ];
      }),
    );
    const warned = sorted.filter((l) => l.warnings.length);
    if (warned.length) {
      w.heading('Notes', 10);
      for (const l of warned) w.paragraph(`${l.circuit.number} ${l.circuit.name}: ${l.warnings.join(' ')}`, { warn: true, size: 8.5 });
    }
  }

  private boards(w: ReportWriter, inst: InstallationDto, loads: ReturnType<typeof circuitLoads>): void {
    const schedules = boardSchedules(inst, loads);
    w.startSection(EXPORT_SECTION_NAMES.boards, true);
    if (!schedules.length) return w.paragraph('No distribution boards on the plans.', { muted: true });
    const pf = inst.profile.powerFactor || 1;
    for (const s of schedules) {
      w.heading(`${s.board.label ?? 'Board'} · ${componentType(s.board.typeKey)?.name ?? ''} · ${s.floorName}`);
      const phase = (['L1', 'L2', 'L3'] as const).map((p) => `${p} ${n2(s.phaseLoadW[p] / 1000)} kW ≈ ${n1(s.phaseLoadW[p] / (230 * pf))} A`).join('   ');
      w.paragraph(`${s.circuits.length} circuit(s), connected load ${n2(s.totalLoadW / 1000)} kW.   ${phase}`, { size: 8.5, muted: true });
      if (!s.circuits.length) continue;
      w.table(
        [
          { label: 'No.', width: 6 },
          { label: 'Circuit', width: 24 },
          { label: 'Phase', width: 8 },
          { label: 'Protection', width: 12 },
          { label: 'RCD', width: 12 },
          { label: 'Cable', width: 14 },
          { label: 'Load W', width: 8, align: 'right' },
          { label: 'Ib A', width: 7, align: 'right' },
          { label: 'Cable m', width: 9, align: 'right' },
        ],
        s.circuits.map((l) => {
          const c = l.circuit;
          return [
            c.number,
            c.name,
            c.phase,
            `${c.protection} ${c.breakerCurve ?? ''}${c.breakerRatingA ? `${c.breakerRatingA} A` : ''}`.trim(),
            c.rcdGroup ? `${c.rcdGroup}${c.residualCurrentMa ? ` ${c.residualCurrentMa} mA` : ''}` : '—',
            [c.cableType, c.crossSectionMm2 ? `${c.crossSectionMm2} mm²` : ''].filter(Boolean).join(' '),
            n0(l.loadW),
            l.designCurrentA === null ? '—' : n1(l.designCurrentA),
            n1(l.cableM),
          ];
        }),
      );
    }
    w.paragraph('Phase currents ≈ load / (230 V · cos φ). Planning estimates only.', { muted: true, size: 8 });
  }

  private links(w: ReportWriter, inst: InstallationDto): void {
    w.startSection(EXPORT_SECTION_NAMES.links);
    if (!inst.links.length) return w.paragraph('No connections between floors.', { muted: true });
    const name = new Map<string, string>();
    for (const f of inst.floors) for (const c of f.components) name.set(c.id, `${c.label ?? componentType(c.typeKey)?.name ?? '?'} (${f.name})`);
    const circuit = new Map(inst.circuits.map((c) => [c.id, `${c.number} ${c.name}`]));
    w.table(
      [
        { label: 'From', width: 26 },
        { label: 'To', width: 26 },
        { label: 'Cable', width: 20 },
        { label: 'Length m', width: 10, align: 'right' },
        { label: 'Circuit', width: 18 },
      ],
      inst.links.map((l) => [
        name.get(l.fromComponentId) ?? '?',
        name.get(l.toComponentId) ?? '?',
        [l.cable.cableType, l.cable.conductors && l.cable.crossSectionMm2 ? `${l.cable.conductors}×${l.cable.crossSectionMm2} mm²` : ''].filter(Boolean).join(' '),
        n1(l.lengthM),
        l.circuitId ? (circuit.get(l.circuitId) ?? '') : '—',
      ]),
    );
  }

  private checks(w: ReportWriter, inst: InstallationDto, materials: MaterialDto[], rules: MaterialRuleDto[]): void {
    const { open, summary } = applyIgnored(runChecks(inst, { materials, rules }), inst.ignoredIssues);
    w.startSection(EXPORT_SECTION_NAMES.checks);
    w.paragraph(
      `${summary.error} error(s), ${summary.warning} warning(s), ${summary.info} note(s)` +
        (summary.ignored ? `; ${summary.ignored} issue(s) marked as ignored are not listed.` : '.') +
        ' Checks are planning aids based on the drawings and the limits in the rules profile, not a certification.',
      { muted: true, size: 8.5 },
    );
    if (!open.length) return w.paragraph('No open issues.');
    const floorName = new Map(inst.floors.map((f) => [f.floorId, f.name]));
    w.table(
      [
        { label: 'Severity', width: 11 },
        { label: 'Check', width: 24 },
        { label: 'Where', width: 15 },
        { label: 'Issue', width: 50 },
      ],
      open.map((i) => [
        i.severity === 'error' ? 'Error' : i.severity === 'warning' ? 'Warning' : 'Info',
        CHECKS[i.code],
        i.floorId ? (floorName.get(i.floorId) ?? '') : 'Project',
        i.message,
      ]),
      { boldRows: new Set(open.map((i, n) => (i.severity === 'error' ? n : -1)).filter((n) => n >= 0)) },
    );
  }

  // ── helpers ──

  private boardNames(inst: InstallationDto): Map<string, string> {
    const m = new Map<string, string>();
    for (const f of inst.floors) for (const c of f.components) if (c.typeKey.startsWith('board.')) m.set(c.id, c.label ?? 'Board');
    return m;
  }

  private async embedLogo(doc: PDFDocument, dataUrl: string | null): Promise<PDFImage | null> {
    if (!dataUrl) return null;
    try {
      const [head, b64] = dataUrl.split(',', 2);
      const bytes = Buffer.from(b64 ?? '', 'base64');
      return head?.includes('image/png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch (err) {
      this.logger.warn(`Logo could not be embedded: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Embeds each floor's plan page once per file as a vector XObject. A file that cannot be read
   * (damaged, encrypted) gives a note on the sheet instead of failing the whole export.
   */
  private async embedPlans(
    doc: PDFDocument,
    floors: { id: string; planPage: number; planFile: { id: string; storageKey: string } | null }[],
  ): Promise<Map<string, EmbeddedPlan | { problem: string }>> {
    const out = new Map<string, EmbeddedPlan | { problem: string }>();
    const sources = new Map<string, Promise<PDFDocument>>();
    for (const f of floors) {
      if (!f.planFile) continue;
      const file = f.planFile;
      try {
        let src = sources.get(file.id);
        if (!src) {
          src = this.storage.get(file.storageKey).then((bytes) => PDFDocument.load(bytes, { updateMetadata: false }));
          sources.set(file.id, src);
        }
        const srcPage = (await src).getPage(f.planPage - 1);
        const crop = srcPage.getCropBox();
        const media = srcPage.getMediaBox();
        const left = Math.max(crop.x, media.x);
        const bottom = Math.max(crop.y, media.y);
        const right = Math.min(crop.x + crop.width, media.x + media.width);
        const top = Math.min(crop.y + crop.height, media.y + media.height);
        const page = await doc.embedPage(srcPage, { left, bottom, right, top });
        out.set(f.id, { page, width: right - left, height: top - bottom, rotate: normalizeRotation(srcPage.getRotation().angle) as PlanRotation });
      } catch (err) {
        this.logger.warn(`Plan of floor ${f.id} could not be embedded: ${(err as Error).message}`);
        out.set(f.id, { problem: 'The plan PDF could not be embedded (damaged or protected file); only the electrical drawing is shown.' });
      }
    }
    return out;
  }
}
