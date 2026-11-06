import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  CABLE_TYPES,
  CATEGORIES,
  CATEGORY_NAMES,
  COMPONENT_TYPES,
  CROSS_SECTIONS_MM2,
  materialRuleInputSchema,
  materialRuleUpdateSchema,
  parseCableTarget,
  targetLabel,
  type MaterialDto,
  type MaterialRuleDto,
  type MaterialRuleInput,
} from '@electro/shared';
import { Api } from '../../core/api';
import { toApiError } from '../../core/api-error';
import { EmptyState } from '../../shared/ui/states';

interface Draft {
  kind: 'component' | 'cable';
  typeKey: string;
  cableType: string;
  conductors: string;
  crossSection: string;
  materialId: string;
  quantity: string;
  labourMinutes: string;
}

const EMPTY: Draft = { kind: 'component', typeKey: '', cableType: 'NYM-J', conductors: '*', crossSection: '*', materialId: '', quantity: '1', labourMinutes: '0' };

/**
 * What each component type and cable consumes from the price list, and the labour time per unit.
 * Cable rules may use "any" (*) for type, cores or size; the most specific matching rule wins.
 */
@Component({
  selector: 'app-material-rules',
  imports: [EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error(); as e) { <div class="banner banner-error" role="alert">{{ e }}</div> }
    @if (!readonly()) {
      <form class="card add" (submit)="$event.preventDefault(); add()">
        <h3>New rule</h3>
        <div class="grid">
          <label class="f"><span>For</span>
            <select class="input" (change)="patch({ kind: $any(val($event)) })">
              <option value="component" [selected]="draft().kind === 'component'">a component type</option>
              <option value="cable" [selected]="draft().kind === 'cable'">a cable (per metre)</option>
            </select></label>
          @if (draft().kind === 'component') {
            <label class="f wide"><span>Component type</span>
              <select class="input" (change)="patch({ typeKey: val($event) })">
                <option value="" [selected]="!draft().typeKey">— choose —</option>
                @for (g of typeGroups; track g.name) {
                  <optgroup [label]="g.name">
                    @for (t of g.types; track t.key) { <option [value]="t.key" [selected]="t.key === draft().typeKey">{{ t.name }}</option> }
                  </optgroup>
                }
              </select></label>
          } @else {
            <label class="f"><span>Cable type</span>
              <select class="input" (change)="patch({ cableType: val($event) })">
                <option value="*" [selected]="draft().cableType === '*'">any</option>
                @for (t of cableTypes; track t) { <option [value]="t" [selected]="t === draft().cableType">{{ t }}</option> }
              </select></label>
            <label class="f"><span>Cores</span>
              <select class="input" (change)="patch({ conductors: val($event) })">
                <option value="*" [selected]="draft().conductors === '*'">any</option>
                @for (n of cores; track n) { <option [value]="n" [selected]="String(n) === draft().conductors">{{ n }}</option> }
              </select></label>
            <label class="f"><span>Cross-section (mm²)</span>
              <select class="input" (change)="patch({ crossSection: val($event) })">
                <option value="*" [selected]="draft().crossSection === '*'">any</option>
                @for (s of sections; track s) { <option [value]="s" [selected]="String(s) === draft().crossSection">{{ s }}</option> }
              </select></label>
          }
          <label class="f wide"><span>Material</span>
            <select class="input" (change)="patch({ materialId: val($event) })">
              <option value="" [selected]="!draft().materialId">— choose from the price list —</option>
              @for (m of activeMaterials(); track m.id) { <option [value]="m.id" [selected]="m.id === draft().materialId">{{ m.name }}{{ m.code ? ' (' + m.code + ')' : '' }} · {{ m.unit }}</option> }
            </select></label>
          <label class="f"><span>{{ draft().kind === 'cable' ? 'Quantity per metre' : 'Quantity per component' }}</span>
            <input class="input mono" type="number" min="0" step="0.01" [value]="draft().quantity" (input)="patch({ quantity: val($event) })" /></label>
          <label class="f"><span>{{ draft().kind === 'cable' ? 'Labour min per metre' : 'Labour min per component' }}</span>
            <input class="input mono" type="number" min="0" step="0.5" [value]="draft().labourMinutes" (input)="patch({ labourMinutes: val($event) })" /></label>
        </div>
        <div class="actions">
          <span class="faint small">Target: <strong>{{ draftLabel() }}</strong>. Several rules for the same target add several materials.</span>
          <button class="btn btn-primary btn-sm" type="submit" [disabled]="busy()">Add rule</button>
        </div>
      </form>
    }

    @if (groups().length === 0) {
      <div class="card"><app-empty-state heading="No material rules yet"
        text="Rules turn the plans into a material list: e.g. a double outlet uses 1 flush box, 1 socket and 1 frame." /></div>
    } @else {
      <div class="card scroll">
        <table class="table dense">
          <thead><tr><th>For</th><th>Material</th><th class="num">Quantity</th><th>Unit</th><th class="num">Labour min</th><th></th></tr></thead>
          <tbody>
            @for (g of groups(); track g.target) {
              @for (r of g.rules; track r.id; let first = $first) {
                <tr [class.first]="first">
                  <td>@if (first) { <strong>{{ g.label }}</strong> <span class="faint small">{{ g.kind }}</span> }</td>
                  <td>
                    <select class="cell" (change)="save(r, { materialId: val($event) })" [disabled]="readonly()">
                      @for (m of materials(); track m.id) {
                        @if (!m.archived || m.id === r.materialId) { <option [value]="m.id" [selected]="m.id === r.materialId">{{ m.name }}{{ m.archived ? ' (archived)' : '' }}</option> }
                      }
                    </select></td>
                  <td class="num"><input class="cell mono w5 r" type="number" min="0" step="0.01" [value]="r.quantity" (change)="saveNum(r, 'quantity', $event)" [disabled]="readonly()" /></td>
                  <td class="faint">{{ unitOf(r.materialId) }}{{ g.kind === 'cable' ? ' / m' : '' }}</td>
                  <td class="num"><input class="cell mono w5 r" type="number" min="0" step="0.5" [value]="r.labourMinutes" (change)="saveNum(r, 'labourMinutes', $event)" [disabled]="readonly()" /></td>
                  <td>@if (!readonly()) { <button class="btn btn-sm btn-ghost btn-danger" type="button" (click)="remove(r)" aria-label="Delete rule">✕</button> }</td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    .banner { margin-bottom: 12px; }
    .add { padding: 14px 16px; margin-bottom: 16px; }
    h3 { margin: 0 0 12px; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px 14px; }
    .f { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
    .f.wide { grid-column: span 2; }
    .actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 12px; }
    .small { font-size: 12px; }
    .scroll { overflow-x: auto; }
    .dense th, .dense td { padding: 5px 8px; font-size: 12.5px; white-space: nowrap; }
    tr.first td { border-top: 1px solid var(--border-strong); }
    .num { text-align: right; }
    .r { text-align: right; }
    .cell { height: 26px; padding: 0 6px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--text); font: inherit; max-width: 320px; }
    .cell:hover:not(:disabled), .cell:focus { border-color: var(--border-strong); background: var(--bg-input); outline: none; }
    .w5 { width: 80px; }
    @media (max-width: 640px) { .f.wide { grid-column: auto; } }
  `,
})
export class MaterialRules {
  private readonly api = inject(Api);
  readonly rules = input.required<MaterialRuleDto[]>();
  readonly materials = input.required<MaterialDto[]>();
  readonly readonly = input(false);
  /** Pre-selects a target in the new-rule form (from a "no material assigned" link). */
  readonly presetTarget = input<string | null>(null);
  readonly changed = output<void>();

  protected readonly String = String;
  protected readonly cableTypes = CABLE_TYPES;
  protected readonly sections = CROSS_SECTIONS_MM2;
  protected readonly cores = [1, 2, 3, 4, 5, 7, 8, 10, 12];
  protected readonly typeGroups = CATEGORIES.map((c) => ({
    name: CATEGORY_NAMES[c],
    types: COMPONENT_TYPES.filter((t) => t.category === c && c !== 'annotation'),
  })).filter((g) => g.types.length);

  protected readonly draft = signal<Draft>(EMPTY);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly activeMaterials = computed(() => this.materials().filter((m) => !m.archived));
  protected readonly draftTarget = computed(() => {
    const d = this.draft();
    return d.kind === 'component' ? (d.typeKey ? `component:${d.typeKey}` : '') : `cable:${d.cableType}|${d.conductors}|${d.crossSection}`;
  });
  protected readonly draftLabel = computed(() => (this.draftTarget() ? targetLabel(this.draftTarget()) : '—'));

  protected readonly groups = computed(() => {
    const map = new Map<string, MaterialRuleDto[]>();
    for (const r of this.rules()) map.set(r.target, [...(map.get(r.target) ?? []), r]);
    return [...map]
      .map(([target, rules]) => ({ target, rules, label: targetLabel(target), kind: target.startsWith('cable:') ? 'cable' : 'component' }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label, undefined, { numeric: true }));
  });

  constructor() {
    effect(() => {
      const t = this.presetTarget();
      if (!t) return;
      const cable = parseCableTarget(t);
      if (cable) this.draft.set({ ...EMPTY, kind: 'cable', cableType: cable.cableType, conductors: cable.conductors, crossSection: cable.crossSection });
      else if (t.startsWith('component:')) this.draft.set({ ...EMPTY, kind: 'component', typeKey: t.slice('component:'.length) });
    });
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value.trim();
  }

  protected patch(p: Partial<Draft>): void {
    this.draft.update((d) => ({ ...d, ...p }));
  }

  protected unitOf(materialId: string): string {
    return this.materials().find((m) => m.id === materialId)?.unit ?? '';
  }

  protected async add(): Promise<void> {
    const d = this.draft();
    if (!this.draftTarget()) return this.error.set('Choose the component type.');
    if (!d.materialId) return this.error.set('Choose a material from the price list.');
    const check = materialRuleInputSchema.safeParse({
      target: this.draftTarget(),
      materialId: d.materialId,
      quantity: Number(d.quantity),
      labourMinutes: Number(d.labourMinutes || 0),
    });
    if (!check.success) return this.error.set(check.error.issues[0]?.message ?? 'Invalid rule.');
    await this.run(async () => {
      await this.api.createRule(check.data);
      this.draft.update((x) => ({ ...x, materialId: '', quantity: '1', labourMinutes: '0' }));
    });
  }

  protected saveNum(r: MaterialRuleDto, key: 'quantity' | 'labourMinutes', e: Event): Promise<void> {
    const n = Number(this.val(e));
    return this.save(r, { [key]: Number.isFinite(n) ? n : 0 });
  }

  protected async save(r: MaterialRuleDto, patch: Partial<MaterialRuleInput>): Promise<void> {
    const check = materialRuleUpdateSchema.safeParse(patch);
    if (!check.success) {
      this.error.set(check.error.issues[0]?.message ?? 'Invalid value.');
      return;
    }
    await this.run(() => this.api.updateRule(r.id, check.data));
  }

  protected async remove(r: MaterialRuleDto): Promise<void> {
    await this.run(() => this.api.deleteRule(r.id));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      this.changed.emit();
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
