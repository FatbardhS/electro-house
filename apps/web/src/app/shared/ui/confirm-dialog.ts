import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injectable,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

/** App-wide confirmation dialog. <app-confirm-dialog> is placed once in the root component. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly current = signal<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  ask(options: ConfirmOptions): Promise<boolean> {
    this.current()?.resolve(false);
    return new Promise((resolve) => this.current.set({ ...options, resolve }));
  }
}

@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="modal" (cancel)="answer(false)">
      @if (service.current(); as c) {
        <div class="modal-head"><h2>{{ c.title }}</h2></div>
        <div class="modal-body">
          <p class="muted" style="margin-top: 0; white-space: pre-line">{{ c.message }}</p>
          <div class="form-actions">
            <button class="btn" type="button" (click)="answer(false)">Cancel</button>
            <button
              class="btn"
              [class.btn-primary]="!c.danger"
              [class.btn-danger]="c.danger"
              type="button"
              (click)="answer(true)"
            >
              {{ c.confirmLabel ?? 'Confirm' }}
            </button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class ConfirmDialog {
  protected readonly service = inject(ConfirmService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    // Sync the native <dialog> open state with the service (DOM side effect).
    effect(() => {
      const el = this.dlg().nativeElement;
      const open = !!this.service.current();
      if (open && !el.open) el.showModal();
      if (!open && el.open) el.close();
    });
  }

  protected answer(ok: boolean): void {
    const c = this.service.current();
    if (!c) return;
    this.service.current.set(null);
    c.resolve(ok);
  }
}
