import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  CABLE_ROUTINGS,
  DEFAULT_COST_NOTE,
  EMPTY_COST_SETTINGS,
  buildBom,
  costSummary,
  effectiveCostSettings,
  floorHeightsSchema,
  formatMoney,
  groupTakeoff,
  projectCostSettingsSchema,
  takeoff,
  type BomGrouping,
  type CostExtraLine,
  type FloorInstallationDto,
  type InstallationDto,
  type MaterialDto,
  type MaterialRuleDto,
  type OrganizationSettings,
  type ProjectCostSettings,
} from '@electro/shared';
import { Api } from '../../core/api';
import { errorMessage, toApiError } from '../../core/api-error';
import { ErrorState, LoadingState } from '../../shared/ui/states';

type OverrideKey = 'markupPct' | 'vatPct' | 'hourlyRate' | 'wastePct' | 'endReserveM' | 'boardTailM';

/** Bill of materials with measured vs allowance quantities, cost summary, and the project's cost overrides. */
@Component({
  selector: 'app-materials-view',
  imports: [DecimalPipe, RouterLink, LoadingState, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (settings.error() || materials.error() || rules.error(); as err) {
      <app-error-state [message]="message(err)" (retry)="settings.reload(); materials.reload(); rules.reload()" />
    } @else if (!report()) {
      <app-loading label="Loading prices…" />
    } @else {
      @let r = report()!;
      @let cur = r.cost.currency;

      @if (materials.value()?.length === 0) {
        <div class="banner banner-warn">Your price list is empty, so nothing can be priced yet.
          <a routerLink="/settings" [queryParams]="{ tab: 'prices' }">Set up the price list</a>.</div>
      }
      @if (r.project.unmapped.length) {
        <div class="banner banner-warn">
          ⚠ {{ r.project.unmapped.length }} item type(s) have no material assigned and are not priced:
          @for (u of r.project.unmapped; track u.target; let last = $last) {
            <a routerLink="/settings" [queryParams]="{ tab: 'rules', target: u.target }">{{ u.label }}</a>
            ({{ u.quantity | number: (u.unit === 'm' ? '1.1-1' : '1.0-0') }} {{ u.unit }}){{ last ? '.' : ',' }}
          }
        </div>
      }
      @if (r.project.unknownRuns) {
        <div class="banner banner-warn">⚠ {{ r.project.unknownRuns }} wire(s) are on floors without a scale calibration; their length is unknown and not included.</div>
      }

      <div class="layout">
        <div class="main">
          <div class="bar">
            <span class="faint small">Group by</span>
            @for (g of groupings; track g.id) {
              <button type="button" class="chip" [class.on]="grouping() === g.id" (click)="grouping.set(g.id)">{{ g.label }}</button>
            }
          </div>

          @for (g of r.groups; track g.id) {
            <section class="card group">
              @if (grouping() !== 'project') { <h3>{{ g.name }}</h3> }
              @if (g.bom.cables.length) {
                <div class="scroll">
                  <table class="table dense">
                    <thead><tr>
                      <th>Cable</th><th class="num">Runs</th><th class="num">Measured m</th><th class="num">Drops m</th>
                      <th class="num">Reserves m</th><th class="num">Waste m</th><th class="num">Total m</th>
                    </tr></thead>
                    <tbody>
                      @for (c of g.bom.cables; track c.target) {
                        <tr>
                          <td>{{ c.key }} @if (c.unknownRuns) { <span class="warn small">({{ c.unknownRuns }} not measured)</span> }</td>
                          <td class="num">{{ c.runs }}</td>
                          <td class="num mono">{{ c.measuredM | number: '1.1-1' }}</td>
                          <td class="num mono">{{ c.dropsM | number: '1.1-1' }}</td>
                          <td class="num mono">{{ c.terminationsM | number: '1.1-1' }}</td>
                          <td class="num mono">{{ c.wasteM | number: '1.1-1' }}</td>
                          <td class="num mono strong">{{ c.totalM | number: '1.1-1' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
              @if (g.bom.lines.length) {
                <div class="scroll">
                  <table class="table dense">
                    <thead><tr>
                      <th>Code</th><th>Material</th><th class="num">Needed</th>
                      @if (r.roundToPacks) { <th class="num">Packs</th><th class="num">Order</th> }
                      <th>Unit</th><th class="num">Unit price</th><th class="num">Total</th>
                    </tr></thead>
                    <tbody>
                      @for (l of g.bom.lines; track l.material.id) {
                        <tr [title]="'For: ' + l.usedFor.join(', ')">
                          <td class="mono faint">{{ l.material.code ?? '' }}</td>
                          <td>{{ l.material.name }}</td>
                          <td class="num mono">{{ l.quantity | number: '1.0-2' }}</td>
                          @if (r.roundToPacks) {
                            <td class="num mono">{{ l.packs ?? '—' }}</td>
                            <td class="num mono">{{ l.orderQuantity | number: '1.0-2' }}</td>
                          }
                          <td class="faint">{{ l.material.unit }}</td>
                          <td class="num mono">{{ l.material.unitPrice | number: '1.2-4' }}</td>
                          <td class="num mono">{{ l.total | number: '1.2-2' }}</td>
                        </tr>
                      }
                    </tbody>
                    <tfoot><tr><td [attr.colspan]="r.roundToPacks ? 7 : 5">Materials (net)</td><td class="num mono strong">{{ g.bom.materialsNet | number: '1.2-2' }}</td></tr></tfoot>
                  </table>
                </div>
              } @else {
                <p class="faint small pad">No priced materials{{ grouping() === 'project' ? '' : ' in this group' }}.</p>
              }
            </section>
          }
          @if (grouping() !== 'project' && r.roundToPacks) {
            <p class="faint small">Pack rounding is applied per group here; the cost summary rounds the whole project once.</p>
          }
        </div>

        <aside class="side">
          <section class="card cost">
            <h3>Cost summary</h3>
            <dl>
              <dt>Materials</dt><dd class="mono">{{ money(r.cost.materialsNet, cur) }}</dd>
              <dt>Markup {{ r.cost.markupPct }} %</dt><dd class="mono">{{ money(r.cost.markup, cur) }}</dd>
              <dt>Labour {{ r.cost.ruleHours + r.cost.extraHours | number: '1.0-2' }} h × {{ r.cost.hourlyRate | number: '1.0-2' }}</dt>
              <dd class="mono">{{ money(r.cost.labour, cur) }}</dd>
              @for (x of r.cost.extraLines; track $index) { <dt>{{ x.text }}</dt><dd class="mono">{{ money(x.amount, cur) }}</dd> }
              <dt class="sum">Net</dt><dd class="mono sum">{{ money(r.cost.net, cur) }}</dd>
              <dt>VAT {{ r.cost.vatPct }} %</dt><dd class="mono">{{ money(r.cost.vat, cur) }}</dd>
              <dt class="total">Total</dt><dd class="mono total">{{ money(r.cost.gross, cur) }}</dd>
            </dl>
            <p class="faint small">{{ r.cost.note }}</p>
          </section>

          <form class="card form" (submit)="$event.preventDefault(); saveCost()">
            <h3>This project</h3>
            <p class="faint small">Leave a field empty to use the company setting (shown in grey).</p>
            <div class="two">
              @for (o of overrides; track o.key) {
                <label class="f"><span>{{ o.label }}</span>
                  <input class="input mono" type="number" min="0" [step]="o.step" [value]="cost()[o.key] ?? ''" [placeholder]="companyValue(o.key)"
                         (input)="setOverride(o.key, $event)" /></label>
              }
              <label class="f"><span>Extra labour hours</span>
                <input class="input mono" type="number" min="0" step="0.5" [value]="cost().extraHours" (input)="patchCost({ extraHours: num($event) ?? 0 })" /></label>
            </div>
            <div class="f"><span>Extra lines (net; negative for a discount)</span>
              @for (x of cost().extraLines; track $index; let i = $index) {
                <div class="line">
                  <input class="input" maxlength="200" [value]="x.text" placeholder="e.g. Testing and commissioning" (input)="setLine(i, { text: str($event) })" />
                  <input class="input mono amt" type="number" step="0.01" [value]="x.amount" (input)="setLine(i, { amount: num($event) ?? 0 })" />
                  <button class="btn btn-sm btn-ghost" type="button" (click)="removeLine(i)" aria-label="Remove line">✕</button>
                </div>
              }
              <button class="btn btn-sm btn-ghost add" type="button" (click)="addLine()">+ Add line</button>
            </div>
            <label class="f"><span>Note on the cost report</span>
              <textarea class="input" rows="3" maxlength="2000" [value]="cost().note" [placeholder]="defaultNote" (input)="patchCost({ note: str($event) })"></textarea></label>
            @if (costError(); as e) { <div class="banner banner-error">{{ e }}</div> }
            <button class="btn btn-primary btn-sm" type="submit" [disabled]="busy() || !costDirty()">{{ costDirty() ? 'Save project costs' : 'Saved' }}</button>
          </form>

          <section class="card form">
            <h3>Floor heights</h3>
            <p class="faint small">Used for vertical drops from the cable route to each component's mounting height.</p>
            @for (f of installation().floors; track f.floorId) {
              <div class="floor">
                <span class="name">{{ f.name }}</span>
                <input class="input mono h" type="number" min="1500" max="20000" step="10" [value]="f.ceilingHeightMm"
                       (change)="saveFloor(f, { ceilingHeightMm: num($event) ?? f.ceilingHeightMm })" aria-label="Ceiling height in mm" />
                <span class="faint small">mm</span>
                <select class="input" (change)="saveFloor(f, { cableRouting: $any(str($event)) })" aria-label="Cable route">
                  @for (o of routings; track o) { <option [value]="o" [selected]="o === f.cableRouting">{{ o === 'ceiling' ? 'in ceiling' : 'in floor' }}</option> }
                </select>
              </div>
            }
            @if (floorError(); as e) { <div class="banner banner-error">{{ e }}</div> }
          </section>
        </aside>
      </div>
    }
  `,
  styles: `
    .banner { margin-bottom: 12px; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
    @media (max-width: 1000px) { .layout { grid-template-columns: 1fr; } }
    .bar { display: flex; gap: 6px; align-items: center; margin-bottom: 12px; }
    .chip { padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: none; color: var(--text-muted); font: 600 12px var(--font); cursor: pointer; }
    .chip.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    .group { margin-bottom: 16px; }
    h3 { margin: 0; padding: 12px 16px; font-size: 14px; border-bottom: 1px solid var(--border); }
    .scroll { overflow-x: auto; }
    .dense th, .dense td { padding: 6px 10px; font-size: 12.5px; white-space: nowrap; }
    .num { text-align: right; }
    .strong { font-weight: 700; }
    tfoot td { font-weight: 600; }
    .small { font-size: 12px; }
    .warn { color: var(--warn); }
    .pad { padding: 10px 16px; margin: 0; }
    .side { display: flex; flex-direction: column; gap: 16px; }
    .cost dl { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; margin: 0; padding: 12px 16px; font-size: 13px; }
    .cost dd { margin: 0; text-align: right; }
    .cost .sum { border-top: 1px solid var(--border); padding-top: 6px; font-weight: 600; }
    .cost .total { font-weight: 700; font-size: 15px; }
    .cost p { padding: 0 16px 12px; margin: 0; }
    .form { padding-bottom: 14px; }
    .form > *:not(h3) { margin-left: 16px; margin-right: 16px; }
    .form p { margin-top: 10px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; margin-bottom: 10px; }
    .f { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); margin-bottom: 10px; }
    .line { display: flex; gap: 6px; }
    .line .amt { width: 100px; }
    .add { align-self: flex-start; }
    .floor { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; font-size: 13px; }
    .floor .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .floor .h { width: 84px; }
    .floor select { width: 110px; }
  `,
})
export class MaterialsView {
  private readonly api = inject(Api);
  readonly installation = input.required<InstallationDto>();
  readonly changed = output<void>();

  protected readonly settings = httpResource<OrganizationSettings>(() => '/api/organization/settings');
  protected readonly materials = httpResource<MaterialDto[]>(() => '/api/materials');
  protected readonly rules = httpResource<MaterialRuleDto[]>(() => '/api/material-rules');

  protected readonly groupings: { id: BomGrouping; label: string }[] = [
    { id: 'project', label: 'Whole project' },
    { id: 'floor', label: 'Floor' },
    { id: 'circuit', label: 'Circuit' },
  ];
  protected readonly overrides: { key: OverrideKey; label: string; step: number }[] = [
    { key: 'markupPct', label: 'Markup %', step: 0.5 },
    { key: 'vatPct', label: 'VAT %', step: 0.1 },
    { key: 'hourlyRate', label: 'Labour rate / h', step: 0.5 },
    { key: 'wastePct', label: 'Cable waste %', step: 0.5 },
    { key: 'endReserveM', label: 'End reserve m', step: 0.05 },
    { key: 'boardTailM', label: 'Board reserve m', step: 0.05 },
  ];
  protected readonly routings = CABLE_ROUTINGS;
  protected readonly defaultNote = DEFAULT_COST_NOTE;
  protected message = errorMessage;

  protected readonly grouping = signal<BomGrouping>('project');
  protected readonly cost = signal<ProjectCostSettings>(EMPTY_COST_SETTINGS);
  protected readonly busy = signal(false);
  protected readonly costError = signal<string | null>(null);
  protected readonly floorError = signal<string | null>(null);
  protected readonly costDirty = computed(() => JSON.stringify(this.cost()) !== JSON.stringify(this.installation().costSettings));

  constructor() {
    // Reset the form when the saved settings change (initial load, after save).
    effect(() => this.cost.set(structuredClone(this.installation().costSettings)));
  }

  /** Everything computed from the plans + prices; recomputed live while editing the overrides. */
  protected readonly report = computed(() => {
    if (!this.settings.hasValue() || !this.materials.hasValue() || !this.rules.hasValue()) return null;
    const inst = this.installation();
    const materials = this.materials.value();
    const rules = this.rules.value();
    const eff = effectiveCostSettings(this.settings.value(), this.cost());
    const opts = { allowances: eff.allowances, roundToPacks: eff.roundToPacks };
    const t = takeoff(inst, eff.allowances);
    const project = buildBom(t, materials, rules, opts);
    const groups =
      this.grouping() === 'project'
        ? [{ id: 'project', name: 'Whole project', bom: project }]
        : groupTakeoff(t, inst, this.grouping()).map((g) => ({ id: g.id, name: g.name, bom: buildBom(g.takeoff, materials, rules, opts) }));
    return { project, groups, cost: costSummary(project, eff, this.cost()), roundToPacks: eff.roundToPacks };
  });

  protected money(v: number, currency: string): string {
    return formatMoney(v, currency);
  }

  protected companyValue(key: OverrideKey): string {
    const s = this.settings.value();
    if (!s) return '';
    const v = key === 'wastePct' || key === 'endReserveM' || key === 'boardTailM' ? s.allowances[key] : s[key];
    return String(v);
  }

  protected str(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
  protected num(e: Event): number | null {
    const v = (e.target as HTMLInputElement).value.trim();
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  protected patchCost(p: Partial<ProjectCostSettings>): void {
    this.cost.update((c) => ({ ...c, ...p }));
  }
  protected setOverride(key: OverrideKey, e: Event): void {
    this.patchCost({ [key]: this.num(e) });
  }
  protected setLine(i: number, p: Partial<CostExtraLine>): void {
    this.patchCost({ extraLines: this.cost().extraLines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  }
  protected addLine(): void {
    this.patchCost({ extraLines: [...this.cost().extraLines, { text: '', amount: 0 }] });
  }
  protected removeLine(i: number): void {
    this.patchCost({ extraLines: this.cost().extraLines.filter((_, j) => j !== i) });
  }

  protected async saveCost(): Promise<void> {
    const check = projectCostSettingsSchema.safeParse(this.cost());
    if (!check.success) {
      this.costError.set(check.error.issues[0]?.message ?? 'Invalid value.');
      return;
    }
    this.costError.set(null);
    this.busy.set(true);
    try {
      await this.api.setCostSettings(this.installation().projectId, check.data);
      this.changed.emit();
    } catch (err) {
      this.costError.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveFloor(f: FloorInstallationDto, patch: Partial<Pick<FloorInstallationDto, 'ceilingHeightMm' | 'cableRouting'>>): Promise<void> {
    const check = floorHeightsSchema.safeParse({ ceilingHeightMm: f.ceilingHeightMm, cableRouting: f.cableRouting, ...patch });
    if (!check.success) {
      this.floorError.set(check.error.issues[0]?.message ?? 'Invalid value.');
      return;
    }
    this.floorError.set(null);
    try {
      await this.api.setFloorHeights(f.floorId, check.data);
      this.changed.emit();
    } catch (err) {
      this.floorError.set(toApiError(err).message);
    }
  }
}
