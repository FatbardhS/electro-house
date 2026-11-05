import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Loading placeholder. */
@Component({
  selector: 'app-loading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="state"><div class="spinner"></div><span class="muted">{{ label() }}</span></div>`,
  styleUrl: './states.css',
})
export class LoadingState {
  readonly label = input('Loading…');
}

/** Error with an optional retry button. */
@Component({
  selector: 'app-error-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="state">
      <div class="banner banner-error" role="alert">{{ message() }}</div>
      @if (retryable()) {
        <button class="btn btn-sm" type="button" (click)="retry.emit()">Try again</button>
      }
    </div>
  `,
  styleUrl: './states.css',
})
export class ErrorState {
  readonly message = input.required<string>();
  readonly retryable = input(true);
  readonly retry = output<void>();
}

/** Empty list / no data yet, with a call to action projected as content. */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="state empty">
      <h3>{{ heading() }}</h3>
      @if (text()) {
        <p class="muted">{{ text() }}</p>
      }
      <ng-content />
    </div>
  `,
  styleUrl: './states.css',
})
export class EmptyState {
  readonly heading = input.required<string>();
  readonly text = input<string>();
}
