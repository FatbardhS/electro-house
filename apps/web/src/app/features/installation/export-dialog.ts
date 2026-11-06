import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_SECTIONS,
  EXPORT_SECTION_NAMES,
  LAYER_KEYS,
  LAYER_NAMES,
  PAPER_OPTIONS,
  applyIgnored,
  runChecks,
  exportOptionsSchema,
  type ExportOptions,
  type ExportSection,
  type InstallationDto,
  type LayerKey,
} from '@electro/shared';
import { Api } from '../../core/api';
import { toApiError } from '../../core/api-error';

const STORAGE_KEY = 'eh.export-options';

/** Options for the project PDF; generates it on the server and downloads it. */
@Component({
  selector: 'app-export-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let o = options();
    <div class="cols">
      <fieldset>
        <legend>Sections</legend>
        @for (s of sections; track s) {
          <label class="check"><input type="checkbox" [checked]="o.sections.includes(s)" (change)="toggleSection(s, $event)" /> {{ names[s] }}</label>
        }
      </fieldset>
      <fieldset [disabled]="!o.sections.includes('floors')">
        <legend>Floors</legend>
        @for (f of installation().floors; track f.floorId) {
          <label class="check"><input type="checkbox" [checked]="floorOn(f.floorId)" (change)="toggleFloor(f.floorId, $event)" /> {{ f.name }}</label>
        }
        <legend class="sub">Layers on the plans</legend>
        @for (l of layers; track l) {
          <label class="check"><input type="checkbox" [checked]="!o.hiddenLayers.includes(l)" (change)="toggleLayer(l, $event)" /> {{ layerNames[l] }}</label>
        }
      </fieldset>
      <fieldset>
        <legend>Paper</legend>
        <label class="f"><span>Floor plan sheets</span>
          <select class="input" (change)="patch({ paper: $any(val($event)) })">
            @for (p of papers; track p) { <option [value]="p" [selected]="p === o.paper">{{ p === 'plan' ? 'Same size as the plan' : p }}</option> }
          </select></label>
        <label class="f"><span>Orientation</span>
          <select class="input" (change)="patch({ orientation: $any(val($event)) })" [disabled]="o.paper === 'plan'">
            <option value="auto" [selected]="o.orientation === 'auto'">Automatic</option>
            <option value="landscape" [selected]="o.orientation === 'landscape'">Landscape</option>
            <option value="portrait" [selected]="o.orientation === 'portrait'">Portrait</option>
          </select></label>
        <label class="f"><span>Bill of materials grouped by</span>
          <select class="input" (change)="patch({ bomGrouping: $any(val($event)) })">
            <option value="project" [selected]="o.bomGrouping === 'project'">Whole project</option>
            <option value="floor" [selected]="o.bomGrouping === 'floor'">Floor</option>
            <option value="circuit" [selected]="o.bomGrouping === 'circuit'">Circuit</option>
          </select></label>
        <p class="faint small">Calibrated floors are printed at the next standard scale that fits (e.g. 1:100) with a scale bar.
          Schedules and reports use A4.</p>
      </fieldset>
    </div>
    <fieldset class="dxf">
      <legend>CAD drawing (DXF)</legend>
      <div class="dxf-row">
        <select class="input" (change)="dxfFloor.set(val($event))" aria-label="Floor for DXF">
          <option value="" [selected]="!dxfFloor()">All floors (ZIP, one DXF per floor)</option>
          @for (f of installation().floors; track f.floorId) { <option [value]="f.floorId" [selected]="f.floorId === dxfFloor()">{{ f.name }}</option> }
        </select>
        <button class="btn" type="button" (click)="downloadDxf()" [disabled]="busy() || installation().floors.length === 0">Download DXF</button>
      </div>
      <p class="faint small">Symbols as blocks, wires as polylines, one CAD layer per app layer; in metres when the floor has a scale.
        The architect's plan is not included: overlay it on their own CAD drawing.</p>
    </fieldset>
    @if (checkErrors(); as n) {
      <div class="banner banner-warn">⚠ The checks found {{ n }} error(s) in this project (see the Checks tab). You can still export.</div>
    }
    @if (error(); as e) { <div class="banner banner-error" role="alert">{{ e }}</div> }
    <div class="actions">
      <button class="btn" type="button" (click)="closed.emit()">Cancel</button>
      <button class="btn btn-primary" type="button" (click)="generate()" [disabled]="busy()">{{ busy() ? 'Generating…' : 'Download PDF' }}</button>
    </div>
  `,
  styles: `
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    fieldset { border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin: 0; min-width: 0; }
    fieldset:disabled { opacity: 0.5; }
    legend { font-size: 12px; font-weight: 700; color: var(--text-muted); padding: 0 4px; }
    legend.sub { margin-top: 10px; padding: 0; }
    .check { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 3px 0; }
    .f { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); margin-bottom: 10px; }
    .small { font-size: 12px; }
    .banner { margin-top: 12px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    .dxf { margin-top: 16px; }
    .dxf-row { display: flex; gap: 8px; margin: 4px 0 6px; }
    .dxf-row select { flex: 1; min-width: 0; }
  `,
})
export class ExportDialog {
  private readonly api = inject(Api);
  readonly installation = input.required<InstallationDto>();
  readonly projectName = input.required<string>();
  readonly closed = output<void>();

  protected readonly sections = EXPORT_SECTIONS;
  protected readonly names = EXPORT_SECTION_NAMES;
  protected readonly layers = LAYER_KEYS;
  protected readonly layerNames = LAYER_NAMES;
  protected readonly papers = PAPER_OPTIONS;
  protected readonly options = signal<ExportOptions>(this.restore());
  protected readonly checkErrors = computed(
    () => applyIgnored(runChecks(this.installation()), this.installation().ignoredIssues).summary.error,
  );
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Last used options (sections, paper, layers) are remembered in this browser; floors are per project. */
  private restore(): ExportOptions {
    try {
      const saved = exportOptionsSchema.safeParse({ ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'), floorIds: [] });
      return saved.success ? saved.data : DEFAULT_EXPORT_OPTIONS;
    } catch {
      return DEFAULT_EXPORT_OPTIONS;
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
  private on(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  protected patch(p: Partial<ExportOptions>): void {
    this.options.update((o) => ({ ...o, ...p }));
  }

  protected toggleSection(s: ExportSection, e: Event): void {
    const set = new Set(this.options().sections);
    if (this.on(e)) set.add(s);
    else set.delete(s);
    this.patch({ sections: EXPORT_SECTIONS.filter((x) => set.has(x)) });
  }

  /** An empty floor list means "all floors". */
  protected floorOn(id: string): boolean {
    const ids = this.options().floorIds;
    return ids.length === 0 || ids.includes(id);
  }

  protected toggleFloor(id: string, e: Event): void {
    const all = this.installation().floors.map((f) => f.floorId);
    const current = new Set(this.options().floorIds.length ? this.options().floorIds : all);
    if (this.on(e)) current.add(id);
    else current.delete(id);
    const ids = all.filter((f) => current.has(f));
    this.patch({ floorIds: ids.length === all.length ? [] : ids });
  }

  protected toggleLayer(l: LayerKey, e: Event): void {
    const hidden = new Set(this.options().hiddenLayers);
    if (this.on(e)) hidden.delete(l);
    else hidden.add(l);
    this.patch({ hiddenLayers: LAYER_KEYS.filter((x) => hidden.has(x)) });
  }

  protected async generate(): Promise<void> {
    const o = this.options();
    if (o.sections.includes('floors') && o.floorIds.length === 0 && this.installation().floors.length === 0) {
      this.error.set('The project has no floors to export.');
      return;
    }
    if (o.sections.includes('floors') && this.installation().floors.length > 0 && !this.installation().floors.some((f) => this.floorOn(f.floorId))) {
      this.error.set('Choose at least one floor, or untick “Floor plans”.');
      return;
    }
    const check = exportOptionsSchema.safeParse(o);
    if (!check.success) {
      this.error.set(check.error.issues[0]?.message ?? 'Invalid options.');
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      const blob = await this.api.exportPdf(this.installation().projectId, check.data);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...check.data, floorIds: [] }));
      } catch {
        /* storage unavailable: options are simply not remembered */
      }
      this.save(blob, `${this.slug(this.projectName())}-electrical.pdf`);
      this.closed.emit();
    } catch (err) {
      this.error.set(await this.blobError(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly dxfFloor = signal('');

  protected async downloadDxf(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      const floorId = this.dxfFloor() || undefined;
      const blob = await this.api.exportDxf(this.installation().projectId, floorId);
      const floor = this.installation().floors.find((f) => f.floorId === floorId);
      this.save(blob, floor ? `${this.slug(floor.name)}.dxf` : `${this.slug(this.projectName())}-dxf.zip`);
    } catch (err) {
      this.error.set(await this.blobError(err));
    } finally {
      this.busy.set(false);
    }
  }

  private save(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  private slug(name: string): string {
    return name.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'project';
  }

  /** Errors of a blob request arrive as a Blob body; read the JSON message out of it. */
  private async blobError(err: unknown): Promise<string> {
    const body = (err as { error?: unknown }).error;
    if (body instanceof Blob) {
      try {
        const json = JSON.parse(await body.text()) as { message?: string };
        if (json.message) return json.message;
      } catch {
        /* not JSON */
      }
    }
    return toApiError(err).message;
  }
}
