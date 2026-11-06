import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { I18N_PIPES } from '../../core/i18n/t.pipe';

/** Loading placeholder. */
@Component({
  selector: 'app-loading',
  imports: [I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="state"><div class="spinner"></div><span class="muted">{{ label() ?? ('Loading…' | t) }}</span></div>`,
  styleUrl: './states.css',
})
export class LoadingState {
  readonly label = input<string | null>(null);
}

/** Error with an optional retry button. */
@Component({
  selector: 'app-error-state',
  imports: [I18N_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="state">
      <div class="banner banner-error" role="alert">{{ message() | tx }}</div>
      @if (retryable()) {
        <button class="btn btn-sm" type="button" (click)="retry.emit()">{{ 'Try again' | t }}</button>
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
