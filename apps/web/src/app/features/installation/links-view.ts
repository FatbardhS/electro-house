import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import {
  CABLE_TYPES,
  CROSS_SECTIONS_MM2,
  DEFAULT_CABLE,
  cableSummary,
  floorLinkInputSchema,
  floorLinkUpdateSchema,
  type CableDto,
  type FloorLinkDto,
  type FloorLinkInput,
  type InstallationDto,
} from '@electro/shared';
import { Api } from '../../core/api';
import { toApiError } from '../../core/api-error';
import { ConfirmService } from '../../shared/ui/confirm-dialog';
import { EmptyState } from '../../shared/ui/states';
import { componentName, componentOptions } from './installation-helpers';

interface Draft {
  fromComponentId: string;
  toComponentId: string;
  lengthM: string;
  cableType: string;
  conductors: string;
  crossSectionMm2: string;
  circuitId: string;
  description: string;
}

const EMPTY_DRAFT: Draft = {
  fromComponentId: '',
  toComponentId: '',
  lengthM: '',
  cableType: DEFAULT_CABLE.cableType ?? '',
  conductors: '5',
  crossSectionMm2: '6',
  circuitId: '',
  description: '',
};

/**
 * Cables between components on different floors (e.g. main board → sub board on the next floor).
 * Their length cannot be measured on a single plan, so the electrician enters it.
 */
