import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CHECKS, type Issue } from '@electro/shared';

/** Validation issues of the floor being edited (plus project-wide ones), live while drawing. */
@Component({
  selector: 'app-checks-panel',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <span class="faint small">{{ issues().length ? issues().length + ' open issue(s) on this floor' : 'No problems on this floor' }}</span>
      <a class="btn btn-sm btn-ghost" [routerLink]="['/projects', projectId(), 'installation']" [queryParams]="{ tab: 'checks' }">All →</a>
    </div>
    <ul>
      @for (i of issues(); track i.id) {
        <li>
          <button type="button" class="issue" (click)="focus.emit(i)" [disabled]="!i.componentIds.length && !i.wireIds.length"
                  [title]="i.componentIds.length || i.wireIds.length ? 'Select and zoom to it' : ''">
            <span class="dot" [class]="'dot ' + i.severity"></span>
            <span class="txt"><strong>{{ titles[i.code] }}</strong><br />{{ i.message }}</span>
          </button>
        </li>
      }
    </ul>
    @if (ignored()) { <p class="faint small">{{ ignored() }} ignored issue(s) hidden. Manage them in the project's Checks tab.</p> }
  `,
  styles: `
    .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
    .small { font-size: 12px; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .issue { display: flex; gap: 8px; width: 100%; text-align: left; padding: 7px 8px; border: 1px solid var(--border);
             border-radius: 6px; background: var(--bg-elev); color: var(--text); font: 12px var(--font); cursor: pointer; }
    .issue:hover:not(:disabled) { border-color: var(--border-strong); background: var(--bg-elev-2); }
    .issue:disabled { cursor: default; }
    .txt { line-height: 1.35; color: var(--text-muted); }
    .txt strong { color: var(--text); font-weight: 600; }
    .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; }
    .dot.error { background: #f06a6a; }
    .dot.warning { background: var(--warn); }
    .dot.info { background: var(--accent); }
  `,
})
export class ChecksPanel {
  readonly issues = input.required<Issue[]>();
  readonly ignored = input(0);
  readonly projectId = input.required<string>();
  readonly focus = output<Issue>();
  protected readonly titles = CHECKS;
}
