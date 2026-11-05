import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import {
  CalibrationError,
  calibratePaperScale,
  calibrateTwoPoint,
  distance,
  equivalentPaperScale,
  type Calibration,
  type FloorDto,
} from '@electro/shared';
import { ToolsStore } from '../state/tools.store';

/** Shows the floor's scale and runs the calibration workflow (two points or paper scale). */
@Component({
  selector: 'app-calibration-panel',
  imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <h3>Scale</h3>
      @if (floor().calibration; as c) {
        <div class="status ok">
          <div class="big mono">1 : {{ ratio(c) }}</div>
          <div class="faint">
            @if (c.method === 'two-point') { From two points, {{ (c.realDistanceMm / 1000).toFixed(3) }} m }
            @else { Paper scale entered }
            · {{ c.calibratedAt | date: 'short' }}
          </div>
        </div>
        @if (floor().calibrationNeedsCheck) {
          <div class="banner banner-warn">
            The plan PDF was replaced or its page changed. Check that the scale is still right
            by measuring a known dimension.
          </div>
          <div class="row">
            <button class="btn btn-sm" type="button" [disabled]="locked()" (click)="confirmed.emit()">Scale is correct</button>
            <button class="btn btn-sm" type="button" [disabled]="locked()" (click)="start()">Recalibrate</button>
          </div>
        }
      } @else {
        <div class="banner banner-warn">Not calibrated. Lengths cannot be measured until you set the scale.</div>
      }

      @if (tools.tool() !== 'calibrate') {
        @if (!floor().calibrationNeedsCheck) {
          <button class="btn btn-sm full" type="button" [disabled]="locked()" (click)="start()">
            {{ floor().calibration ? 'Recalibrate' : 'Calibrate scale' }}
          </button>
        }
        @if (locked()) { <p class="hint">The plan is locked. Unlock it to change the scale.</p> }
      } @else {
        <div class="calibrating">
          <div class="tabs" role="tablist">
            <button type="button" role="tab" [class.active]="method() === 'two-point'" (click)="method.set('two-point')">Two points</button>
            <button type="button" role="tab" [class.active]="method() === 'paper-scale'" (click)="method.set('paper-scale')">Paper scale</button>
          </div>

          @if (method() === 'two-point') {
            <ol class="steps">
              <li [class.current]="tools.calibrationStep() === 'pick-first'" [class.done]="tools.calibrationPoints().length > 0">
                Click the start of a dimension you know (e.g. a wall marked 4.00 m).
              </li>
              <li [class.current]="tools.calibrationStep() === 'pick-second'" [class.done]="tools.calibrationPoints().length > 1">
                Click its end. Hold <kbd>Shift</kbd> to keep the line straight.
              </li>
              <li [class.current]="tools.calibrationStep() === 'enter-distance'">Enter the real distance.</li>
            </ol>
            @if (tools.calibrationStep() === 'enter-distance') {
              <form (ngSubmit)="applyTwoPoint()">
                <div class="field">
                  <label for="cal-dist">Real distance (metres)</label>
                  <input id="cal-dist" class="input mono" name="dist" type="number" step="0.001" min="0"
                         [(ngModel)]="distanceM" autofocus placeholder="4.00" />
                </div>
                @if (shortSpan()) {
                  <p class="hint warn">These points are close together on screen. A longer reference gives a more accurate scale.</p>
                }
                <div class="row">
                  <button class="btn btn-sm btn-primary" type="submit">Apply scale</button>
                  <button class="btn btn-sm" type="button" (click)="tools.resetCalibration()">Pick again</button>
                </div>
              </form>
            }
          } @else {
            <form (ngSubmit)="applyPaperScale()">
              <p class="hint">Use this for vector PDFs exported from CAD at their true paper size. Check the result with the measure tool.</p>
              <div class="field">
                <label for="cal-scale">Drawing scale</label>
                <div class="ratio"><span class="mono">1 :</span>
                  <input id="cal-scale" class="input mono" name="scale" type="number" min="1" step="1"
                         [(ngModel)]="paperScale" placeholder="50" />
                </div>
              </div>
              <button class="btn btn-sm btn-primary" type="submit">Apply scale</button>
            </form>
          }
          @if (error(); as e) { <div class="field-error">{{ e }}</div> }
          <button class="btn btn-sm btn-ghost full" type="button" (click)="cancel()">Cancel</button>
        </div>
      }
    </section>
  `,
  styles: `
    section { display: flex; flex-direction: column; gap: 10px; }
    h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-faint); }
    .status .big { font-size: 20px; font-weight: 600; color: var(--accent); }
    .row { display: flex; gap: 6px; flex-wrap: wrap; }
    .full { width: 100%; }
    .hint { margin: 0; font-size: 12px; color: var(--text-muted); }
    .hint.warn { color: var(--warn); }
    .calibrating { display: flex; flex-direction: column; gap: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: var(--radius); background: var(--accent-soft); }
    .tabs { display: flex; gap: 4px; }
    .tabs button { flex: 1; height: 26px; border: 1px solid var(--border); background: var(--bg-input); color: var(--text-muted); border-radius: var(--radius); cursor: pointer; font: 500 12px var(--font); }
    .tabs button.active { border-color: var(--accent); color: var(--accent); }
    .steps { margin: 0; padding-left: 18px; font-size: 12px; color: var(--text-faint); display: flex; flex-direction: column; gap: 4px; }
    .steps li.current { color: var(--text); font-weight: 500; }
    .steps li.done { color: var(--accent); }
    .field { margin-bottom: 8px; }
    .ratio { display: flex; align-items: center; gap: 8px; }
  `,
})
export class CalibrationPanel {
  protected readonly tools = inject(ToolsStore);
  readonly floor = input.required<FloorDto>();
  readonly locked = input(false);
  /** Current zoom (screen px per plan unit), to warn about short reference lines. */
  readonly zoom = input(1);
  readonly applied = output<Calibration>();
  readonly confirmed = output<void>();

  protected readonly method = signal<'two-point' | 'paper-scale'>('two-point');
  protected readonly error = signal<string | null>(null);
  protected distanceM: number | null = null;
  protected paperScale: number | null = null;

  protected readonly shortSpan = computed(() => {
    const [a, b] = this.tools.calibrationPoints();
    return !!a && !!b && distance(a, b) * this.zoom() < 80;
  });

  protected ratio(c: Calibration): string {
    const r = equivalentPaperScale(c);
    return r >= 10 ? r.toFixed(0) : r.toFixed(2);
  }

  protected start(): void {
    this.error.set(null);
    this.distanceM = null;
    this.tools.setTool('calibrate');
  }

  protected cancel(): void {
    this.error.set(null);
    this.tools.setTool('pan');
  }

  protected applyTwoPoint(): void {
    const [p1, p2] = this.tools.calibrationPoints();
    if (!p1 || !p2) return;
    this.apply(() => calibrateTwoPoint(p1, p2, Number(this.distanceM) * 1000));
  }

  protected applyPaperScale(): void {
    this.apply(() => calibratePaperScale(Number(this.paperScale)));
  }

  private apply(make: () => Calibration): void {
    try {
      const cal = make();
      this.error.set(null);
      this.applied.emit(cal);
      this.tools.setTool('measure'); // natural next step: verify the scale by measuring
    } catch (err) {
      this.error.set(err instanceof CalibrationError ? err.message : 'The scale could not be calculated.');
    }
  }
}