@Component({
  selector: 'app-links-view',
  imports: [EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error(); as e) { <div class="banner banner-error" role="alert">{{ e }}</div> }

    @if (installation().floors.length < 2) {
      <div class="card"><app-empty-state heading="Only one floor"
        text="Floor connections join components on two different floors. Add another floor to the project first." /></div>
    } @else {
      <form class="card add" (submit)="$event.preventDefault(); add()">
        <h3>New floor connection</h3>
        <div class="grid">
          <label class="f"><span>From</span>
            <select class="input" (change)="patchDraft({ fromComponentId: val($event), toComponentId: '' })">
              <option value="" [selected]="!draft().fromComponentId">— choose a component —</option>
              @for (o of options(); track o.id) { <option [value]="o.id" [selected]="o.id === draft().fromComponentId">{{ o.label }}</option> }
            </select></label>
          <label class="f"><span>To (another floor)</span>
            <select class="input" (change)="patchDraft({ toComponentId: val($event) })" [disabled]="!draft().fromComponentId">
              <option value="" [selected]="!draft().toComponentId">— choose a component —</option>
              @for (o of toOptions(); track o.id) { <option [value]="o.id" [selected]="o.id === draft().toComponentId">{{ o.label }}</option> }
            </select></label>
          <label class="f"><span>Cable length (m)</span>
            <input class="input mono" type="number" min="0.1" step="0.1" [value]="draft().lengthM" placeholder="e.g. 6.5"
                   (input)="patchDraft({ lengthM: val($event) })" /></label>
          <label class="f"><span>Cable type</span>
            <select class="input" (change)="patchDraft({ cableType: val($event) })">
              <option value="">—</option>
              @for (t of cableTypes; track t) { <option [value]="t" [selected]="t === draft().cableType">{{ t }}</option> }
            </select></label>
          <label class="f"><span>Conductors</span>
            <input class="input mono" type="number" min="1" max="61" [value]="draft().conductors" (input)="patchDraft({ conductors: val($event) })" /></label>
          <label class="f"><span>Cross-section (mm²)</span>
            <select class="input" (change)="patchDraft({ crossSectionMm2: val($event) })">
              <option value="">—</option>
              @for (s of sections; track s) { <option [value]="s" [selected]="String(s) === draft().crossSectionMm2">{{ s }}</option> }
            </select></label>
          <label class="f"><span>Circuit</span>
            <select class="input" (change)="patchDraft({ circuitId: val($event) })">
              <option value="" [selected]="!draft().circuitId">— none —</option>
              @for (c of installation().circuits; track c.id) { <option [value]="c.id" [selected]="c.id === draft().circuitId">{{ c.number }} · {{ c.name }}</option> }
            </select></label>
          <label class="f wide"><span>Description</span>
            <input class="input" maxlength="2000" [value]="draft().description" placeholder="e.g. riser in stairwell shaft"
                   (input)="patchDraft({ description: val($event) })" /></label>
        </div>
        <div class="actions">
          <span class="faint small">Include the vertical run and the horizontal distance to the shaft on both floors.</span>
          <button class="btn btn-primary btn-sm" type="submit" [disabled]="busy()">Add connection</button>
        </div>
      </form>

      @if (installation().links.length === 0) {
        <div class="card"><app-empty-state heading="No floor connections yet"
          text="Add the cables that run between floors, such as the feed from the main board to a sub-board." /></div>
      } @else {
        <div class="card scroll">
          <table class="table dense">
            <thead><tr>
              <th>From</th><th>To</th><th>Length m</th><th>Cable</th><th>Conductors</th><th>mm²</th><th>Circuit</th><th>Description</th><th></th>
            </tr></thead>
            <tbody>
              @for (l of installation().links; track l.id) {
                <tr>
                  <td>{{ name(l.fromComponentId) }}</td>
                  <td>{{ name(l.toComponentId) }}</td>
                  <td><input class="cell mono w5" type="number" min="0.1" step="0.1" [value]="l.lengthM"
                             (change)="save(l, { lengthM: num($event) ?? l.lengthM })" /></td>
                  <td><select class="cell" (change)="saveCable(l, { cableType: $any(val($event)) || undefined })">
                    <option value="">—</option>
                    @for (t of cableTypes; track t) { <option [value]="t" [selected]="t === l.cable.cableType">{{ t }}</option> }</select></td>
                  <td><input class="cell mono w4" type="number" min="1" max="61" [value]="l.cable.conductors ?? ''"
                             (change)="saveCable(l, { conductors: num($event) ?? undefined })" /></td>
                  <td><select class="cell" (change)="saveCable(l, { crossSectionMm2: num($event) ?? undefined })">
                    <option value="">—</option>
                    @for (s of sections; track s) { <option [value]="s" [selected]="s === l.cable.crossSectionMm2">{{ s }}</option> }</select></td>
                  <td><select class="cell" (change)="save(l, { circuitId: val($event) || null })">
                    <option value="" [selected]="!l.circuitId">—</option>
                    @for (c of installation().circuits; track c.id) { <option [value]="c.id" [selected]="c.id === l.circuitId">{{ c.number }} · {{ c.name }}</option> }</select></td>
                  <td><input class="cell w12" [value]="l.description ?? ''" (change)="save(l, { description: val($event) || null })" /></td>
                  <td><button class="btn btn-sm btn-ghost btn-danger" type="button" (click)="remove(l)" aria-label="Delete connection">✕</button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="faint small">Total between floors: <span class="mono">{{ totalM().toFixed(1) }} m</span>.
          These lengths are added to the circuit cable lengths and the cable totals.</p>
      }
    }
  `,
  styles: `
    .banner { margin-bottom: 12px; }
    .add { padding: 14px 16px; margin-bottom: 16px; }
    h3 { margin: 0 0 12px; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px 14px; }
    .f { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
    .f.wide { grid-column: span 2; }
    .actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 12px; }
    .small { font-size: 12px; }
    .scroll { overflow-x: auto; }
    .dense th, .dense td { padding: 6px 6px; font-size: 12.5px; white-space: nowrap; }
    .cell { height: 26px; padding: 0 6px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--text); font: inherit; }
    .cell:hover, .cell:focus { border-color: var(--border-strong); background: var(--bg-input); outline: none; }
    .w4 { width: 56px; } .w5 { width: 72px; } .w12 { width: 170px; }
    @media (max-width: 640px) { .f.wide { grid-column: auto; } }
  `,
})
export class LinksView {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);
  readonly installation = input.required<InstallationDto>();
  readonly changed = output<void>();

  protected readonly cableTypes = CABLE_TYPES;
  protected readonly sections = CROSS_SECTIONS_MM2;
  protected readonly String = String;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly draft = signal<Draft>(EMPTY_DRAFT);

  protected readonly options = computed(() => componentOptions(this.installation(), (c) => !c.typeKey.startsWith('annotation.')));
  protected readonly toOptions = computed(() => {
    const from = this.options().find((o) => o.id === this.draft().fromComponentId);
    return from ? this.options().filter((o) => o.floorId !== from.floorId) : [];
  });
  protected readonly totalM = computed(() => this.installation().links.reduce((s, l) => s + l.lengthM, 0));

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value.trim();
  }

  protected num(e: Event): number | null {
    const v = this.val(e);
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  protected name(id: string): string {
    return componentName(this.installation(), id);
  }

  protected patchDraft(p: Partial<Draft>): void {
    this.draft.update((d) => ({ ...d, ...p }));
  }

  protected async add(): Promise<void> {
    const d = this.draft();
    const optNum = (s: string) => (s === '' ? undefined : Number(s));
    const input = {
      fromComponentId: d.fromComponentId,
      toComponentId: d.toComponentId,
      lengthM: Number(d.lengthM),
      cable: {
        ...DEFAULT_CABLE,
        cableType: (d.cableType || undefined) as CableDto['cableType'],
        conductors: optNum(d.conductors),
        crossSectionMm2: optNum(d.crossSectionMm2),
        voltage: 400,
        installMethod: undefined,
      },
      circuitId: d.circuitId || null,
      description: d.description || null,
    };
    if (!d.fromComponentId || !d.toComponentId) return this.error.set('Choose the components at both ends.');
    if (!(input.lengthM > 0)) return this.error.set('Enter the cable length in metres.');
    const check = floorLinkInputSchema.safeParse(input);
    if (!check.success) return this.error.set(check.error.issues[0]?.message ?? 'Invalid connection.');
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.api.createLink(this.installation().projectId, check.data);
      this.draft.set(EMPTY_DRAFT);
      this.changed.emit();
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected saveCable(l: FloorLinkDto, patch: Partial<CableDto>): Promise<void> {
    return this.save(l, { cable: { ...l.cable, ...patch } });
  }

  protected async save(l: FloorLinkDto, patch: Partial<FloorLinkInput>): Promise<void> {
    const check = floorLinkUpdateSchema.safeParse(patch);
    if (!check.success) {
      this.error.set(check.error.issues[0]?.message ?? 'Invalid value.');
      return;
    }
    this.error.set(null);
    try {
      await this.api.updateLink(l.id, check.data);
      this.changed.emit();
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }

  protected async remove(l: FloorLinkDto): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Delete floor connection?',
      message: `${cableSummary(l.cable)}, ${l.lengthM} m between ${this.name(l.fromComponentId)} and ${this.name(l.toComponentId)}.`,
      confirmLabel: 'Delete connection',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.deleteLink(l.id);
      this.changed.emit();
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }
}
