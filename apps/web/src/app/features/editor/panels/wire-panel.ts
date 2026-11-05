import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  CABLE_TYPES,
  CROSS_SECTIONS_MM2,
  INSTALL_METHODS,
  LINE_STYLES,
  WIRE_COLORS,
  cableSchema,
  endPosition,
  formatMetres,
  wireLengthUnits,
  type CableDto,
  type Calibration,
  type WireDto,
  type WireEndDto,
} from '@electro/shared';
import { DrawingStore } from '../state/drawing.store';
import { ToolsStore } from '../state/tools.store';

/** Properties of one selected wire: cable data, measured length and connections. */
@Component({
  selector: 'app-wire-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (wire(); as w) {
      <div class="len">
        <div class="big mono">{{ length() }}</div>
        <div class="faint small">Measured route length{{ calibration() ? '' : ' (calibrate the floor to see metres)' }}.
          Installation allowances are added in the material list.</div>
      </div>
      <label class="f"><span>Label</span>
        <input class="input" [value]="w.label ?? ''" maxlength="40" placeholder="e.g. W1" (change)="setLabel($event)" /></label>
      <div class="two">
        <label class="f"><span>Cable type</span>
          <select class="input" (change)="setCable({ cableType: $any(val($event)) || undefined })">
            <option value="">—</option>
            @for (t of cableTypes; track t) { <option [value]="t" [selected]="w.cable.cableType === t">{{ t }}</option> }
          </select></label>
        <label class="f"><span>Conductors</span>
          <input class="input mono" type="number" min="1" max="61" [value]="w.cable.conductors ?? ''" (change)="setCable({ conductors: num($event) })" /></label>
      </div>
      <div class="two">
        <label class="f"><span>Cross-section (mm²)</span>
          <select class="input" (change)="setCable({ crossSectionMm2: num($event) })">
            <option value="">—</option>
            @for (s of sections; track s) { <option [value]="s" [selected]="w.cable.crossSectionMm2 === s">{{ s }}</option> }
          </select></label>
        <label class="f"><span>Voltage (V)</span>
          <input class="input mono" type="number" min="1" max="1000" [value]="w.cable.voltage ?? ''" (change)="setCable({ voltage: num($event) })" /></label>
      </div>
      <label class="f"><span>Installation method</span>
        <select class="input" (change)="setCable({ installMethod: $any(val($event)) || undefined })">
          <option value="">—</option>
          @for (m of methods; track m) { <option [value]="m" [selected]="w.cable.installMethod === m">{{ m }}</option> }
        </select></label>
      <div class="f"><span>Colour and line</span>
        <div class="swatches">
          @for (c of colors; track c) {
            <button type="button" class="sw" [style.background]="c" [class.on]="w.cable.color === c" (click)="setCable({ color: c })" [attr.aria-label]="'Colour ' + c"></button>
          }
          <select class="input style" (change)="setCable({ lineStyle: $any(val($event)) })" aria-label="Line style">
            @for (s of styles; track s) { <option [value]="s" [selected]="w.cable.lineStyle === s">{{ s }}</option> }
          </select>
        </div>
      </div>
      <div class="ends">
        <div class="end"><span class="faint">From</span> <span>{{ endName(w.from) }}</span>
          @if (w.from.componentId) { <button class="btn btn-sm btn-ghost" type="button" (click)="disconnect('from')">Disconnect</button> }</div>
        <div class="end"><span class="faint">To</span> <span>{{ endName(w.to) }}</span>
          @if (w.to.componentId) { <button class="btn btn-sm btn-ghost" type="button" (click)="disconnect('to')">Disconnect</button> }</div>
      </div>
      <label class="f"><span>Description</span>
        <textarea class="input" rows="2" maxlength="2000" [value]="w.description ?? ''" (change)="setDescription($event)"></textarea></label>
      <p class="faint small">Drag the round handles to move bends or ends (drop an end on a component to connect it),
        drag a small handle to add a bend, double-click a bend to remove it.</p>
      <div class="actions"><button class="btn btn-sm btn-danger" type="button" (click)="drawing.deleteSelected()">Delete wire</button></div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; }
    .len .big { font-size: 20px; font-weight: 600; color: var(--accent); }
    .small { font-size: 11px; margin: 0; }
    .f { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--text-muted); }
    .f .input { height: 28px; font-size: 13px; }
    .f textarea.input { height: auto; min-height: 48px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .swatches { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .sw { width: 20px; height: 20px; border-radius: 4px; border: 2px solid transparent; cursor: pointer; }
    .sw.on { border-color: var(--accent); box-shadow: 0 0 0 1px #fff inset; }
    .style { width: 96px; height: 24px !important; font-size: 12px !important; }
    .ends { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
    .end { display: flex; align-items: center; gap: 6px; }
    .end span:nth-child(2) { flex: 1; }
    .actions { display: flex; gap: 6px; }
  `,
})
export class WirePanel {
  protected readonly drawing = inject(DrawingStore);
  private readonly tools = inject(ToolsStore);
  readonly calibration = input<Calibration | null>(null);

  protected readonly cableTypes = CABLE_TYPES;
  protected readonly sections = CROSS_SECTIONS_MM2;
  protected readonly methods = INSTALL_METHODS;
  protected readonly styles = LINE_STYLES;
  protected readonly colors = WIRE_COLORS;

  protected readonly wire = computed(() => {
    const w = this.drawing.selectedWires();
    return w.length === 1 && this.drawing.selected().length === 0 ? w[0]! : null;
  });
  protected readonly length = computed(() => {
    const w = this.wire();
    if (!w) return '';
    const units = wireLengthUnits(w, this.drawing.lookup());
    const cal = this.calibration();
    return cal ? formatMetres(units * cal.metresPerUnit) : 'not calibrated';
  });

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value.trim();
  }

  protected num(e: Event): number | undefined {
    const v = this.val(e);
    return v === '' ? undefined : Number(v);
  }

  protected endName(end: WireEndDto): string {
    if (!end.componentId) return 'free end';
    const c = this.drawing.byId().get(end.componentId);
    return c ? (c.label ?? c.typeKey) : 'missing component';
  }

  protected setCable(patch: Partial<CableDto>): void {
    const w = this.wire();
    if (!w) return;
    const cable = { ...w.cable, ...patch };
    for (const k of Object.keys(cable) as (keyof CableDto)[]) if (cable[k] === undefined) delete cable[k];
    if (!cableSchema.safeParse(cable).success) return;
    this.drawing.updateWires([{ ...w, cable }], 'Change cable');
    this.tools.wireCable.set(cable); // new wires use the last cable chosen
  }

  protected setLabel(e: Event): void {
    const w = this.wire();
    if (w) this.drawing.updateWires([{ ...w, label: this.val(e) || null }], 'Rename wire');
  }

  protected setDescription(e: Event): void {
    const w = this.wire();
    if (w) this.drawing.updateWires([{ ...w, description: this.val(e) || null }], 'Edit wire description');
  }

  protected disconnect(which: 'from' | 'to'): void {
    const w: WireDto | null = this.wire();
    if (!w) return;
    const p = endPosition(w[which], this.drawing.lookup());
    this.drawing.updateWires([{ ...w, [which]: { componentId: null, portId: null, x: p.x, y: p.y } }], 'Disconnect wire');
  }
}
