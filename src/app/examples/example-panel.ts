import { Component, contentChild, contentChildren } from '@angular/core';
import { StatCard } from './stat-card';

/** Projects cards, so the Signals tab has content queries to show. */
@Component({
  selector: 'app-example-panel',
  template: `
    <section class="panel">
      <h3>Projected cards</h3>
      <div class="slot">
        <ng-content />
      </div>
      <p class="summary">
        {{ cards().length }} projected card(s); the first is
        <strong>{{ firstCard()?.label() ?? 'none' }}</strong>
      </p>
    </section>
  `,
  styles: `
    .panel {
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius, 12px);
      background: var(--surface);
      box-shadow: var(--shadow-sm);
    }
    h3 {
      margin: 0 0 12px;
      font-size: 16px;
      line-height: 1.3;
    }
    .slot {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
      align-items: start;
    }
    .summary {
      margin: 12px 0 0;
      padding-top: 12px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 14px;
      font-variant-numeric: tabular-nums;
    }
    strong {
      color: var(--ink);
      font-weight: 600;
    }
  `,
})
export class ExamplePanel {
  readonly firstCard = contentChild(StatCard);
  readonly cards = contentChildren(StatCard);
}
