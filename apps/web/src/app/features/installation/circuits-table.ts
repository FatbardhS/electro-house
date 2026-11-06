import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  CIRCUIT_CATEGORIES,
  CROSS_SECTIONS_MM2,
  DEFAULT_CIRCUIT,
  PHASES,
  PROTECTION_TYPES,
  circuitUpdateSchema,
  nextCircuitNumber,
  type CircuitDto,
  type CircuitInput,
  type CircuitLoad,
  type InstallationDto,
} from '@electro/shared';
import { Api } from '../../core/api';
import { toApiError } from '../../core/api-error';
import { ConfirmService } from '../../shared/ui/confirm-dialog';
import { EmptyState } from '../../shared/ui/states';
import { boardOptions } from './installation-helpers';

/** Editable table of all circuits with computed load, design current, cable length and warnings. */
@Component({
  selector: 'app-circuits-table',
  imports: [EmptyState, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar">
      <button class="btn btn-primary btn-sm" type="button" (click)="add()" [disabled]="busy()">+ New circuit</button>
      <span class="faint">Assign components and wires to circuits in the floor editor (Circuits tab).</span>
    </div>
    @if (error(); as e) { <div class="banner banner-error">{{ e }}</div> }
    @if (loads().length === 0) {
      <div class="card"><app-empty-state heading="No circuits yet" text="Create the circuits of this installation, then assign components to them on the floor plans." /></div>
    } @else {
      <div class="card scroll">
        <table class="table dense">
          <thead>
            <tr>
              <th>No.</th><th>Name</th><th>Category</th><th>Board</th><th>Phase</th><th>V</th><th>Device</th><th>In (A)</th><th>Curve</th>
              <th>RCD group</th><th>mA</th><th>Cable</th><th>mm²</th><th>Manual W</th>
              <th class="num">Items</th><th class="num">Load W</th><th class="num">Ib A</th><th class="num">Cable m</th><th></th>
            </tr>
          </thead>
          <tbody>
            @for (l of loads(); track l.circuit.id) {
              @let c = l.circuit;
              <tr [class.warn]="l.warnings.length">
                <td><input class="cell mono w4" [value]="c.number" (change)="save(c, { number: str($event) })" /></td>
                <td><input class="cell w12" [value]="c.name" (change)="save(c, { name: str($event) })" /></td>
                <td><select class="cell" (change)="save(c, { category: $any(str($event)) })">
                  @for (o of categories; track o) { <option [selected]="o === c.category">{{ o }}</option> }</select></td>
                <td><select class="cell" (change)="save(c, { boardComponentId: str($event) || null })">
                  <option value="" [selected]="!c.boardComponentId">—</option>
                  @for (b of boards(); track b.id) { <option [value]="b.id" [selected]="b.id === c.boardComponentId">{{ b.label }}</option> }</select></td>
                <td><select class="cell" (change)="phaseChanged(c, $event)">
                  @for (o of phases; track o) { <option [selected]="o === c.phase">{{ o }}</option> }</select></td>
                <td><input class="cell mono w4" type="number" [value]="c.voltage" (change)="save(c, { voltage: num($event) ?? c.voltage })" /></td>
                <td><select class="cell" (change)="save(c, { protection: $any(str($event)) })">
                  @for (o of protections; track o) { <option [selected]="o === c.protection">{{ o }}</option> }</select></td>
                <td><input class="cell mono w4" type="number" [value]="c.breakerRatingA ?? ''" (change)="save(c, { breakerRatingA: num($event) })" /></td>
                <td><select class="cell" (change)="save(c, { breakerCurve: $any(str($event) || null) })">
                  <option value="" [selected]="!c.breakerCurve">—</option>
                  @for (o of curves; track o) { <option [selected]="o === c.breakerCurve">{{ o }}</option> }</select></td>
                <td><input class="cell w6" [value]="c.rcdGroup ?? ''" placeholder="none" (change)="save(c, { rcdGroup: str($event) || null })" /></td>
                <td><input class="cell mono w4" type="number" [value]="c.residualCurrentMa ?? ''" (change)="save(c, { residualCurrentMa: num($event) })" /></td>
                <td><input class="cell w6" [value]="c.cableType ?? ''" (change)="save(c, { cableType: str($event) || null })" /></td>
                <td><select class="cell" (change)="save(c, { crossSectionMm2: num($event) })">
                  <option value="" [selected]="!c.crossSectionMm2">—</option>
                  @for (s of sections; track s) { <option [value]="s" [selected]="s === c.crossSectionMm2">{{ s }}</option> }</select></td>
                <td><input class="cell mono w5" type="number" [value]="c.manualLoadW ?? ''" (change)="save(c, { manualLoadW: num($event) })" /></td>
                <td class="num">{{ l.componentCount }}</td>
                <td class="num mono">{{ l.loadW | number: '1.0-0' }}</td>
                <td class="num mono">{{ l.designCurrentA === null ? '—' : (l.designCurrentA | number: '1.1-1') }}</td>
                <td class="num mono">{{ l.cableM | number: '1.1-1' }}</td>
                <td><button class="btn btn-sm btn-ghost btn-danger" type="button" (click)="remove(c)" [attr.aria-label]="'Delete circuit ' + c.number">✕</button></td>
              </tr>
              @if (l.warnings.length) {
                <tr class="warnrow"><td colspan="19">⚠ {{ l.warnings.join(' ') }}</td></tr>
              }
            }
          </tbody>
        </table>
      </div>
      <p class="faint note">Load = sum of the power of components assigned to the circuit (or the manual estimate if none carry power).
        Ib = P / (U·cos φ) single-phase, P / (√3·U·cos φ) three-phase, using the power factor from the rules profile.
        These are planning estimates, not certified design calculations.</p>
    }
  `,
  styles: `
    .bar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; font-size: 12px; }
    .banner { margin-bottom: 12px; }
    .scroll { overflow-x: auto; }
    .dense th, .dense td { padding: 6px 6px; font-size: 12.5px; white-space: nowrap; }
    .num { text-align: right; }
    .cell { height: 26px; padding: 0 6px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--text); font: inherit; }
    .cell:hover, .cell:focus { border-color: var(--border-strong); background: var(--bg-input); outline: none; }
    select.cell { padding-right: 2px; }
    .w4 { width: 56px; } .w5 { width: 72px; } .w6 { width: 84px; } .w12 { width: 170px; }
    tr.warn td:first-child { box-shadow: inset 3px 0 0 var(--warn); }
    .warnrow td { color: var(--warn); font-size: 12px; padding-top: 0 !important; border-top: 0; white-space: normal; }
    .note { font-size: 12px; margin-top: 10px; }
  `,
})
export class CircuitsTable {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);
  readonly installation = input.required<InstallationDto>();
  readonly loads = input.required<CircuitLoad[]>();
  readonly changed = output<void>();

  protected readonly categories = CIRCUIT_CATEGORIES;
  protected readonly phases = PHASES;
  protected readonly protections = PROTECTION_TYPES;
  protected readonly curves = ['B', 'C', 'D'] as const;
  protected readonly sections = CROSS_SECTIONS_MM2;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly boards = computed(() => boardOptions(this.installation()));

  protected str(e: Event): string {
    return (e.target as HTMLInputElement).value.trim();
  }

  protected num(e: Event): number | null {
    const v = this.str(e);
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  protected phaseChanged(c: CircuitDto, e: Event): void {
    const phase = this.str(e) as CircuitDto['phase'];
    // Switching between single- and three-phase usually changes the voltage too.
    const voltage = phase === 'L1+L2+L3' ? (c.voltage === 230 ? 400 : c.voltage) : c.voltage === 400 ? 230 : c.voltage;
    void this.save(c, { phase, voltage });
  }

  protected async save(c: CircuitDto, patch: Partial<CircuitInput>): Promise<void> {
    const check = circuitUpdateSchema.safeParse(patch);
    if (!check.success) {
      this.error.set(check.error.issues[0]?.message ?? 'Invalid value.');
      return;
    }
    this.error.set(null);
    try {
      await this.api.updateCircuit(c.id, check.data);
      this.changed.emit();
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }

  protected async add(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.createCircuit(this.installation().projectId, {
        ...DEFAULT_CIRCUIT,
        number: nextCircuitNumber(this.installation().circuits),
        boardComponentId: this.boards()[0]?.id ?? null,
      });
      this.changed.emit();
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(c: CircuitDto): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Delete circuit ${c.number}?`,
      message: `“${c.name}” will be deleted. Its components and wires stay on the plans and become unassigned.`,
      confirmLabel: 'Delete circuit',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.deleteCircuit(c.id);
      this.changed.emit();
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }
}
