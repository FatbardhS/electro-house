import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { distance, formatMetres, measureMetres, type Calibration } from '@electro/shared';
import { ToolsStore } from '../state/tools.store';

/** Live result of the measure tool. Lengths are only shown when the floor is calibrated. */
@Component({
  selector: 'app-measure-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <h3>Measure</h3>
      @if (tools.tool() !== 'measure') {
        <button class="btn btn-sm full" type="button" (click)="tools.setTool('measure')">Measure distance <kbd>M</kbd></button>
      } @else if (tools.measurePoints().length === 0) {
        <p class="hint">Click points along the route. Double-click or press <kbd>Enter</kbd> to finish,
          <kbd>Backspace</kbd> removes the last point, <kbd>Esc</kbd> clears. Hold <kbd>Shift</kbd> for straight lines.</p>
      } @else {
        <div class="total mono">{{ total() }}</div>
        @if (!calibration()) {
          <p class="hint warn">Calibrate the scale to see real lengths.</p>
        }
        @if (segments().length > 1) {
          <ol class="segments mono">
            @for (s of segments(); track $index) { <li>{{ s }}</li> }
          </ol>
        }
        <p class="hint">{{ tools.measureFinished() ? 'Finished. Click to start a new measurement.' : 'Double-click or Enter to finish.' }}</p>
        <button class="btn btn-sm" type="button" (click)="tools.clearMeasure()">Clear</button>
      }
    </section>
  `,
  styles: `
    section { display: flex; flex-direction: column; gap: 8px; }
    h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-faint); }
    .full { width: 100%; }
    .total { font-size: 20px; font-weight: 600; color: #ff9f43; }
    .hint { margin: 0; font-size: 12px; color: var(--text-muted); }
    .hint.warn { color: var(--warn); }
    .segments { margin: 0; padding-left: 22px; font-size: 12px; color: var(--text-muted); }
  `,
})
export class MeasurePanel {
  protected readonly tools = inject(ToolsStore);
  readonly calibration = input<Calibration | null>(null);

  private readonly points = computed(() => {
    const pts = [...this.tools.measurePoints()];
    const c = this.tools.cursor();
    if (!this.tools.measureFinished() && c && pts.length > 0) pts.push(c);
    return pts;
  });

  protected readonly total = computed(() => formatMetres(measureMetres(this.points(), this.calibration())));
  protected readonly segments = computed(() => {
    const pts = this.points();
    const cal = this.calibration();
    const out: string[] = [];
    for (let i = 1; i < pts.length; i++) {
      out.push(cal ? formatMetres(distance(pts[i - 1]!, pts[i]!) * cal.metresPerUnit) : '—');
    }
    return out;
  });
}
