import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';

/** Native <dialog> wrapper. Content is projected; `open` controls visibility; Esc emits `closed`. */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="modal" (cancel)="$event.preventDefault(); closed.emit()">
      @if (open()) {
        <div class="modal-head"><h2>{{ heading() }}</h2></div>
        <div class="modal-body"><ng-content /></div>
      }
    </dialog>
  `,
})
export class Modal {
  readonly heading = input.required<string>();
  readonly open = input(false);
  readonly closed = output<void>();
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const el = this.dlg().nativeElement;
      if (this.open() && !el.open) el.showModal();
      if (!this.open() && el.open) el.close();
    });
  }
}
