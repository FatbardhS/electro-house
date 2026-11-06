import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { componentType, type BoardSchedule, type CircuitLoad, type InstallationDto } from '@electro/shared';
import { EmptyState } from '../../shared/ui/states';

const NOMINAL_PHASE_VOLTAGE = 230;

/** One schedule per distribution board: its circuits, protection, loads and the load on each phase. */
@Component({
  selector: 'app-boards-view',
  imports: [DecimalPipe, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (schedules().length === 0) {
      <div class="card"><app-empty-state heading="No distribution boards"
        text="Place a distribution board symbol on a floor plan (Distribution & protection), then feed circuits from it." /></div>
    }
    @if (unassigned().length) {
      <div class="banner banner-warn">⚠ {{ unassigned().length }} circuit(s) are not fed from any board:
        {{ unassignedNames() }}. Choose a board in the Circuits tab.</div>
    }
    @for (s of schedules(); track s.board.id) {
      <section class="card board">
        <header>
          <div>
            <h3>{{ s.board.label ?? 'Board' }} <span class="faint">· {{ typeName(s.board.typeKey) }} · {{ s.floorName }}</span></h3>
            <div class="faint small">{{ s.circuits.length }} circuit(s) · connected load {{ s.totalLoadW / 1000 | number: '1.2-2' }} kW</div>
          </div>
          <div class="phases">
            @for (p of phaseList(s); track p.name) {
              <div class="phase" [class.max]="p.isMax && imbalance(s) > 0.2">
                <div class="faint small">{{ p.name }}</div>
                <div class="mono">{{ p.w / 1000 | number: '1.2-2' }} kW</div>
                <div class="mono faint small">≈ {{ p.a | number: '1.1-1' }} A</div>
              </div>
            }
            <div class="phase">
              <div class="faint small">Imbalance</div>
              <div class="mono" [class.bad]="imbalance(s) > 0.2">{{ imbalance(s) * 100 | number: '1.0-0' }} %</div>
            </div>
          </div>
        </header>
        @if (s.circuits.length === 0) {
          <p class="faint small pad">No circuits are fed from this board yet.</p>
        } @else {
          <div class="scroll">
            <table class="table dense">
              <thead><tr>
                <th>No.</th><th>Circuit</th><th>Phase</th><th>Protection</th><th>RCD</th><th>Cable</th>
                <th class="num">Items</th><th class="num">Load W</th><th class="num">Ib A</th><th class="num">Cable m</th><th>Notes</th>
              </tr></thead>
              <tbody>
                @for (l of s.circuits; track l.circuit.id) {
                  @let c = l.circuit;
                  <tr [class.warn]="l.warnings.length">
                    <td class="mono">{{ c.number }}</td>
                    <td>{{ c.name }} <span class="faint small">{{ c.category }}</span></td>
                    <td>{{ c.phase }}</td>
                    <td>{{ protection(l) }}</td>
                    <td>{{ c.rcdGroup ? c.rcdGroup + (c.residualCurrentMa ? ' · ' + c.residualCurrentMa + ' mA' : '') : '—' }}</td>
                    <td>{{ c.cableType ?? '' }} {{ c.crossSectionMm2 ? c.crossSectionMm2 + ' mm²' : '' }}</td>
                    <td class="num">{{ l.componentCount }}</td>
                    <td class="num mono">{{ l.loadW | number: '1.0-0' }}</td>
                    <td class="num mono">{{ l.designCurrentA === null ? '—' : (l.designCurrentA | number: '1.1-1') }}</td>
                    <td class="num mono">{{ l.cableM | number: '1.1-1' }}</td>
                    <td class="notes">{{ l.warnings.join(' ') }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }
    <p class="faint small">Phase loads: single-phase circuits count fully on their phase, three-phase circuits a third on each.
      Phase currents ≈ load / ({{ voltage }} V · cos φ). Imbalance = (highest − lowest) / highest phase load.</p>
  `,
  styles: `
    .board { margin-bottom: 16px; }
    header { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    h3 { margin: 0 0 4px; font-size: 15px; }
    h3 .faint { font-weight: 400; font-size: 13px; }
    .phases { display: flex; gap: 8px; }
    .phase { min-width: 84px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; text-align: right; }
    .phase.max { border-color: var(--warn); }
    .bad { color: var(--warn); }
    .small { font-size: 12px; }
    .pad { padding: 12px 16px; margin: 0; }
    .scroll { overflow-x: auto; }
    .dense th, .dense td { padding: 6px 8px; font-size: 12.5px; white-space: nowrap; }
    .num { text-align: right; }
    .notes { color: var(--warn); white-space: normal !important; min-width: 200px; font-size: 12px; }
    tr.warn td:first-child { box-shadow: inset 3px 0 0 var(--warn); }
    .banner { margin-bottom: 12px; }
  `,
})
export class BoardsView {
  readonly installation = input.required<InstallationDto>();
  readonly schedules = input.required<BoardSchedule[]>();

  protected readonly voltage = NOMINAL_PHASE_VOLTAGE;
  protected readonly unassigned = computed(() => this.installation().circuits.filter((c) => !c.boardComponentId));
  protected readonly unassignedNames = computed(() =>
    this.unassigned()
      .map((c) => `${c.number} ${c.name}`)
      .join(', '),
  );

  protected typeName(typeKey: string): string {
    return componentType(typeKey)?.name ?? typeKey;
  }

  protected protection(l: CircuitLoad): string {
    const c = l.circuit;
    if (!c.breakerRatingA) return c.protection;
    return `${c.protection} ${c.breakerCurve ?? ''}${c.breakerRatingA} A`;
  }

  protected phaseList(s: BoardSchedule): { name: string; w: number; a: number; isMax: boolean }[] {
    const pf = this.installation().profile.powerFactor || 1;
    const max = Math.max(s.phaseLoadW.L1, s.phaseLoadW.L2, s.phaseLoadW.L3);
    return (['L1', 'L2', 'L3'] as const).map((name) => ({
      name,
      w: s.phaseLoadW[name],
      a: s.phaseLoadW[name] / (NOMINAL_PHASE_VOLTAGE * pf),
      isMax: max > 0 && s.phaseLoadW[name] === max,
    }));
  }

  protected imbalance(s: BoardSchedule): number {
    const v = [s.phaseLoadW.L1, s.phaseLoadW.L2, s.phaseLoadW.L3];
    const max = Math.max(...v);
    return max > 0 ? (max - Math.min(...v)) / max : 0;
  }
}
