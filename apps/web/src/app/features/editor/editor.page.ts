import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import {
  MAX_PLAN_FILE_BYTES,
  MM_TO_PT,
  PLAN_ROTATIONS,
  formatMetres,
  relabelCopies,
  uuidv7,
  syncEnds,
  wireLengthUnits,
  type WireDto,
  type WireEndDto,
  type Calibration,
  type ComponentDto,
  type InstallationDto,
  type ProjectDto,
} from '@electro/shared';
import { Api } from '../../core/api';
import { errorMessage, toApiError } from '../../core/api-error';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/states';
import { SymbolDefs } from './drawing/symbol-defs';
import { CalibrationPanel } from './panels/calibration-panel';
import { LayersPanel } from './panels/layers-panel';
import { LibraryPanel } from './panels/library-panel';
import { MeasurePanel } from './panels/measure-panel';
import { PropertiesPanel } from './panels/properties-panel';
import { WirePanel } from './panels/wire-panel';
import { CircuitsPanel } from './panels/circuits-panel';
import { openPdf, planPageSize, type OpenedPdf } from './pdf/pdf-document';
import { DrawingSync } from './state/drawing-sync';
import { DrawingStore } from './state/drawing.store';
import { FloorSync, type SaveStatus } from './state/floor-sync';
import { browserJournal } from './state/journal';
import { ToolsStore, type ToolId } from './state/tools.store';
import { ViewportStore } from './viewport/viewport.store';
import { Workspace } from './workspace';

interface EditorSession {
  sync: FloorSync;
  drawingSync: DrawingSync;
  pdf: OpenedPdf | null;
}

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: 'All changes saved',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  offline: 'Offline, saved on this device',
  error: 'Not saved',
};
const SAVE_RANK: Record<SaveStatus, number> = { saved: 0, pending: 1, saving: 2, offline: 3, error: 4 };

const GRID_KEY = 'eh.grid';

/** In-memory clipboard shared by all floors in this browser tab. */
let clipboard: { components: ComponentDto[]; wires: WireDto[] } = { components: [], wires: [] };

