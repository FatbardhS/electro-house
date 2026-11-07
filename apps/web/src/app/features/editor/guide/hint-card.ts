import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { componentType } from '@electro/shared';
import { wallOffsetMm } from '../drawing/wall-snap';
import { DrawingStore } from '../state/drawing.store';
import { GuideStore } from '../state/guide.store';
import { ToolsStore } from '../state/tools.store';
import { I18N_PIPES } from '../../../core/i18n/t.pipe';
import type { TKey } from '../../../core/i18n/sq';

/**
 * One sentence on the plan telling the user what their next click does, with Stop and Undo buttons.
 * Changes with the tool, the step and what is being drawn.
 */
@Component({
  selector: 'app-hint-card',
  imports: [I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card" role="status" data-tour="hint" [class.good]="tools.onWall() && tools.tool() === 'place'">
      <span class="icon" aria-hidden="true">{{ icon() }}</span>
      <span class="text">
        @if (placing(); as name) { <strong>{{ name | tx }}:</strong> }
        {{ hint() | t }}
      </span>
      <span class="actions">
        @if (tools.tool() !== 'select') {
          <button class="btn btn-sm" type="button" (click)="stop.emit()" [title]="'Esc'">{{ 'Done' | t }}</button>
        }
      </span>
    </div>
  `,
  styles: `
    :host { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 3; width: max-content; max-width: min(680px, calc(100% - 24px)); }
    .card { display: flex; align-items: center; gap: 10px; padding: 9px 10px 9px 14px; border-radius: 10px;
            background: rgba(16, 18, 20, 0.95); border: 1px solid rgba(62, 207, 142, 0.55); box-shadow: var(--shadow); }
    .card.good { border-color: var(--accent); background: linear-gradient(var(--accent-soft), var(--accent-soft)), rgba(16, 18, 20, 0.95); }
    .icon { font-size: 18px; }
    .text { font-size: 14px; line-height: 1.4; color: var(--text); }
    .text strong { color: var(--accent); font-weight: 600; }
    .actions { display: flex; gap: 6px; }
    .actions .btn { min-height: 30px; }
  `,
})
export class HintCard {
  protected readonly tools = inject(ToolsStore);
  private readonly guide = inject(GuideStore);
  private readonly drawing = inject(DrawingStore);
  readonly calibrated = input(false);
  readonly stop = output<void>();

  protected readonly placing = computed(() => {
    if (this.tools.tool() !== 'place') return null;
    const t = componentType(this.tools.placeType() ?? '');
    return t ? t.name : null;
  });

  protected readonly icon = computed(() => {
    switch (this.tools.tool()) {
      case 'place':
        return this.tools.onWall() ? '🧲' : '👆';
      case 'wire':
        return '🔌';
      case 'calibrate':
      case 'measure':
        return '📏';
      case 'pan':
        return '✋';
      default:
        return '💡';
    }
  });

  protected readonly hint = computed<TKey>(() => {
    const tool = this.tools.tool();
    if (tool === 'calibrate') {
      const step = this.tools.calibrationStep();
      return step === 'pick-first'
        ? 'Click one end of a line whose real length you know, for example the end of a wall.'
        : step === 'pick-second'
          ? 'Now click the other end of that line.'
          : 'Type the real length in the box on the right, then press “Apply scale”.';
    }
    if (tool === 'measure') return 'Click points along the way to measure. Double-click to finish.';
    if (tool === 'pan') return 'Drag to move the plan. Use the mouse wheel or two fingers to zoom.';
    if (tool === 'place') {
      if (this.tools.onWall()) return 'Click to put it here. It sticks to the wall.';
      const key = this.tools.placeType();
      if (key && wallOffsetMm(key) !== null) return 'Move close to a wall: it will stick to it. Click to put it here.';
      return 'Click on the plan to put it there. You can put several, one after another.';
    }
    if (tool === 'wire') {
      const d = this.tools.wireDraft();
      if (!d) return 'Click the first item. Tip: start at the electrical board.';
      if (d.points.length === 0 && d.from.componentId) return 'Now click the next item to connect it. Click on empty space to make a bend.';
      return 'Click the item to connect to, or keep clicking to add bends. Double-click ends the wire.';
    }
    // select
    if (this.drawing.selectionCount()) return 'Drag to move it. Its details are on the right. Press Delete to remove it.';
    switch (this.guide.step()) {
      case 'plan':
        return this.calibrated() ? 'The scale is set. Go on to the next step at the top.' : 'Start here: press “Set the scale” on the left.';
      case 'lights':
      case 'outlets':
        return 'Pick an item on the left, then click on the plan to put it there.';
      case 'wires':
        return 'Press “Connect items with a wire” on the left, then click the items one after another.';
      default:
        return 'Click a problem on the left to see where it is on the plan.';
    }
  });
}
