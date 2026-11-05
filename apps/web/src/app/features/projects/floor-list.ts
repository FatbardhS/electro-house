import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FLOOR_PRESETS, MAX_PLAN_FILE_BYTES, type FloorDto } from '@electro/shared';
import { Api } from '../../core/api';
import { toApiError } from '../../core/api-error';
import { ConfirmService } from '../../shared/ui/confirm-dialog';
import { EmptyState } from '../../shared/ui/states';

/** Floor management for a project: add, rename, reorder, delete, and upload/replace each floor's plan PDF. */
@Component({
  selector: 'app-floor-list',
  imports: [FormsModule, RouterLink, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error(); as e) { <div class="banner banner-error" role="alert">{{ e }}</div> }

    @if (floors().length === 0) {
      <app-empty-state heading="No floors yet"
                       text="Add each floor of the building, then upload its architectural plan PDF." />
    } @else {
      <ul class="floors">
        @for (f of floors(); track f.id; let i = $index, last = $last) {
          <li class="floor">
            <div class="order">
              <button class="btn btn-sm btn-icon btn-ghost" type="button" [disabled]="i === 0 || busy()"
                      (click)="move(i, -1)" title="Move up" aria-label="Move {{ f.name }} up">↑</button>
              <button class="btn btn-sm btn-icon btn-ghost" type="button" [disabled]="last || busy()"
                      (click)="move(i, 1)" title="Move down" aria-label="Move {{ f.name }} down">↓</button>
            </div>

            <div class="info">
              @if (renamingId() === f.id) {
                <form class="rename" (ngSubmit)="saveRename(f)">
                  <input class="input" name="rename" [(ngModel)]="renameValue" aria-label="Floor name" autofocus
                         (keydown.escape)="renamingId.set(null)" />
                  <button class="btn btn-sm btn-primary" type="submit">Save</button>
                  <button class="btn btn-sm" type="button" (click)="renamingId.set(null)">Cancel</button>
                </form>
              } @else {
                <div class="name">{{ f.name }}</div>
              }
              <div class="plan">
                @if (uploading()[f.id] !== undefined) {
                  <span class="muted">Uploading… {{ (uploading()[f.id]! * 100).toFixed(0) }}%</span>
                  <div class="progress"><div [style.width.%]="uploading()[f.id]! * 100"></div></div>
                } @else if (f.planFile) {
                  <span class="muted">{{ f.planFile.originalName }}</span>
                  <span class="faint">· {{ f.planFile.pageCount }} page{{ f.planFile.pageCount === 1 ? '' : 's' }}
                    · {{ (f.planFile.sizeBytes / 1024 / 1024).toFixed(1) }} MB</span>
                  @if (f.calibration && !f.calibrationNeedsCheck) {
                    <span class="badge badge-completed">Calibrated</span>
                  } @else if (f.calibrationNeedsCheck) {
                    <span class="badge badge-in_progress">Check scale</span>
                  } @else {
                    <span class="badge">Not calibrated</span>
                  }
                } @else {
                  <span class="faint">No plan uploaded</span>
                }
              </div>
            </div>

            <div class="actions">
              <input #file type="file" accept="application/pdf,.pdf" hidden (change)="upload(f, file)" />
              <button class="btn btn-sm" type="button" [disabled]="uploading()[f.id] !== undefined"
                      (click)="file.click()">{{ f.planFile ? 'Replace PDF' : 'Upload PDF' }}</button>
              @if (f.planFile) {
                <a class="btn btn-sm btn-primary" [routerLink]="['/projects', projectId(), 'floors', f.id]">Open editor</a>
              }
              <button class="btn btn-sm btn-ghost" type="button" (click)="startRename(f)">Rename</button>
              <button class="btn btn-sm btn-ghost btn-danger" type="button" (click)="remove(f)">Delete</button>
            </div>
          </li>
        }
      </ul>
    }

    <form class="add" (ngSubmit)="add()">
      <select class="input" name="preset" [ngModel]="selectedPreset()" (ngModelChange)="choosePreset($event)"
              aria-label="Floor name preset">
        @for (p of availablePresets(); track p) { <option [value]="p">{{ p }}</option> }
        <option value="__custom">Custom name…</option>
      </select>
      @if (selectedPreset() === '__custom') {
        <input class="input" name="custom" [(ngModel)]="newCustom" placeholder="e.g. Garage, Mezzanine"
               aria-label="Custom floor name" maxlength="80" />
      }
      <button class="btn" type="submit" [disabled]="busy()">+ Add floor</button>
    </form>
  `,
  styles: `
    .banner { margin-bottom: 12px; }
    .floors { list-style: none; margin: 0; padding: 0; }
    .floor {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px; border-bottom: 1px solid var(--border);
    }
    .order { display: flex; flex-direction: column; gap: 2px; }
    .info { flex: 1; min-width: 0; }
    .name { font-weight: 600; }
    .plan { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; margin-top: 3px; }
    .progress { width: 120px; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
    .progress div { height: 100%; background: var(--accent); }
    .rename { display: flex; gap: 6px; max-width: 420px; }
    .rename .input { height: 28px; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .add { display: flex; gap: 8px; padding: 14px; }
    .add .input { max-width: 220px; }
  `,
})
export class FloorList {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);

  readonly projectId = input.required<string>();
  readonly floors = input.required<FloorDto[]>();
  /** Emitted after any change; the parent reloads the project. */
  readonly changed = output<void>();

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly uploading = signal<Record<string, number>>({});
  protected readonly renamingId = signal<string | null>(null);
  protected renameValue = '';
  protected newCustom = '';
  /** What the user picked; may be stale after a floor is added, so `selectedPreset` resolves it. */
  private readonly chosenPreset = signal<string | null>(null);

  protected readonly availablePresets = computed(() => {
    const used = new Set(this.floors().map((f) => f.name.toLowerCase()));
    return FLOOR_PRESETS.filter((p) => !used.has(p.toLowerCase())) as string[];
  });

  protected readonly selectedPreset = computed(() => {
    const chosen = this.chosenPreset();
    const list = this.availablePresets();
    return chosen === '__custom' || (chosen && list.includes(chosen)) ? chosen : (list[0] ?? '__custom');
  });

  protected choosePreset(value: string): void {
    this.chosenPreset.set(value);
  }

  protected async add(): Promise<void> {
    const preset = this.selectedPreset();
    const name = (preset === '__custom' ? this.newCustom : preset).trim();
    if (!name) {
      this.error.set('Enter a floor name.');
      return;
    }
    await this.run(() => this.api.createFloor(this.projectId(), name));
    this.newCustom = '';
  }

  protected startRename(f: FloorDto): void {
    this.renameValue = f.name;
    this.renamingId.set(f.id);
  }

  protected async saveRename(f: FloorDto): Promise<void> {
    const name = this.renameValue.trim();
    if (!name) return;
    await this.run(() => this.api.renameFloor(f.id, name));
    this.renamingId.set(null);
  }

  protected async move(index: number, delta: number): Promise<void> {
    const ids = this.floors().map((f) => f.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    await this.run(() => this.api.reorderFloors(this.projectId(), ids));
  }

  protected async remove(f: FloorDto): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Delete “${f.name}”?`,
      message: 'The floor, its plan PDF and everything drawn on it will be deleted permanently.',
      confirmLabel: 'Delete floor',
      danger: true,
    });
    if (ok) await this.run(() => this.api.deleteFloor(f.id));
  }

  protected async upload(f: FloorDto, inputEl: HTMLInputElement): Promise<void> {
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    this.error.set(null);
    if (file.size > MAX_PLAN_FILE_BYTES) {
      this.error.set(`“${file.name}” is larger than ${MAX_PLAN_FILE_BYTES / 1024 / 1024} MB.`);
      return;
    }
    if (f.planFile) {
      const ok = await this.confirm.ask({
        title: 'Replace the floor plan?',
        message:
          'Everything drawn on this floor is kept. If the new PDF has a different scale or position, ' +
          'you will be asked to check the calibration.',
        confirmLabel: 'Replace PDF',
      });
      if (!ok) return;
    }
    this.uploading.update((u) => ({ ...u, [f.id]: 0 }));
    this.api.uploadPlan(f.id, file).subscribe({
      next: (e) => this.uploading.update((u) => ({ ...u, [f.id]: e.progress })),
      error: (err) => {
        this.clearUpload(f.id);
        this.error.set(`Upload of “${file.name}” failed: ${toApiError(err).message}`);
      },
      complete: () => {
        this.clearUpload(f.id);
        this.changed.emit();
      },
    });
  }

  private clearUpload(id: string): void {
    this.uploading.update(({ [id]: _, ...rest }) => rest);
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      this.changed.emit();
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
