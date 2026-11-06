import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CIRCUIT_CATEGORIES, DEFAULT_CIRCUIT, nextCircuitNumber, type CircuitDto } from '@electro/shared';
import { Api } from '../../../core/api';
import { toApiError } from '../../../core/api-error';
import { DrawingStore } from '../state/drawing.store';
import { I18N_PIPES } from '../../../core/i18n/t.pipe';
import { t } from '../../../core/i18n/i18n.service';

/** Circuits of the project inside the editor: highlight, create, and assign the selection. */
@Component({
  selector: 'app-circuits-panel',
  imports: [I18N_PIPES, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="top">
      <button class="btn btn-sm" type="button" (click)="creating.set(!creating())">{{ (creating() ? 'Cancel' : '+ New circuit') | t }}</button>
      <a class="btn btn-sm btn-ghost" [routerLink]="['/projects', projectId(), 'installation']">{{ 'Details' | t }} →</a>
    </div>

    @if (creating()) {
      <form class="new" (ngSubmit)="create()">
        <input class="input" name="name" [(ngModel)]="name" [placeholder]="'Name, e.g. Kitchen sockets' | t" maxlength="120" required />
        <select class="input" name="category" [(ngModel)]="category">
          @for (c of categories; track c) { <option [value]="c">{{ c | tx }}</option> }
        </select>
        <select class="input" name="board" [(ngModel)]="boardId">
          <option value="">{{ 'No board yet' | t }}</option>
          @for (b of drawing.projectBoards(); track b.id) { <option [value]="b.id">{{ b.label }} · {{ b.floorName }}</option> }
        </select>
        <button class="btn btn-sm btn-primary" type="submit" [disabled]="busy()">
          {{ drawing.selectionCount() ? ('Create and assign {n} selected' | t: { n: drawing.selectionCount() }) : ('Create' | t) }}
        </button>
      </form>
    }
    @if (error(); as e) { <div class="field-error">{{ e | tx }}</div> }

    @if (drawing.selectionCount()) {
      <p class="hint">{{ '{n} selected: click Assign on a circuit, or' | t: { n: drawing.selectionCount() } }}
        <button class="link" type="button" (click)="drawing.assignSelectionToCircuit(null)">{{ 'remove from circuit' | t }}</button>.</p>
    }

    <ul class="list">
      @for (c of rows(); track c.circuit.id) {
        <li [class.on]="drawing.highlightCircuit() === c.circuit.id">
          <button class="name" type="button" (click)="toggleHighlight(c.circuit.id)" [title]="'Highlight circuit {n} on the plan' | t: { n: c.circuit.number }">
            <span class="num mono">{{ c.circuit.number }}</span>
            <span class="txt">{{ c.circuit.name }}<span class="faint"> · {{ '{n} here' | t: { n: c.count } }}</span></span>
          </button>
          @if (drawing.selectionCount()) {
            <button class="btn btn-sm" type="button" (click)="drawing.assignSelectionToCircuit(c.circuit.id)">{{ 'Assign' | t }}</button>
          }
        </li>
      } @empty {
        <li class="faint empty">{{ 'No circuits yet. Create one, then assign components and wires to it.' | t }}</li>
      }
    </ul>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; min-height: 0; flex: 1; }
    .top { display: flex; justify-content: space-between; }
    .new { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); }
    .new .input { height: 28px; font-size: 13px; }
    .hint { margin: 0; font-size: 12px; color: var(--text-muted); }
    .link { border: 0; background: none; color: var(--accent); cursor: pointer; padding: 0; font: inherit; }
    .list { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
    .list li { display: flex; align-items: center; gap: 6px; padding: 3px 2px; border-radius: var(--radius); }
    .list li.on { background: var(--accent-soft); }
    .name { flex: 1; display: flex; gap: 8px; align-items: baseline; min-width: 0; border: 0; background: none; color: var(--text);
            text-align: left; cursor: pointer; font: 13px var(--font); padding: 4px; }
    .num { min-width: 28px; color: var(--accent); font-weight: 600; }
    .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empty { font-size: 12px; padding: 8px 0; }
  `,
})
export class CircuitsPanel {
  protected readonly drawing = inject(DrawingStore);
  private readonly api = inject(Api);
  readonly projectId = input.required<string>();
  /** Emitted after a circuit was created so the editor reloads project data. */
  readonly created = output<CircuitDto>();

  protected readonly categories = CIRCUIT_CATEGORIES;
  protected readonly creating = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected name = '';
  protected category: (typeof CIRCUIT_CATEGORIES)[number] = 'Lighting';
  protected boardId = '';

  protected readonly rows = computed(() => {
    const counts = new Map<string, number>();
    for (const c of this.drawing.components()) if (c.circuitId) counts.set(c.circuitId, (counts.get(c.circuitId) ?? 0) + 1);
    for (const w of this.drawing.wires()) if (w.circuitId) counts.set(w.circuitId, (counts.get(w.circuitId) ?? 0) + 1);
    return [...this.drawing.circuits()]
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
      .map((circuit) => ({ circuit, count: counts.get(circuit.id) ?? 0 }));
  });

  protected toggleHighlight(id: string): void {
    this.drawing.highlightCircuit.set(this.drawing.highlightCircuit() === id ? null : id);
  }

  protected async create(): Promise<void> {
    const name = this.name.trim();
    if (!name) {
      this.error.set(t('Enter a circuit name.'));
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const c = await this.api.createCircuit(this.projectId(), {
        ...DEFAULT_CIRCUIT,
        number: nextCircuitNumber(this.drawing.circuits()),
        name,
        category: this.category,
        boardComponentId: this.boardId || null,
      });
      this.drawing.circuits.update((list) => [...list, c]);
      if (this.drawing.selectionCount()) this.drawing.assignSelectionToCircuit(c.id);
      this.drawing.highlightCircuit.set(c.id);
      this.created.emit(c);
      this.creating.set(false);
      this.name = '';
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