@Component({
  selector: 'app-editor-page',
  imports: [
    RouterLink,
    Workspace,
    CalibrationPanel,
    MeasurePanel,
    LibraryPanel,
    LayersPanel,
    PropertiesPanel,
    WirePanel,
    CircuitsPanel,
    SymbolDefs,
    LoadingState,
    ErrorState,
    EmptyState,
  ],
  providers: [ViewportStore, ToolsStore, DrawingStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor.page.html',
  styleUrl: './editor.page.css',
  host: { '(window:keydown)': 'onKey($event)', '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class EditorPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly viewport = inject(ViewportStore);
  protected readonly tools = inject(ToolsStore);
  protected readonly drawing = inject(DrawingStore);
  private readonly workspace = viewChild<Workspace>('ws');

  readonly projectId = input.required<string>();
  readonly floorId = input.required<string>();

  protected readonly project = httpResource<ProjectDto>(() => `/api/projects/${this.projectId()}`);
  /** Whole-project electrical data: circuits and distribution boards on every floor. */
  protected readonly installation = httpResource<InstallationDto>(() => `/api/projects/${this.projectId()}/installation`);

  /** Floor, its drawing and its PDF. Re-runs when the floor changes; the previous one is saved and closed first. */
  protected readonly session = resource<EditorSession, string>({
    params: () => this.floorId(),
    loader: async ({ params: floorId }) => {
      await this.closeCurrent();
      this.viewport.reset();
      this.drawing.reset();
      this.tools.setTool('select');
      this.pdfProgress.set(null);
      const [floor, drawingDto] = await Promise.all([this.api.getFloor(floorId), this.api.getDrawing(floorId)]);
      const sync = new FloorSync(floor, this.api, browserJournal());
      const drawingSync = new DrawingSync(floorId, drawingDto.revision, this.api, browserJournal(), (d, ops) =>
        this.drawing.replaceFromServer(d, ops),
      );
      let pdf: OpenedPdf | null = null;
      if (floor.planFile) {
        const { url } = await this.api.planUrl(floorId);
        this.pdfProgress.set(0);
        pdf = await openPdf(url, (f) => this.pdfProgress.set(f));
      }
      this.current = { sync, drawingSync, pdf };
      const recovered = await drawingSync.recover();
      this.drawing.load(drawingDto, drawingSync, recovered);
      await sync.recover();
      return this.current;
    },
  });

  protected readonly floor = computed(() => (this.session.hasValue() ? this.session.value().sync.floor() : null));
  protected readonly sync = computed(() => (this.session.hasValue() ? this.session.value().sync : null));
  private readonly drawingSync = computed(() => (this.session.hasValue() ? this.session.value().drawingSync : null));
  protected readonly locked = computed(() => this.floor()?.backgroundLocked ?? false);
  /** The lock protects an existing scale; a floor that was never calibrated can always be calibrated. */
  protected readonly calibrationLocked = computed(() => this.locked() && !!this.floor()?.calibration);
  protected readonly calibration = computed(() => this.floor()?.calibration ?? null);
  protected readonly pdfProgress = signal<number | null>(null);

  /** The PDF page currently used as this floor's plan. */
  protected readonly page = resource({
    params: () => {
      const s = this.session.hasValue() ? this.session.value() : null;
      const pageNo = this.floor()?.planPage;
      return s?.pdf && pageNo ? { doc: s.pdf.doc, pageNo: Math.min(pageNo, s.pdf.doc.numPages) } : undefined;
    },
    loader: ({ params }) => params.doc.getPage(params.pageNo),
  });

  protected readonly showGrid = signal(readGridPref());
  protected readonly isFullscreen = signal(false);
  protected readonly leftTab = signal<'library' | 'circuits' | 'layers'>('library');
  protected readonly renderError = signal<string | null>(null);
  protected readonly uploadState = signal<{ progress: number } | null>(null);
  protected readonly uploadError = signal<string | null>(null);
  /** Short-lived message after an action (e.g. "Undo: Move component"). */
  protected readonly toast = signal<string | null>(null);

  /** Combined save state of floor settings and drawing (the worse of the two). */
  protected readonly saveStatus = computed<SaveStatus | null>(() => {
    const a = this.sync()?.status();
    const b = this.drawingSync()?.status();
    if (!a || !b) return null;
    return SAVE_RANK[a] >= SAVE_RANK[b] ? a : b;
  });
  protected readonly saveLabel = computed(() => {
    const s = this.saveStatus();
    return s ? SAVE_LABEL[s] : '';
  });
  protected readonly saveMessage = computed(() => this.drawingSync()?.message() ?? this.sync()?.message() ?? null);
  protected readonly rotations = PLAN_ROTATIONS;
  protected readonly totalWireLength = computed(() => {
    const lookup = this.drawing.lookup();
    const units = this.drawing.wires().reduce((s, w) => s + wireLengthUnits(w, lookup), 0);
    const cal = this.calibration();
    return cal ? formatMetres(units * cal.metresPerUnit) : 'not calibrated';
  });
  protected readonly pageNumbers = computed(() => {
    const s = this.session.hasValue() ? this.session.value() : null;
    return s?.pdf ? Array.from({ length: s.pdf.doc.numPages }, (_, i) => i + 1) : [];
  });

  private current: EditorSession | null = null;
  private toastTimer?: ReturnType<typeof setTimeout>;
  protected message = errorMessage;

  constructor() {
    // Bridge the asynchronously loaded page into the viewport once the workspace has a size.
    effect(() => {
      const page = this.page.hasValue() ? this.page.value() : null;
      const size = this.viewport.size();
      const floor = untracked(this.floor);
      if (!page || !floor || size.width < 1) return;
      untracked(() => {
        const pageSize = planPageSize(page);
        if (this.viewport.view()) this.viewport.setPage(pageSize);
        else this.viewport.init(floor.id, pageSize, floor.planRotation);
      });
    });

    // Circuits and boards come from the whole project; boards on this floor come from the live drawing.
    effect(() => {
      const inst = this.installation.hasValue() ? this.installation.value() : null;
      const floorId = this.floorId();
      const here = this.drawing.components().filter((c) => c.typeKey.startsWith('board.'));
      untracked(() => {
        if (inst) this.drawing.circuits.set(inst.circuits);
        const others = (inst?.floors ?? [])
          .filter((f) => f.floorId !== floorId)
          .flatMap((f) => f.components.filter((c) => c.typeKey.startsWith('board.')).map((c) => ({ id: c.id, label: c.label ?? 'Board', floorName: f.name })));
        const floorName = this.floor()?.name ?? 'This floor';
        this.drawing.projectBoards.set([...here.map((c) => ({ id: c.id, label: c.label ?? 'Board', floorName })), ...others]);
      });
    });

    const onFs = () => this.isFullscreen.set(document.fullscreenElement === this.host);
    document.addEventListener('fullscreenchange', onFs);
    const onOnline = () => {
      void this.current?.sync.flush();
      void this.current?.drawingSync.flush();
    };
    window.addEventListener('online', onOnline);

    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('online', onOnline);
      void this.closeCurrent();
    });
  }

  // ── Floor settings (autosaved) ──

  protected rotate(delta: 90 | -90): void {
    const f = this.floor();
    if (!f) return;
    const next = ((((f.planRotation + delta) % 360) + 360) % 360) as (typeof PLAN_ROTATIONS)[number];
    this.sync()?.update({ planRotation: next });
    this.viewport.setRotation(next);
  }

  protected setPage(pageNo: number): void {
    const f = this.floor();
    if (!f || f.planPage === pageNo || this.locked()) return;
    this.sync()?.update({ planPage: pageNo, ...(f.calibration ? { calibrationNeedsCheck: true } : {}) });
  }

  protected toggleLock(): void {
    this.sync()?.update({ backgroundLocked: !this.locked() });
  }

  protected applyCalibration(c: Calibration): void {
    this.sync()?.update({ calibration: c, calibrationNeedsCheck: false });
  }

  protected confirmCalibration(): void {
    this.sync()?.update({ calibrationNeedsCheck: false });
  }

  // ── Drawing ──

  protected setTool(tool: ToolId): void {
    this.tools.setTool(tool);
  }

  protected undo(): void {
    const label = this.drawing.undo();
    this.flash(label ? `Undo: ${label}` : 'Nothing to undo');
  }

  protected redo(): void {
    const label = this.drawing.redo();
    this.flash(label ? `Redo: ${label}` : 'Nothing to redo');
  }

  /** Selected components plus selected wires, deep-copied with wire ends resolved to positions. */
  private selectionSnapshot(): { components: ComponentDto[]; wires: WireDto[] } {
    const lookup = this.drawing.lookup();
    return {
      components: this.drawing.selected().map((c) => structuredClone(c)),
      wires: this.drawing.selectedWires().map((w) => syncEnds(structuredClone(w), lookup)),
    };
  }

  private copySelection(): void {
    const snap = this.selectionSnapshot();
    const n = snap.components.length + snap.wires.length;
    if (!n) return;
    clipboard = snap;
    this.flash(`Copied ${n} object${n === 1 ? '' : 's'}`);
  }

  /**
   * New copies of components and wires, moved by (dx, dy), with new ids and labels. Wire ends that were
   * connected to a copied component connect to its copy; ends connected to anything else become free ends.
   */
  private cloneSet(
    src: { components: ComponentDto[]; wires: WireDto[] },
    dx: number,
    dy: number,
    existing: readonly ComponentDto[],
  ): { components: ComponentDto[]; wires: WireDto[] } {
    const idMap = new Map<string, string>();
    const comps = src.components.map((c) => {
      const id = uuidv7();
      idMap.set(c.id, id);
      return { ...structuredClone(c), id, x: c.x + dx, y: c.y + dy };
    });
    const shiftEnd = (e: WireEndDto): WireEndDto => {
      const mapped = e.componentId ? idMap.get(e.componentId) : undefined;
      return mapped
        ? { componentId: mapped, portId: e.portId, x: e.x + dx, y: e.y + dy }
        : { componentId: null, portId: null, x: e.x + dx, y: e.y + dy };
    };
    const wires = src.wires.map((w) => ({
      ...structuredClone(w),
      id: uuidv7(),
      from: shiftEnd(w.from),
      to: shiftEnd(w.to),
      points: w.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    }));
    return { components: relabelCopies(comps, existing), wires };
  }

  /** Pastes the clipboard centred on the cursor, or offset by 5 mm if the cursor is not over the plan. */
  private paste(): void {
    const src = clipboard;
    const pts = [...src.components.map((c) => ({ x: c.x, y: c.y })), ...src.wires.flatMap((w) => [w.from, w.to])];
    if (!pts.length) return;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const cursor = this.tools.cursor();
    const dx = cursor ? cursor.x - cx : 5 * MM_TO_PT;
    const dy = cursor ? cursor.y - cy : 5 * MM_TO_PT;
    const copy = this.cloneSet(src, dx, dy, this.drawing.components());
    const n = copy.components.length + copy.wires.length;
    this.drawing.add(copy.components, n === 1 ? 'Paste' : `Paste ${n} objects`, copy.wires);
  }

  private duplicate(): void {
    const snap = this.selectionSnapshot();
    const n = snap.components.length + snap.wires.length;
    if (!n) return;
    const offset = 5 * MM_TO_PT;
    const copy = this.cloneSet(snap, offset, offset, this.drawing.components());
    this.drawing.add(copy.components, n === 1 ? 'Duplicate' : `Duplicate ${n} objects`, copy.wires);
  }

  /** Copies the selection to the same position on another floor (saved directly to that floor). */
  protected async copyToFloor(targetId: string): Promise<void> {
    const snap = this.selectionSnapshot();
    const n = snap.components.length + snap.wires.length;
    if (!n) return;
    const target = this.project.hasValue() ? this.project.value().floors.find((f) => f.id === targetId) : undefined;
    try {
      const d = await this.api.getDrawing(targetId);
      const copy = this.cloneSet(snap, 0, 0, d.components);
      const ops = [
        ...copy.components.map((component) => ({ op: 'upsert' as const, component })),
        ...copy.wires.map((wire) => ({ op: 'upsertWire' as const, wire })),
      ];
      await this.api.patchDrawing(targetId, { baseRevision: d.revision, ops });
      this.flash(`Copied ${n} object${n === 1 ? '' : 's'} to ${target?.name ?? 'the other floor'}`);
    } catch (err) {
      this.flash(`Copy failed: ${toApiError(err).message}`);
    }
  }

  private flash(text: string): void {
    this.toast.set(text);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 2200);
  }

  // ── View ──

  protected toggleGrid(): void {
    this.showGrid.update((v) => !v);
    try {
      localStorage.setItem(GRID_KEY, this.showGrid() ? '1' : '0');
    } catch {
      /* preference only */
    }
  }

  protected async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.host.requestFullscreen();
    } catch {
      // Fullscreen can be refused by the browser; the editor keeps working normally.
    }
  }

  protected switchFloor(floorId: string): void {
    if (floorId !== this.floorId()) void this.router.navigate(['/projects', this.projectId(), 'floors', floorId]);
  }

  // ── Plan upload (floor without a plan) ──

  protected upload(inputEl: HTMLInputElement): void {
    const file = inputEl.files?.[0];
    inputEl.value = '';
    const floor = this.floor();
    if (!file || !floor) return;
    this.uploadError.set(null);
    if (file.size > MAX_PLAN_FILE_BYTES) {
      this.uploadError.set(`The file is larger than ${MAX_PLAN_FILE_BYTES / 1024 / 1024} MB.`);
      return;
    }
    this.uploadState.set({ progress: 0 });
    this.api.uploadPlan(floor.id, file).subscribe({
      next: (e) => this.uploadState.set({ progress: e.progress }),
      error: (err) => {
        this.uploadState.set(null);
        this.uploadError.set(toApiError(err).message);
      },
      complete: () => {
        this.uploadState.set(null);
        this.session.reload();
      },
    });
  }

  // ── Keyboard ──

  protected onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!this.floor()?.planFile) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && !e.altKey) {
      if (key === 'z' && !e.shiftKey) this.undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') this.redo();
      else if (key === 'c') this.copySelection();
      else if (key === 'x') {
        this.copySelection();
        this.drawing.deleteSelected();
      } else if (key === 'v') this.paste();
      else if (key === 'd') this.duplicate();
      else if (key === 'a') {
        this.setTool('select');
        this.drawing.select(this.drawing.selectable().map((c) => c.id));
      } else return;
      e.preventDefault();
      return;
    }
    if (e.altKey) return;

    const tool = this.tools.tool();
    const hasSel = this.drawing.selectionCount() > 0;
    switch (e.key) {
      case 'v':
      case 'V':
        this.setTool('select');
        break;
      case 'w':
      case 'W':
        this.setTool('wire');
        break;
      case 'h':
      case 'H':
        this.setTool('pan');
        break;
      case 'm':
      case 'M':
        this.setTool('measure');
        break;
      case 'c':
      case 'C':
        if (!this.calibrationLocked()) this.setTool('calibrate');
        break;
      case 'g':
      case 'G':
        this.toggleGrid();
        break;
      case 's':
      case 'S':
        this.tools.toggleSnap();
        this.flash(this.tools.snap() ? 'Snap to grid on' : 'Snap to grid off');
        break;
      case 'f':
      case 'F':
        this.viewport.fit();
        break;
      case 'r':
        if (hasSel) this.drawing.rotateSelected(90);
        break;
      case 'R':
        if (hasSel) this.drawing.rotateSelected(-90);
        break;
      case '+':
      case '=':
        this.viewport.zoomBy(1.25);
        break;
      case '-':
        this.viewport.zoomBy(0.8);
        break;
      case 'Enter':
        if (tool === 'measure') this.tools.finishMeasure();
        if (tool === 'wire') this.workspace()?.finishWire();
        break;
      case 'Delete':
        this.drawing.deleteSelected();
        break;
      case 'Backspace':
        if (tool === 'measure') this.tools.undoMeasurePoint();
        else if (tool === 'calibrate') this.tools.resetCalibration();
        else if (tool === 'wire') {
          const d = this.tools.wireDraft();
          if (d) this.tools.wireDraft.set(d.points.length ? { ...d, points: d.points.slice(0, -1) } : null);
        } else this.drawing.deleteSelected();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        if (!hasSel) return;
        this.nudge(e.key, e.shiftKey ? 10 : 1);
        break;
      case 'Escape':
        if (tool === 'measure' && this.tools.measurePoints().length) this.tools.clearMeasure();
        else if (tool === 'wire' && this.tools.wireDraft()) this.tools.wireDraft.set(null);
        else if (tool !== 'select') this.setTool('select');
        else this.drawing.clearSelection();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  /** Moves the selection by `mm` paper millimetres in the screen direction of the arrow key. */
  private nudge(key: string, mm: number): void {
    const step = mm * MM_TO_PT * (this.viewport.view()?.zoom ?? 1);
    const d = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } }[
      key as 'ArrowLeft'
    ];
    const a = this.viewport.toPlan({ x: 0, y: 0 });
    const b = this.viewport.toPlan(d);
    if (!a || !b) return;
    this.drawing.moveSelected(b.x - a.x, b.y - a.y, 'Nudge');
  }

  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    const c = this.current;
    if (!c) return;
    if (c.sync.status() !== 'saved' || c.drawingSync.status() !== 'saved') {
      void c.sync.flush();
      void c.drawingSync.flush();
      // Changes are in the journal and will be restored, but warn so the user can wait for the save.
      e.preventDefault();
    }
  }

  private async closeCurrent(): Promise<void> {
    const c = this.current;
    this.current = null;
    if (!c) return;
    await Promise.all([c.sync.flush().catch(() => undefined), c.drawingSync.flush().catch(() => undefined)]);
    c.sync.dispose();
    c.drawingSync.dispose();
    await c.pdf?.close().catch(() => undefined);
  }
}

function readGridPref(): boolean {
  try {
    return localStorage.getItem(GRID_KEY) !== '0';
  } catch {
    return true;
  }
}
