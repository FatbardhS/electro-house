import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { CIRCUIT_CATEGORIES, CROSS_SECTIONS_MM2, electricalProfileSchema, type ElectricalProfile } from '@electro/shared';
import { Api } from '../../core/api';
import { toApiError } from '../../core/api-error';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import { t, tx } from '../../core/i18n/i18n.service';

/**
 * The electrician’s own rules for this project: the largest breaker allowed per cable cross-section
 * and the power factor used for current estimates. Nothing is pre-filled from a standard.
 */
@Component({
  selector: 'app-profile-form',
  imports: [I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="card form" (submit)="$event.preventDefault(); save()">
      <p class="faint small intro">{{ 'Enter the limits from the standard and installation method you work to. Electro House does not ship built-in values: an empty field means that cross-section is not checked.' | t }}</p>

      <div class="row">
        <label class="f"><span>{{ 'Profile name' | t }}</span>
          <input class="input" maxlength="80" [value]="name()" [placeholder]="'e.g. Copper, in conduit in wall' | t"
                 (input)="name.set(val($event))" /></label>
        <label class="f narrow"><span>{{ 'Power factor (cos φ)' | t }}</span>
          <input class="input mono" type="number" min="0.1" max="1" step="0.01" [value]="powerFactor()"
                 (input)="powerFactor.set(val($event))" /></label>
      </div>

      <h3>{{ 'Maximum breaker rating per cross-section' | t }}</h3>
      <div class="limits">
        @for (s of sections; track s) {
          <label class="lim"><span class="mono">{{ s }} mm²</span>
            <input class="input mono" type="number" min="1" max="4000" step="1" placeholder="—"
                   [value]="limits()[key(s)] ?? ''" (input)="setLimit(s, $event)" />
            <span class="faint">A</span></label>
        }
      </div>

      <h3>{{ 'Voltage drop' | t }}</h3>
      <label class="f narrow"><span>{{ 'Maximum voltage drop % (empty = not checked)' | t }}</span>
        <input class="input mono" type="number" min="0.1" max="50" step="0.1" [value]="maxDrop()" placeholder="—"
               (input)="maxDrop.set(val($event))" /></label>
      <p class="faint small">{{ 'Estimated along the longest cable path from the board to a component of each circuit (copper, ρ = 0.0225 Ω·mm²/m), using the circuit\’s estimated current and cross-section.' | t }}</p>

      <h3>{{ 'Circuit categories that need RCD protection' | t }}</h3>
      <div class="cats">
        @for (c of categories; track c) {
          <label class="check"><input type="checkbox" [checked]="rcd().has(c)" (change)="toggleRcd(c)" /> {{ c | tx }}</label>
        }
      </div>

      @if (error(); as e) { <div class="banner banner-error" role="alert">{{ e | tx }}</div> }
      @if (saved()) { <div class="banner banner-ok" role="status">{{ 'Rules saved. Circuit warnings are updated.' | t }}</div> }
      <div class="actions">
        <button class="btn btn-primary" type="submit" [disabled]="busy()">{{ (busy() ? 'Saving…' : 'Save rules') | t }}</button>
      </div>
    </form>
  `,
  styles: `
    .form { padding: 16px; max-width: 760px; }
    .intro { margin: 0 0 14px; }
    .small { font-size: 12px; }
    .row { display: flex; gap: 14px; flex-wrap: wrap; }
    .f { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); flex: 1 1 260px; }
    .f.narrow { flex: 0 1 160px; }
    h3 { font-size: 13px; margin: 18px 0 10px; }
    .limits { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px 14px; }
    .lim { display: grid; grid-template-columns: 64px 1fr 14px; align-items: center; gap: 8px; font-size: 12.5px; }
    .banner { margin-top: 14px; }
    .banner-ok { background: rgba(80, 200, 120, 0.12); color: var(--text); padding: 10px 12px; border-radius: 6px; }
    .actions { margin-top: 16px; }
    .cats { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 4px 14px; font-size: 13px; }
    .check { display: flex; gap: 8px; align-items: center; }
  `,
})
export class ProfileForm {
  private readonly api = inject(Api);
  readonly projectId = input.required<string>();
  readonly profile = input.required<ElectricalProfile>();
  readonly changed = output<void>();

  protected readonly sections = CROSS_SECTIONS_MM2;
  protected readonly name = signal('');
  protected readonly powerFactor = signal('1');
  protected readonly limits = signal<Record<string, string>>({});
  protected readonly maxDrop = signal('');
  protected readonly rcd = signal(new Set<string>());
  protected readonly categories = CIRCUIT_CATEGORIES;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal(false);

  constructor() {
    // Reset the form whenever the stored profile changes (initial load, after save).
    effect(() => {
      const p = this.profile();
      this.name.set(p.name);
      this.powerFactor.set(String(p.powerFactor));
      this.limits.set(Object.fromEntries(Object.entries(p.maxBreakerByCrossSection).map(([k, v]) => [k, String(v)])));
      this.maxDrop.set(p.maxVoltageDropPct === null ? '' : String(p.maxVoltageDropPct));
      this.rcd.set(new Set(p.rcdRequiredCategories));
    });
  }

  protected key(s: number): string {
    return String(s);
  }

  protected val(e: Event): string {
    this.saved.set(false);
    return (e.target as HTMLInputElement).value.trim();
  }

  protected toggleRcd(c: string): void {
    this.saved.set(false);
    this.rcd.update((set) => {
      const next = new Set(set);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  protected setLimit(s: number, e: Event): void {
    const v = this.val(e);
    this.limits.update((l) => ({ ...l, [this.key(s)]: v }));
  }

  protected async save(): Promise<void> {
    const max: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.limits())) {
      if (v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        this.error.set(t('The limit for {k} mm² must be a positive number of amperes.', { k }));
        return;
      }
      max[k] = n;
    }
    const check = electricalProfileSchema.safeParse({
      name: this.name(),
      powerFactor: Number(this.powerFactor()),
      maxBreakerByCrossSection: max,
      maxVoltageDropPct: this.maxDrop().trim() === '' ? null : Number(this.maxDrop()),
      rcdRequiredCategories: CIRCUIT_CATEGORIES.filter((c) => this.rcd().has(c)),
    });
    if (!check.success) {
      const issue = check.error.issues[0];
      const field = issue?.path[0];
      this.error.set(
        field === 'powerFactor'
          ? t('Power factor must be between 0.1 and 1.')
          : field === 'maxVoltageDropPct'
            ? t('Maximum voltage drop must be a number between 0.1 and 50 %.')
            : (issue?.message ?? t('Invalid rules.')),
      );
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.api.setElectricalProfile(this.projectId(), check.data);
      this.saved.set(true);
      this.changed.emit();
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
