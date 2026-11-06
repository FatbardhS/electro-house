import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { CATEGORIES, CATEGORY_NAMES, CIRCUIT_CATEGORIES, type CircuitLoad, type InstallationDto, type InstallationTotals } from '@electro/shared';

/** Whole-project figures: component counts, measured cable per type, connected load per circuit category. */
@Component({
  selector: 'app-totals-view',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totals(); as t) {
      <div class="stats">
        <div class="card stat"><div class="faint small">Components</div><div class="big mono">{{ componentCount() }}</div></div>
        <div class="card stat"><div class="faint small">Circuits</div><div class="big mono">{{ installation().circuits.length }}</div></div>
        <div class="card stat"><div class="faint small">Planned load</div><div class="big mono">{{ plannedLoadW() / 1000 | number: '1.2-2' }} kW</div>
          <div class="faint small">{{ t.totalLoadW / 1000 | number: '1.2-2' }} kW from component data{{ manualLoadW() ? ' + ' + (manualLoadW() / 1000 | number: '1.2-2') + ' kW manual estimates' : '' }}</div></div>
        <div class="card stat"><div class="faint small">Measured cable</div><div class="big mono">{{ t.totalMeasuredM | number: '1.1-1' }} m</div></div>
      </div>

      @if (t.unmeasuredWires > 0) {
        <div class="banner banner-warn">⚠ {{ t.unmeasuredWires }} wire(s) are on floors without a scale calibration; their length is not counted.
          Calibrate those floors in the editor.</div>
      }

      <div class="cols">
        <section class="card">
          <h3>Cable by type</h3>
          @if (t.cables.length === 0) {
            <p class="faint small pad">No wires drawn yet.</p>
          } @else {
            <table class="table dense">
              <thead><tr><th>Cable</th><th class="num">Runs</th><th class="num">Measured m</th></tr></thead>
              <tbody>
                @for (c of t.cables; track c.key) {
                  <tr><td>{{ c.key }}</td><td class="num">{{ c.wireCount }}</td><td class="num mono">{{ c.measuredM | number: '1.1-1' }}</td></tr>
                }
              </tbody>
            </table>
            <p class="faint small pad">Measured route lengths only, including floor connections. Installation allowances
              (drops, reserves, waste) are added later in the material list.</p>
          }
        </section>

        <section class="card">
          <h3>Load by circuit category</h3>
          @if (byCircuitCategory().length === 0) {
            <p class="faint small pad">No circuits yet.</p>
          } @else {
            <table class="table dense">
              <thead><tr><th>Category</th><th class="num">Circuits</th><th class="num">Load kW</th></tr></thead>
              <tbody>
                @for (r of byCircuitCategory(); track r.category) {
                  <tr><td>{{ r.category }}</td><td class="num">{{ r.count }}</td><td class="num mono">{{ r.loadW / 1000 | number: '1.2-2' }}</td></tr>
                }
              </tbody>
            </table>
            <p class="faint small pad">Unassigned components with power data: <span class="mono">{{ unassignedLoad() / 1000 | number: '1.2-2' }} kW</span>.</p>
          }
        </section>
      </div>

      <section class="card">
        <h3>Components</h3>
        @if (t.componentsByType.length === 0) {
          <p class="faint small pad">No components placed yet.</p>
        } @else {
          <table class="table dense">
            <thead><tr><th>Type</th><th>Category</th><th class="num">Count</th></tr></thead>
            <tbody>
              @for (c of t.componentsByType; track c.typeKey) {
                <tr><td>{{ c.name }}</td><td class="faint">{{ categoryNames[c.category] }}</td><td class="num mono">{{ c.count }}</td></tr>
              }
            </tbody>
            <tfoot>
              @for (cat of categories; track cat) {
                @if (t.componentsByCategory[cat]) {
                  <tr class="sub"><td colspan="2">{{ categoryNames[cat] }}</td><td class="num mono">{{ t.componentsByCategory[cat] }}</td></tr>
                }
              }
            </tfoot>
          </table>
        }
      </section>
    }
  `,
  styles: `
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { padding: 12px 16px; }
    .big { font-size: 22px; font-weight: 600; margin-top: 4px; }
    .small { font-size: 12px; }
    .banner { margin-bottom: 16px; }
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin-bottom: 16px; }
    h3 { margin: 0; padding: 12px 16px; font-size: 14px; border-bottom: 1px solid var(--border); }
    .pad { padding: 10px 16px; margin: 0; }
    .dense th, .dense td { padding: 6px 12px; font-size: 12.5px; }
    .num { text-align: right; }
    tfoot .sub td { color: var(--text-muted); font-weight: 600; }
  `,
})
export class TotalsView {
  readonly installation = input.required<InstallationDto>();
  readonly totals = input.required<InstallationTotals | null>();
  readonly loads = input.required<CircuitLoad[]>();

  protected readonly categories = CATEGORIES;
  protected readonly categoryNames = CATEGORY_NAMES;

  protected readonly componentCount = computed(() => this.installation().floors.reduce((s, f) => s + f.components.length, 0));

  protected readonly byCircuitCategory = computed(() =>
    CIRCUIT_CATEGORIES.map((category) => {
      const ls = this.loads().filter((l) => l.circuit.category === category);
      return { category, count: ls.length, loadW: ls.reduce((s, l) => s + l.loadW, 0) };
    }).filter((r) => r.count > 0),
  );

  /** Manual load estimates of circuits whose components carry no power data. */
  protected readonly manualLoadW = computed(() => this.loads().reduce((s, l) => s + (l.connectedW > 0 ? 0 : l.loadW), 0));
  /** Component power anywhere on the plans plus the manual circuit estimates. */
  protected readonly plannedLoadW = computed(() => (this.totals()?.totalLoadW ?? 0) + this.manualLoadW());

  /** Power of components placed on plans but not yet assigned to any circuit. */
  protected readonly unassignedLoad = computed(() => {
    const t = this.totals();
    if (!t) return 0;
    const assigned = this.loads().reduce((s, l) => s + l.connectedW, 0);
    return Math.max(0, t.totalLoadW - assigned);
  });
}
