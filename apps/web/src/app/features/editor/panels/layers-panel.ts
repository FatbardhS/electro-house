import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LAYER_NAMES } from '@electro/shared';
import { LAYER_COLORS } from '../drawing/symbol-defs';
import { DrawingStore } from '../state/drawing.store';
import { I18N_PIPES } from '../../../core/i18n/t.pipe';

/** Show/hide and lock each drawing layer of the floor. */
@Component({
  selector: 'app-layers-panel',
  imports: [I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row bg">
      <span class="swatch" style="background: #fff"></span>
      <span class="name">{{ 'Architectural plan (PDF)' | t }}</span>
      <span class="faint hint">{{ 'use the lock in the tool rail' | t }}</span>
    </div>
    @for (l of drawing.layers(); track l.key) {
      <div class="row" [class.hidden]="!l.visible">
        <span class="swatch" [style.background]="colors[l.key]"></span>
        <span class="name">{{ names[l.key] | tx }}</span>
        <span class="count faint">{{ drawing.countsByLayer().get(l.key) ?? 0 }}</span>
        <button class="btn btn-sm btn-icon btn-ghost" type="button" (click)="drawing.setLayer(l.key, { visible: !l.visible })"
                [attr.aria-label]="(l.visible ? 'Hide {name}' : 'Show {name}') | t: { name: (names[l.key] | tx) }" [title]="(l.visible ? 'Hide layer' : 'Show layer') | t">
          {{ l.visible ? '👁' : '—' }}
        </button>
        <button class="btn btn-sm btn-icon btn-ghost" type="button" [class.on]="l.locked" (click)="drawing.setLayer(l.key, { locked: !l.locked })"
                [attr.aria-label]="(l.locked ? 'Unlock {name}' : 'Lock {name}') | t: { name: (names[l.key] | tx) }" [title]="(l.locked ? 'Unlock layer' : 'Lock layer (objects cannot be selected)') | t">
          {{ l.locked ? '🔒' : '🔓' }}
        </button>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 2px; }
    .row { display: flex; align-items: center; gap: 8px; padding: 4px 2px; border-radius: var(--radius); font-size: 12.5px; }
    .row:hover { background: var(--bg-elev-2); }
    .row.hidden .name { color: var(--text-faint); text-decoration: line-through; }
    .bg { opacity: 0.7; }
    .hint { font-size: 10px; }
    .swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.2); }
    .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { font-size: 11px; min-width: 18px; text-align: right; }
    .on { color: var(--warn); }
  `,
})
export class LayersPanel {
  protected readonly drawing = inject(DrawingStore);
  protected readonly names = LAYER_NAMES;
  protected readonly colors = LAYER_COLORS;
}
