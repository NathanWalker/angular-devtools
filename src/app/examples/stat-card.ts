import { Component, input, model, output } from '@angular/core';

@Component({
  selector: 'app-stat-card',
  template: `
    <article class="card">
      <button type="button" class="head" [attr.aria-expanded]="expanded()" (click)="toggle()">
        <span class="label">{{ label() }}</span>
        <span class="value">{{ value() }}</span>
        <svg class="chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      @if (expanded()) {
        <div class="body">
          <p class="hint">{{ hint() }}</p>
          <button type="button" class="refresh" (click)="refreshed.emit()">Refresh</button>
        </div>
      }
    </article>
  `,
  styles: `
    .card {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm, 8px);
      background: var(--surface);
      transition: border-color 0.15s var(--ease, ease);
    }
    .card:hover {
      border-color: var(--line-strong);
    }
    .head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto 16px;
      align-items: center;
      gap: 12px;
      width: 100%;
      min-height: 48px;
      padding: 8px 12px;
      border: 0;
      background: none;
      color: var(--ink);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .head:hover {
      background: var(--subtle);
    }
    .label {
      overflow: hidden;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .value {
      font-size: 20px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
    }
    .chevron {
      fill: none;
      stroke: var(--muted);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: transform 0.15s var(--ease, ease);
    }
    [aria-expanded='true'] .chevron {
      transform: rotate(180deg);
    }
    .body {
      display: grid;
      justify-items: start;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid var(--line);
    }
    .hint {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
    }
    .refresh {
      height: 32px;
      padding: 0 12px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm, 8px);
      background: var(--surface);
      color: var(--ink);
      font: inherit;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition:
        background-color 0.15s var(--ease, ease),
        border-color 0.15s var(--ease, ease);
    }
    .refresh:hover {
      border-color: var(--ink);
      background: var(--subtle);
    }
    .head:focus-visible {
      outline: 2px solid var(--brand);
      outline-offset: -2px;
    }
    .refresh:focus-visible {
      outline: 2px solid var(--brand);
      outline-offset: 2px;
    }
  `,
})
export class StatCard {
  /** Required, so the Components tab shows a required input. */
  readonly label = input.required<string>();
  readonly value = input(0);
  readonly hint = input('Click the card to collapse it.');

  /** Two way bound, so the Signals tab shows a model. */
  readonly expanded = model(false);

  readonly refreshed = output<void>();

  protected toggle() {
    this.expanded.update((open) => !open);
  }
}
