import { Component, input } from '@angular/core';

/** Shared frame for an example page: a title, a lead and what to look for. */
@Component({
  selector: 'app-example-page',
  template: `
    <section>
      <header>
        <h2>{{ heading() }}</h2>
        <p class="lead"><ng-content select="[lead]" /></p>
      </header>

      <div class="hint" role="note">
        <span class="tab">{{ tab() }}</span>
        <span class="hint-text"><ng-content select="[hint]" /></span>
      </div>

      <ng-content />
    </section>
  `,
  styles: `
    section {
      display: grid;
      gap: 20px;
      min-width: 0;
      padding: 24px 0 64px;
    }
    header {
      display: grid;
      gap: 8px;
    }
    h2 {
      margin: 0;
      color: var(--ink);
      font-size: 22px;
      line-height: 1.25;
      letter-spacing: -0.01em;
    }
    .lead {
      margin: 0;
      max-width: 68ch;
      color: var(--muted);
    }
    .hint {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      border: 1px solid var(--line);
      border-left: 3px solid var(--accent);
      border-radius: var(--radius-sm, 8px);
      background: var(--surface);
      color: var(--muted);
      font-size: 14px;
    }
    .tab {
      flex: none;
      padding: 1px 8px;
      border-radius: 6px;
      background: var(--brand-soft);
      color: var(--brand-strong);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.6;
      white-space: nowrap;
    }
    .hint-text {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    @media (max-width: 480px) {
      .hint {
        flex-direction: column;
        gap: 8px;
        padding: 12px;
      }
    }
  `,
})
export class ExamplePage {
  readonly heading = input.required<string>();
  /** The DevTools tab this page feeds. */
  readonly tab = input.required<string>();
}
