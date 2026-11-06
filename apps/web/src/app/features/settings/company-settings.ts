import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { DEFAULT_ORGANIZATION_SETTINGS, MAX_LOGO_BYTES, organizationSettingsSchema, type OrganizationSettings } from '@electro/shared';
import { Api } from '../../core/api';
import { toApiError } from '../../core/api-error';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import { I18n, t, tx } from '../../core/i18n/i18n.service';

/** Currency, VAT, markup, labour rate, cable allowances and the details printed on PDF title blocks. */
@Component({
  selector: 'app-company-settings',
  imports: [I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = draft();
    <form class="card form" (submit)="$event.preventDefault(); save()">
      <h3>{{ 'Prices and costs' | t }}</h3>
      <div class="grid">
        <label class="f"><span>{{ 'Currency (ISO code)' | t }}</span>
          <input class="input mono" maxlength="3" [value]="s.currency" (input)="set({ currency: val($event).toUpperCase() })" [disabled]="readonly()" /></label>
        <label class="f"><span>{{ 'VAT %' | t }}</span>
          <input class="input mono" type="number" min="0" max="100" step="0.1" [value]="s.vatPct" (input)="set({ vatPct: num($event) })" [disabled]="readonly()" /></label>
        <label class="f"><span>{{ 'Markup on materials %' | t }}</span>
          <input class="input mono" type="number" min="0" step="0.1" [value]="s.markupPct" (input)="set({ markupPct: num($event) })" [disabled]="readonly()" /></label>
        <label class="f"><span>{{ 'Labour rate per hour' | t }}</span>
          <input class="input mono" type="number" min="0" step="0.5" [value]="s.hourlyRate" (input)="set({ hourlyRate: num($event) })" [disabled]="readonly()" /></label>
      </div>

      <h3>{{ 'Cable allowances' | t }}</h3>
      <p class="faint small">{{ 'Added to measured lengths in the bill of materials and shown in separate columns. Projects can override them.' | t }}</p>
      <div class="grid">
        <label class="f"><span>{{ 'Waste %' | t }}</span>
          <input class="input mono" type="number" min="0" max="100" step="0.5" [value]="s.allowances.wastePct"
                 (input)="setAllowance({ wastePct: num($event) })" [disabled]="readonly()" /></label>
        <label class="f"><span>{{ 'Reserve per connected end (m)' | t }}</span>
          <input class="input mono" type="number" min="0" max="10" step="0.05" [value]="s.allowances.endReserveM"
                 (input)="setAllowance({ endReserveM: num($event) })" [disabled]="readonly()" /></label>
        <label class="f"><span>{{ 'Reserve at distribution boards (m)' | t }}</span>
          <input class="input mono" type="number" min="0" max="20" step="0.05" [value]="s.allowances.boardTailM"
                 (input)="setAllowance({ boardTailM: num($event) })" [disabled]="readonly()" /></label>
        <label class="f check"><input type="checkbox" [checked]="s.roundToPacks" (change)="set({ roundToPacks: checked($event) })" [disabled]="readonly()" />
          <span>{{ 'Round order quantities up to whole packs / drums' | t }}</span></label>
      </div>

      <h3>{{ 'Details on PDF title blocks' | t }}</h3>
      <div class="grid">
        <label class="f wide"><span>{{ 'Address' | t }}</span>
          <input class="input" maxlength="300" [value]="s.company.address" (input)="setCompany({ address: val($event) })" [disabled]="readonly()" /></label>
        <label class="f"><span>{{ 'Phone' | t }}</span>
          <input class="input" maxlength="60" [value]="s.company.phone" (input)="setCompany({ phone: val($event) })" [disabled]="readonly()" /></label>
        <label class="f"><span>{{ 'Email' | t }}</span>
          <input class="input" maxlength="200" [value]="s.company.email" (input)="setCompany({ email: val($event) })" [disabled]="readonly()" /></label>
        <label class="f"><span>{{ 'Website' | t }}</span>
          <input class="input" maxlength="200" [value]="s.company.website" (input)="setCompany({ website: val($event) })" [disabled]="readonly()" /></label>
        <label class="f"><span>{{ 'Tax / VAT number' | t }}</span>
          <input class="input" maxlength="60" [value]="s.company.taxNumber" (input)="setCompany({ taxNumber: val($event) })" [disabled]="readonly()" /></label>
      </div>
      <div class="logo">
        @if (s.logoDataUrl) { <img [src]="s.logoDataUrl" alt="Company logo" /> } @else { <span class="faint small">{{ 'No logo' | t }}</span> }
        @if (!readonly()) {
          <label class="btn btn-sm">{{ 'Choose logo (PNG or JPEG, max 300 KB)' | t }}
            <input type="file" accept="image/png,image/jpeg" hidden (change)="pickLogo($event)" /></label>
          @if (s.logoDataUrl) { <button class="btn btn-sm btn-ghost" type="button" (click)="set({ logoDataUrl: null })">{{ 'Remove' | t }}</button> }
        }
      </div>

      @if (error(); as e) { <div class="banner banner-error" role="alert">{{ e | tx }}</div> }
      @if (saved()) { <div class="banner banner-ok" role="status">{{ 'Settings saved.' | t }}</div> }
      @if (readonly()) {
        <p class="faint small">{{ 'Read-only: only the owner or an admin can change company settings, and only while the subscription is active.' | t }}</p>
      } @else {
        <div class="actions"><button class="btn btn-primary" type="submit" [disabled]="busy()">{{ (busy() ? 'Saving…' : 'Save settings') | t }}</button></div>
      }
    </form>
  `,
  styles: `
    .form { padding: 16px 18px; max-width: 900px; }
    h3 { font-size: 13px; margin: 18px 0 10px; }
    h3:first-child { margin-top: 0; }
    .small { font-size: 12px; margin: -4px 0 10px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px 14px; }
    .f { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
    .f.wide { grid-column: 1 / -1; }
    .f.check { flex-direction: row; align-items: center; gap: 8px; grid-column: span 2; }
    .logo { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
    .logo img { max-height: 48px; max-width: 200px; background: #fff; padding: 4px; border-radius: 4px; }
    .banner { margin-top: 14px; }
    .banner-ok { background: rgba(80, 200, 120, 0.12); padding: 10px 12px; border-radius: 6px; }
    .actions { margin-top: 16px; }
    @media (max-width: 640px) { .f.check { grid-column: auto; } }
  `,
})
export class CompanySettings {
  private readonly api = inject(Api);
  readonly settings = input.required<OrganizationSettings>();
  readonly readonly = input(false);
  readonly changed = output<void>();

  protected readonly draft = signal<OrganizationSettings>(DEFAULT_ORGANIZATION_SETTINGS);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal(false);

  constructor() {
    effect(() => this.draft.set(structuredClone(this.settings())));
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
  protected num(e: Event): number {
    const v = (e.target as HTMLInputElement).value;
    return v === '' ? 0 : Number(v);
  }
  protected checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  protected set(p: Partial<OrganizationSettings>): void {
    this.saved.set(false);
    this.draft.update((d) => ({ ...d, ...p }));
  }
  protected setAllowance(p: Partial<OrganizationSettings['allowances']>): void {
    this.set({ allowances: { ...this.draft().allowances, ...p } });
  }
  protected setCompany(p: Partial<OrganizationSettings['company']>): void {
    this.set({ company: { ...this.draft().company, ...p } });
  }

  protected pickLogo(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return this.error.set(t('The logo must be a PNG or JPEG image.'));
    if (file.size > MAX_LOGO_BYTES) return this.error.set(t('The logo is too large (max 300 KB).'));
    const reader = new FileReader();
    reader.onload = () => {
      this.error.set(null);
      this.set({ logoDataUrl: String(reader.result) });
    };
    reader.readAsDataURL(file);
  }

  protected async save(): Promise<void> {
    const check = organizationSettingsSchema.safeParse(this.draft());
    if (!check.success) {
      const i = check.error.issues[0];
      this.error.set(i ? `${i.path.join(' ')}: ${tx(i.message)}` : t('Invalid settings.'));
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.api.setOrganizationSettings(check.data);
      this.saved.set(true);
      this.changed.emit();
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
