import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { componentType, type Issue } from '@electro/shared';
import { LAYER_COLORS, symbolId } from '../drawing/symbol-defs';
import { LibraryPanel } from '../panels/library-panel';
import { ChecksPanel } from '../panels/checks-panel';
import { ToolsStore, type ToolId } from '../state/tools.store';
import { GUIDE_STEPS, GuideStore } from '../state/guide.store';
import { DRAG_MIME } from '../workspace';
import { I18N_PIPES } from '../../../core/i18n/t.pipe';

/** Left panel of the guided editor: what this step is about, its most used items as big tiles, and the rest. */
@Component({
  selector: 'app-guide-panel',
  imports: [I18N_PIPES, RouterLink, LibraryPanel, ChecksPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = step();
    <div class="intro" data-tour="intro">
      <div class="num">{{ index() + 1 }}</div>
      <div>
        <h2>{{ s.title | t }}</h2>
        <p>{{ s.intro | t }}</p>
      </div>
    </div>

    @switch (s.id) {
      @case ('plan') {
        @if (calibrated()) {
          <div class="done-box">✓ {{ 'The scale is set. Lengths on this plan are now in metres.' | t }}</div>
          <button class="btn big-btn" type="button" (click)="tool.emit('calibrate')" [disabled]="calibrationLocked()">{{ 'Set the scale again' | t }}</button>
          <button class="btn btn-primary big-btn" type="button" (click)="guide.step.set('lights')">{{ 'Next: lights' | t }} →</button>
        } @else {
          <button class="btn btn-primary big-btn" type="button" (click)="tool.emit('calibrate')">📏 {{ 'Set the scale' | t }}</button>
        }
        <button class="btn btn-ghost big-btn" type="button" (click)="tool.emit('measure')">{{ 'Measure a distance' | t }}</button>
      }
      @case ('wires') {
        <button class="btn big-btn connect" type="button" data-tour="tiles" [class.btn-primary]="tools.tool() === 'wire'" (click)="tool.emit(tools.tool() === 'wire' ? 'select' : 'wire')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h6V6h10" /><circle cx="4" cy="18" r="2" /><circle cx="20" cy="6" r="2" /></svg>
          {{ (tools.tool() === 'wire' ? 'Connecting… (click to stop)' : 'Connect items with a wire') | t }}
        </button>
        @if (unconnected() > 0) {
          <button class="btn btn-ghost big-btn" type="button" (click)="showUnconnected.emit()">{{ 'Show the {n} item(s) without a wire' | t: { n: unconnected() } }}</button>
        }
        <div class="label">{{ 'Also needed' | t }}</div>
      }
      @case ('check') {
        <app-checks-panel [issues]="issues()" [ignored]="ignored()" [projectId]="projectId()" (focus)="focus.emit($event)" />
        <a class="btn btn-primary big-btn" [routerLink]="['/projects', projectId(), 'installation']">{{ 'Open materials and print' | t }} →</a>
      }
    }

    @if (s.quick.length) {
      @if (s.id !== 'wires') { <div class="label">{{ 'Most used' | t }}</div> }
      <div class="tiles" [attr.data-tour]="s.id === 'wires' ? null : 'tiles'">
        @for (q of s.quick; track q.key) {
          <button class="tile" type="button" draggable="true" [class.active]="tools.placeType() === q.key && tools.tool() === 'place'"
                  (click)="tools.place(q.key)" (dragstart)="onDragStart($event, q.key)">
            <svg viewBox="-7 -7 14 14" [style.color]="color(q.key)" aria-hidden="true"><use [attr.href]="'#' + id(q.key)" /></svg>
            <span>{{ q.name | t }}</span>
          </button>
        }
      </div>
    }
    @if (s.tip) { <div class="tip">💡 {{ s.tip | t }}</div> }

    @if (s.categories.length) {
      <button class="more" type="button" (click)="more.set(!more())" [attr.aria-expanded]="more()">
        {{ 'More items' | t }} <span>{{ more() ? '▾' : '▸' }}</span>
      </button>
      @if (more()) { <app-library-panel [categories]="s.categories" /> }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; min-height: 0; flex: 1; overflow-y: auto; }
    .intro { display: flex; gap: 10px; align-items: flex-start; }
    .num { flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--accent-soft); color: var(--accent);
           display: grid; place-items: center; font: 700 14px var(--font); }
    h2 { margin: 2px 0 4px; font-size: 16px; }
    .intro p { margin: 0; font-size: 13px; line-height: 1.45; color: var(--text-muted); }
    .label { font: 600 11px var(--font); text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); margin-top: 4px; }
    .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .tile { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 6px 10px; min-height: 92px;
            border: 1px solid var(--border); border-radius: 10px; background: #fff; color: #1f2937; cursor: pointer;
            font: 600 12.5px var(--font); text-align: center; line-height: 1.2; touch-action: manipulation; }
    .tile svg { width: 44px; height: 44px; }
    .tile:hover { border-color: var(--accent); }
    .tile.active { outline: 3px solid var(--accent); outline-offset: -1px; }
    .tip { font-size: 12.5px; line-height: 1.45; color: var(--text-muted); padding: 9px 10px; border-radius: var(--radius);
           background: var(--bg-elev-2); border: 1px solid var(--border); }
    .big-btn { width: 100%; min-height: 42px; justify-content: center; font-size: 14px; }
    .connect { display: flex; gap: 8px; align-items: center; min-height: 54px; }
    .connect svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; }
    .done-box { font-size: 13px; padding: 9px 10px; border-radius: var(--radius); background: var(--accent-soft); color: var(--accent); }
    .more { display: flex; justify-content: space-between; width: 100%; padding: 8px 2px; border: 0; border-top: 1px solid var(--border);
            background: none; color: var(--text-muted); font: 600 12px var(--font); cursor: pointer; }
    app-library-panel { flex: none; }
  `,
})
export class GuidePanel {
  protected readonly guide = inject(GuideStore);
  protected readonly tools = inject(ToolsStore);
  readonly projectId = input.required<string>();
  readonly calibrated = input(false);
  readonly calibrationLocked = input(false);
  readonly issues = input<Issue[]>([]);
  readonly ignored = input(0);
  readonly unconnected = input(0);
  readonly tool = output<ToolId>();
  readonly focus = output<Issue>();
  readonly showUnconnected = output<void>();

  protected readonly more = signal(false);
  protected readonly step = computed(() => GUIDE_STEPS.find((s) => s.id === this.guide.step())!);
  protected readonly index = computed(() => GUIDE_STEPS.indexOf(this.step()));
  protected readonly id = symbolId;

  protected color(key: string): string {
    const t = componentType(key);
    return t ? LAYER_COLORS[t.defaultLayer] : '#1f2937';
  }

  protected onDragStart(e: DragEvent, key: string): void {
    e.dataTransfer?.setData(DRAG_MIME, key);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }
}
