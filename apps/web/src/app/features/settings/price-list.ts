import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MATERIAL_UNITS, materialInputSchema, materialUpdateSchema, parseDecimal, type MaterialDto, type MaterialInput } from '@electro/shared';
import { Api } from '../../core/api';
import { toApiError } from '../../core/api-error';
import { ConfirmService } from '../../shared/ui/confirm-dialog';
import { Modal } from '../../shared/ui/modal';
import { EmptyState } from '../../shared/ui/states';
import { I18N_PIPES } from '../../core/i18n/t.pipe';
import { I18n, t, tx } from '../../core/i18n/i18n.service';

interface ImportPreview {
  csv: string;
  fileName: string;
  created: number;
  updated: number;
  errors: { line: number; message: string }[];
}

/** The company price list: inline editing, archive, CSV import with preview, CSV export. */
@Component({
  selector: 'app-price-list',
  imports: [I18N_PIPES, EmptyState, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar">
      <input class="input search" type="search" [placeholder]="'Search name, code or category' | t" [value]="query()" (input)="query.set(val($event))" />
      <label class="faint small check"><input type="checkbox" [checked]="showArchived()" (change)="showArchived.set(checked($event))" /> {{ 'Show archived' | t }}</label>
      <span class="spacer"></span>
      @if (!readonly()) {
        <button class="btn btn-sm btn-primary" type="button" (click)="add()" [disabled]="busy()">+ {{ 'Add material' | t }}</button>
        <label class="btn btn-sm">{{ 'Import CSV' | t }}<input type="file" accept=".csv,text/csv,text/plain" hidden (change)="pickCsv($event)" /></label>
      }
      <a class="btn btn-sm" href="/api/materials/export" download="price-list.csv">{{ 'Export CSV' | t }}</a>
    </div>
    @if (error(); as e) { <div class="banner banner-error" role="alert">{{ e | tx }}</div> }
    @if (notice(); as n) { <div class="banner banner-ok" role="status">{{ n }}</div> }

    @if (materials().length === 0) {
      <div class="card">
        <app-empty-state [heading]="'Your price list is empty' | t"
          [text]="'Add materials one by one or import a CSV with the columns code, name, unit, price, pack size, category.' | t" />
        @if (!readonly()) {
          <div class="center"><button class="btn btn-sm" type="button" (click)="examples()" [disabled]="busy()">{{ 'Add example materials (fictional prices)' | t }}</button></div>
        }
      </div>
    } @else {
      <div class="card scroll">
        <table class="table dense">
          <thead><tr><th>{{ 'Code' | t }}</th><th>{{ 'Name' | t }}</th><th>{{ 'Unit' | t }}</th><th class="num">{{ 'Net price' | t }}</th><th class="num">{{ 'Pack size' | t }}</th><th>{{ 'Category' | t }}</th><th></th></tr></thead>
          <tbody>
            @for (m of visible(); track m.id) {
              <tr [class.archived]="m.archived">
                <td><input class="cell mono w8" [value]="m.code ?? ''" placeholder="—" (change)="save(m, { code: val($event) || null })" [disabled]="readonly()" /></td>
                <td><input class="cell w20" [value]="m.name" (change)="save(m, { name: val($event) })" [disabled]="readonly()" /></td>
                <td><input class="cell w4" [value]="m.unit" list="units" (change)="save(m, { unit: val($event) })" [disabled]="readonly()" /></td>
                <td class="num"><input class="cell mono w6 r" [value]="m.unitPrice" (change)="savePrice(m, $event)" [disabled]="readonly()" /> <span class="faint">{{ currency() }}</span></td>
                <td class="num"><input class="cell mono w5 r" [value]="m.packSize ?? ''" placeholder="—" (change)="savePack(m, $event)" [disabled]="readonly()" /></td>
                <td><input class="cell w10" [value]="m.category ?? ''" placeholder="—" (change)="save(m, { category: val($event) || null })" [disabled]="readonly()" /></td>
                <td class="acts">
                  @if (!readonly()) {
                    <button class="btn btn-sm btn-ghost" type="button" (click)="save(m, { archived: !m.archived })">{{ (m.archived ? 'Restore' : 'Archive') | t }}</button>
                    <button class="btn btn-sm btn-ghost btn-danger" type="button" (click)="remove(m)" [attr.aria-label]="'Delete {name}' | t: { name: m.name }">✕</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="faint">{{ 'No materials match “{q}”.' | t: { q: query() } }}</td></tr>
            }
          </tbody>
        </table>
        <datalist id="units">@for (u of units; track u) { <option [value]="u"></option> }</datalist>
      </div>
      <p class="faint small">{{ '{n} active material(s). Prices are net, in {cur}. Archived materials stay in existing rules but are hidden from pickers.' | t: { n: activeCount(), cur: currency() } }}</p>
    }

    <app-modal [heading]="'Import price list' | t" [open]="!!preview()" (closed)="preview.set(null)">
      @if (preview(); as p) {
        <p><strong>{{ p.fileName }}</strong></p>
        @if (p.errors.length) {
          <div class="banner banner-error">{{ 'Fix these rows and import again; nothing was changed.' | t }}</div>
          <ul class="errors">@for (e of p.errors; track $index) { <li>{{ 'Line {n}' | t: { n: e.line } }}: {{ e.message | tx }}</li> }</ul>
        } @else {
          <p>{{ '{a} new material(s) will be added and {b} existing one(s) updated (matched by code, or by name when there is no code).' | t: { a: p.created, b: p.updated } }}</p>
        }
        <div class="modal-actions">
          <button class="btn" type="button" (click)="preview.set(null)">{{ 'Cancel' | t }}</button>
          <button class="btn btn-primary" type="button" (click)="applyImport(p)" [disabled]="busy() || p.errors.length > 0 || p.created + p.updated === 0">{{ 'Import' | t }}</button>
        </div>
      }
    </app-modal>
  `,
  styles: `
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .search { max-width: 280px; }
    .check { display: flex; align-items: center; gap: 6px; }
    .spacer { flex: 1; }
    .small { font-size: 12px; }
    .banner { margin-bottom: 12px; }
    .banner-ok { background: rgba(80, 200, 120, 0.12); padding: 10px 12px; border-radius: 6px; }
    .center { text-align: center; padding: 0 0 18px; }
    .scroll { overflow-x: auto; }
    .dense th, .dense td { padding: 5px 6px; font-size: 12.5px; white-space: nowrap; }
    .num { text-align: right; }
    .cell { height: 26px; padding: 0 6px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--text); font: inherit; }
    .cell:hover:not(:disabled), .cell:focus { border-color: var(--border-strong); background: var(--bg-input); outline: none; }
    .r { text-align: right; }
    .w4 { width: 56px; } .w5 { width: 72px; } .w6 { width: 90px; } .w8 { width: 110px; } .w10 { width: 140px; } .w20 { width: 280px; }
    tr.archived td { opacity: 0.5; }
    .acts { text-align: right; }
    .errors { max-height: 240px; overflow: auto; font-size: 12.5px; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  `,
})
export class PriceList {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);
  readonly materials = input.required<MaterialDto[]>();
  readonly currency = input.required<string>();
  readonly readonly = input(false);
  readonly changed = output<void>();

  protected readonly units = MATERIAL_UNITS;
  protected readonly query = signal('');
  protected readonly showArchived = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly preview = signal<ImportPreview | null>(null);

  protected readonly activeCount = computed(() => this.materials().filter((m) => !m.archived).length);
  protected readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.materials().filter(
      (m) =>
        (this.showArchived() || !m.archived) &&
        (!q || [m.name, m.code ?? '', m.category ?? ''].some((s) => s.toLowerCase().includes(q))),
    );
  });

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value.trim();
  }
  protected checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  protected savePrice(m: MaterialDto, e: Event): Promise<void> {
    const n = parseDecimal(this.val(e));
    if (Number.isNaN(n)) {
      this.error.set(t('The price must be a number.'));
      return Promise.resolve();
    }
    return this.save(m, { unitPrice: n });
  }

  protected savePack(m: MaterialDto, e: Event): Promise<void> {
    const v = this.val(e);
    const n = v === '' ? null : parseDecimal(v);
    if (n !== null && Number.isNaN(n)) {
      this.error.set(t('The pack size must be a number.'));
      return Promise.resolve();
    }
    return this.save(m, { packSize: n });
  }

  protected async save(m: MaterialDto, patch: Partial<MaterialInput>): Promise<void> {
    const check = materialUpdateSchema.safeParse(patch);
    if (!check.success) {
      this.error.set(check.error.issues[0]?.message ?? t('Invalid value.'));
      return;
    }
    await this.run(() => this.api.updateMaterial(m.id, check.data));
  }

  protected async add(): Promise<void> {
    const input = materialInputSchema.parse({ code: null, name: t('New material'), unit: 'pcs', unitPrice: 0, packSize: null, category: null, archived: false });
    this.query.set('');
    await this.run(() => this.api.createMaterial(input));
  }

  protected async examples(): Promise<void> {
    await this.run(async () => {
      const r = await this.api.addExampleMaterials();
      this.notice.set(t('{n} example material(s) added. Replace their prices with your own.', { n: r.added }));
    });
  }

  protected async remove(m: MaterialDto): Promise<void> {
    const ok = await this.confirm.ask({
      title: t('Delete “{name}”?', { name: m.name }),
      message: t('The material is removed from the price list. A material used by rules cannot be deleted; archive it instead.'),
      confirmLabel: t('Delete material'),
      danger: true,
    });
    if (ok) await this.run(() => this.api.deleteMaterial(m.id));
  }

  protected async pickCsv(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    if (file.size > 1_500_000) {
      this.error.set(t('The file is too large (max 1.5 MB).'));
      return;
    }
    const csv = await file.text();
    await this.run(async () => {
      const r = await this.api.importMaterials(csv, false);
      this.preview.set({ csv, fileName: file.name, created: r.created, updated: r.updated, errors: r.errors });
    }, false);
  }

  protected async applyImport(p: ImportPreview): Promise<void> {
    await this.run(async () => {
      const r = await this.api.importMaterials(p.csv, true);
      this.preview.set(null);
      this.notice.set(r.applied ? t('Imported: {a} added, {b} updated.', { a: r.created, b: r.updated }) : t('Nothing was imported.'));
    });
  }

  private async run(action: () => Promise<unknown>, emit = true): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      await action();
      if (emit) this.changed.emit();
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
