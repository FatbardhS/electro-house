import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CATEGORIES, CATEGORY_NAMES, searchCatalog, type Category, type ComponentType } from '@electro/shared';
import { LAYER_COLORS, symbolId } from '../drawing/symbol-defs';
import { ToolsStore } from '../state/tools.store';
import { DRAG_MIME } from '../workspace';
import { I18N_PIPES } from '../../../core/i18n/t.pipe';

/** Electrical component library: search, categories, click to place, or drag onto the plan. */
@Component({
  selector: 'app-library-panel',
  imports: [I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input class="input search" type="search" [placeholder]="'Search components…' | t" [attr.aria-label]="'Search components' | t"
           [value]="query()" (input)="query.set($any($event.target).value)" />
    <div class="groups">
      @for (g of groups(); track g.category) {
        <section>
          <button class="cat" type="button" (click)="toggle(g.category)" [attr.aria-expanded]="isOpen(g.category)">
            <span>{{ names[g.category] | tx }}</span><span class="faint">{{ g.items.length }} {{ isOpen(g.category) ? '▾' : '▸' }}</span>
          </button>
          @if (isOpen(g.category)) {
            <div class="items">
              @for (t of g.items; track t.key) {
                <button class="item" type="button" draggable="true" [class.active]="tools.placeType() === t.key"
                        (click)="tools.place(t.key)" (dragstart)="onDragStart($event, t)" [title]="'{name} (click, then click on the plan; or drag onto the plan)' | t: { name: (t.name | tx) }">
                  <svg viewBox="-7 -7 14 14" [style.color]="colors[t.defaultLayer]" aria-hidden="true"><use [attr.href]="'#' + id(t.key)" /></svg>
                  <span>{{ t.name | tx }}</span>
                </button>
              }
            </div>
          }
        </section>
      } @empty {
        <p class="faint empty">{{ 'No components match “{q}”.' | t: { q: query() } }}</p>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .search { height: 30px; margin-bottom: 8px; font-size: 13px; }
    .groups { overflow-y: auto; flex: 1; margin: 0 -4px; padding: 0 4px; }
    .cat { display: flex; justify-content: space-between; width: 100%; padding: 8px 2px 6px; border: 0; background: none;
           color: var(--text-muted); font: 600 11px var(--font); text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; }
    .items { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px; }
    .item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 4px; border: 1px solid var(--border);
            border-radius: var(--radius); background: #fff; cursor: grab; font: 500 10.5px var(--font); color: #1f2937; text-align: center; line-height: 1.2; }
    .item svg { width: 34px; height: 34px; }
    .item:hover { border-color: var(--accent); }
    .item.active { outline: 2px solid var(--accent); }
    .empty { font-size: 12px; text-align: center; margin-top: 20px; }
  `,
})
export class LibraryPanel {
  protected readonly tools = inject(ToolsStore);
  protected readonly names = CATEGORY_NAMES;
  protected readonly colors = LAYER_COLORS;
  protected readonly id = symbolId;
  protected readonly query = signal('');
  private readonly open = signal<ReadonlySet<Category>>(new Set(['lighting', 'outlets', 'switches']));

  protected readonly groups = computed(() => {
    const found = searchCatalog(this.query());
    return CATEGORIES.map((category) => ({ category, items: found.filter((t) => t.category === category) })).filter(
      (g) => g.items.length > 0,
    );
  });

  protected isOpen(c: Category): boolean {
    return !!this.query().trim() || this.open().has(c);
  }

  protected toggle(c: Category): void {
    this.open.update((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  }

  protected onDragStart(e: DragEvent, t: ComponentType): void {
    e.dataTransfer?.setData(DRAG_MIME, t.key);
    e.dataTransfer?.setData('text/plain', t.name);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }
}
