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
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { MAX_PLAN_FILE_BYTES, PLAN_ROTATIONS, type Calibration, type ProjectDto } from '@electro/shared';
import { Api } from '../../core/api';
import { errorMessage, toApiError } from '../../core/api-error';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/states';
import { CalibrationPanel } from './panels/calibration-panel';
import { MeasurePanel } from './panels/measure-panel';
import { openPdf, planPageSize, type OpenedPdf } from './pdf/pdf-document';
import { FloorSync, type SaveStatus } from './state/floor-sync';
import { browserJournal } from './state/journal';
import { ToolsStore, type ToolId } from './state/tools.store';
import { ViewportStore } from './viewport/viewport.store';
import { Workspace } from './workspace';

interface EditorSession {
  sync: FloorSync;
  pdf: OpenedPdf | null;
}

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: 'All changes saved',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  offline: 'Offline, saved on this device',
  error: 'Not saved',
};

const GRID_KEY = 'eh.grid';

@Component({
  selector: 'app-editor-page',
  imports: [RouterLink, Workspace, CalibrationPanel, MeasurePanel, LoadingState, ErrorState, EmptyState],
  providers: [ViewportStore, ToolsStore],
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

  readonly projectId = input.required<string>();
  readonly floorId = input.required<string>();

  protected readonly project = httpResource<ProjectDto>(() => `/api/projects/${this.projectId()}`);

  /** Floor + PDF for the current route. Re-runs when the floor changes; the previous one is flushed and closed. */
  protected readonly session = resource<EditorSession, string>({
    params: () => this.floorId(),
    loader: async ({ params: floorId }) => {
      await this.closeCurrent();
      this.viewport.reset();
      this.tools.setTool('pan');
      this.pdfProgress.set(null);
      const floor = await this.api.getFloor(floorId);
      const sync = new FloorSync(floor, this.api, browserJournal());
      let pdf: OpenedPdf | null = null;
      if (floor.planFile) {
        const { url } = await this.api.planUrl(floorId);
        this.pdfProgress.set(0);
        pdf = await openPdf(url, (f) => this.pdfProgress.set(f));
      }
      this.current = { sync, pdf };
      await sync.recover();
      return this.current;
    },
  });

  protected readonly floor = computed(() => (this.session.hasValue() ? this.session.value().sync.floor() : null));
  protected readonly sync = computed(() => (this.session.hasValue() ? this.session.value().sync : null));
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
  protected readonly renderError = signal<string | null>(null);
  protected readonly uploadState = signal<{ progress: number } | null>(null);
  protected readonly uploadError = signal<string | null>(null);
  protected readonly saveLabel = computed(() => {
    const s = this.sync();
    return s ? SAVE_LABEL[s.status()] : '';
  });
  protected readonly rotations = PLAN_ROTATIONS;
  protected readonly pageNumbers = computed(() => {
    const s = this.session.hasValue() ? this.session.value() : null;
    return s?.pdf ? Array.from({ length: s.pdf.doc.numPages }, (_, i) => i + 1) : [];
  });

  private current: EditorSession | null = null;
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

    const onFs = () => this.isFullscreen.set(document.fullscreenElement === this.host);
    document.addEventListener('fullscreenchange', onFs);
    const onOnline = () => void this.current?.sync.flush();
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

  // ── View ──

  protected setTool(tool: ToolId): void {
    this.tools.setTool(tool);
  }

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
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tool = this.tools.tool();
    switch (e.key) {
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
      case 'f':
      case 'F':
        this.viewport.fit();
        break;
      case 'r':
        this.rotate(90);
        break;
      case 'R':
        this.rotate(-90);
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
        break;
      case 'Backspace':
        if (tool === 'measure') this.tools.undoMeasurePoint();
        if (tool === 'calibrate') this.tools.resetCalibration();
        break;
      case 'Escape':
        if (tool === 'measure' && this.tools.measurePoints().length) this.tools.clearMeasure();
        else if (tool !== 'pan') this.setTool('pan');
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    const s = this.current?.sync;
    if (s && s.status() !== 'saved') {
      void s.flush();
      // Changes are in the journal and will be restored, but warn so the user can wait for the save.
      e.preventDefault();
    }
  }

  private async closeCurrent(): Promise<void> {
    const c = this.current;
    this.current = null;
    if (!c) return;
    await c.sync.flush().catch(() => undefined);
    c.sync.dispose();
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
