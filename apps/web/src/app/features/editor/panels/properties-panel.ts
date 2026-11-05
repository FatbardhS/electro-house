import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import {
  LAYER_KEYS,
  LAYER_NAMES,
  componentType,
  normalizeDegrees,
  propertiesSchema,
  type ComponentDto,
  type FloorDto,
  type LayerKey,
  type PropertyField,
} from '@electro/shared';
import { LAYER_COLORS, symbolId } from '../drawing/symbol-defs';
import { DrawingStore } from '../state/drawing.store';

/** Properties of the selected component(s). Every edit is one undoable command. */
@Component({
  selector: 'app-properties-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (single(); as c) {
      @let t = type(c);
      <div class="head">
        <svg viewBox="-7 -7 14 14" [style.color]="colors[c.layerKey]" aria-hidden="true"><use [attr.href]="'#' + id(c.typeKey)" /></svg>
        <div><div class="tname">{{ t?.name ?? c.typeKey }}</div><div class="faint small mono">{{ c.id.slice(0, 8) }}</div></div>
      </div>
      <label class="f"><span>Label</span>
        <input class="input" [value]="c.label ?? ''" maxlength="40" (change)="commit({ label: val($event) || null }, 'Rename')" /></label>
      <label class="f"><span>Layer</span>
        <select class="input" [value]="c.layerKey" (change)="commit({ layerKey: $any(val($event)) }, 'Change layer')">
          @for (k of layerKeys; track k) { <option [value]="k" [selected]="k === c.layerKey">{{ layerNames[k] }}</option> }
        </select></label>
      <div class="two">
        <label class="f"><span>Rotation (°)</span>
          <input class="input mono" type="number" step="15" [value]="c.rotation" (change)="commitRotation($event)" /></label>
        <label class="f"><span>Height (mm)</span>
          <input class="input mono" type="number" min="0" max="20000" step="50" [value]="c.mountHeightMm ?? ''" placeholder="—"
                 (change)="commitHeight($event)" /></label>
      </div>
      @for (f of t?.fields ?? []; track f.key) {
        <label class="f" [class.check]="f.kind === 'boolean'"><span>{{ f.label }}{{ unit(f) }}</span>
          @switch (f.kind) {
            @case ('number') {
              <input class="input mono" type="number" [attr.min]="$any(f).min" [attr.max]="$any(f).max" [value]="c.properties[f.key] ?? ''"
                     (change)="commitProp(f, $event)" />
            }
            @case ('select') {
              <select class="input" (change)="commitProp(f, $event)">
                <option value="" [selected]="c.properties[f.key] === undefined">—</option>
                @for (o of $any(f).options; track o) { <option [value]="o" [selected]="c.properties[f.key] === o">{{ o }}</option> }
              </select>
            }
            @case ('boolean') {
              <input type="checkbox" [checked]="!!c.properties[f.key]" (change)="commitProp(f, $event)" />
            }
            @default {
              <input class="input" [value]="c.properties[f.key] ?? ''" [attr.maxlength]="$any(f).maxLength" (change)="commitProp(f, $event)" />
            }
          }
        </label>
      }
      <label class="f"><span>Description</span>
        <textarea class="input" rows="2" maxlength="2000" [value]="c.description ?? ''" (change)="commit({ description: val($event) || null }, 'Edit description')"></textarea></label>
      @if (error(); as e) { <div class="field-error">{{ e }}</div> }
    } @else if (many(); as list) {
      <div class="head"><div><div class="tname">{{ list.length }} components selected</div>
        <div class="faint small">{{ summary() }}</div></div></div>
      <label class="f"><span>Layer</span>
        <select class="input" (change)="commit({ layerKey: $any(val($event)) }, 'Change layer')">
          <option value="" selected disabled>Move all to layer…</option>
          @for (k of layerKeys; track k) { <option [value]="k">{{ layerNames[k] }}</option> }
        </select></label>
      <label class="f"><span>Height (mm), all</span>
        <input class="input mono" type="number" min="0" max="20000" step="50" placeholder="unchanged" (change)="commitHeight($event)" /></label>
    }

    @if (drawing.selectionCount()) {
      <div class="actions">
        <button class="btn btn-sm" type="button" (click)="drawing.rotateSelected(-90)" title="Rotate −90° (Shift+R)">⟲ 90°</button>
        <button class="btn btn-sm" type="button" (click)="drawing.rotateSelected(90)" title="Rotate 90° (R)">⟳ 90°</button>
        <button class="btn btn-sm btn-danger" type="button" (click)="drawing.deleteSelected()" title="Delete (Del)">Delete</button>
      </div>
      @if (otherFloors().length) {
        <div class="copy">
          <select class="input" #target aria-label="Target floor">
            @for (f of otherFloors(); track f.id) { <option [value]="f.id">{{ f.name }}</option> }
          </select>
          <button class="btn btn-sm" type="button" (click)="copyToFloor.emit(target.value)">Copy to floor</button>
        </div>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; }
    .head { display: flex; gap: 10px; align-items: center; }
    .head svg { width: 40px; height: 40px; background: #fff; border-radius: var(--radius); flex-shrink: 0; }
    .tname { font-weight: 600; }
    .small { font-size: 11px; }
    .f { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--text-muted); }
    .f .input { height: 28px; font-size: 13px; }
    .f textarea.input { height: auto; min-height: 48px; }
    .f.check { flex-direction: row; justify-content: space-between; align-items: center; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .copy { display: flex; gap: 6px; }
    .copy .input { height: 26px; font-size: 12px; flex: 1; }
  `,
})
export class PropertiesPanel {
  protected readonly drawing = inject(DrawingStore);
  readonly floors = input<FloorDto[]>([]);
  readonly currentFloorId = input<string>('');
  readonly copyToFloor = output<string>();

  protected readonly layerKeys = LAYER_KEYS;
  protected readonly layerNames = LAYER_NAMES;
  protected readonly colors = LAYER_COLORS;
  protected readonly id = symbolId;
  protected readonly type = (c: ComponentDto) => componentType(c.typeKey);
  protected readonly error = signal<string | null>(null);

  protected readonly single = computed(() => {
    const s = this.drawing.selected();
    return s.length === 1 ? s[0]! : null;
  });
  protected readonly many = computed(() => {
    const s = this.drawing.selected();
    return s.length > 1 ? s : null;
  });
  protected readonly summary = computed(() => {
    const counts = new Map<string, number>();
    for (const c of this.drawing.selected()) {
      const n = componentType(c.typeKey)?.name ?? c.typeKey;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return [...counts].map(([n, k]) => `${k}× ${n}`).join(', ');
  });
  protected readonly otherFloors = computed(() =>
    this.floors().filter((f) => f.id !== this.currentFloorId() && f.planFile),
  );

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value.trim();
  }

  protected unit(f: PropertyField): string {
    return f.kind === 'number' && f.unit ? ` (${f.unit})` : '';
  }

  protected commit(patch: Partial<ComponentDto>, label: string): void {
    const sel = this.drawing.selected();
    if (patch.layerKey && !LAYER_KEYS.includes(patch.layerKey as LayerKey)) return;
    this.drawing.update(sel.map((c) => ({ ...c, ...patch })), label);
  }

  protected commitRotation(e: Event): void {
    const v = Number(this.val(e));
    if (!Number.isFinite(v)) return;
    this.commit({ rotation: normalizeDegrees(v) }, 'Rotate');
  }

  protected commitHeight(e: Event): void {
    const raw = this.val(e);
    if (raw === '' && this.many()) return;
    const v = raw === '' ? null : Math.round(Number(raw));
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 20000)) {
      this.error.set('Height must be between 0 and 20000 mm.');
      return;
    }
    this.error.set(null);
    this.commit({ mountHeightMm: v }, 'Change height');
  }

  protected commitProp(f: PropertyField, e: Event): void {
    const c = this.single();
    if (!c) return;
    const el = e.target as HTMLInputElement;
    let value: unknown;
    if (f.kind === 'boolean') value = el.checked;
    else if (f.kind === 'number') value = el.value.trim() === '' ? undefined : Number(el.value);
    else value = el.value.trim() === '' ? undefined : el.value.trim();
    const properties = { ...c.properties };
    if (value === undefined) delete properties[f.key];
    else properties[f.key] = value;

    const type = componentType(c.typeKey);
    const check = type ? propertiesSchema(type).safeParse(properties) : null;
    if (check && !check.success) {
      this.error.set(check.error.issues[0]?.message ?? 'Invalid value.');
      el.value = String(c.properties[f.key] ?? ''); // put the previous value back
      return;
    }
    this.error.set(null);
    this.drawing.update([{ ...c, properties }], `Change ${f.label.toLowerCase()}`);
  }
}
