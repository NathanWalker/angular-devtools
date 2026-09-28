import { httpResource } from '@angular/common/http';
import { Component, computed, signal } from '@angular/core';
import { ExamplePage } from './example-page';

interface Product {
  id: number;
  name: string;
  price: number;
  stock: number;
}

type Scenario = 'ok' | 'slow' | 'fail';

const SCENARIOS: { value: Scenario; label: string; query: string }[] = [
  { value: 'ok', label: 'Normal', query: '' },
  { value: 'slow', label: 'Slow backend (1.5 s)', query: '?delay=1500' },
  { value: 'fail', label: 'Backend error (503)', query: '?fail=503' },
];

@Component({
  selector: 'app-http-example',
  imports: [ExamplePage],
  template: `
    <app-example-page heading="SSR &amp; HTTP" tab="SSR & HTTP">
      <ng-container lead>
        The product list is fetched with <code>httpResource</code> while the server renders, then
        replayed from the transfer cache during hydration. The SSR &amp; HTTP tab shows the payload,
        both sides of the call and the hydration counters.
      </ng-container>
      <ng-container hint>
        Add a fault rule for <code>/api/products</code> in the tab, then press Reload or refresh the
        page to see it on the client or during SSR.
      </ng-container>

      <div class="controls">
        <label>
          Backend scenario
          <select [value]="scenario()" (change)="setScenario($event)">
            @for (option of scenarios; track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
        </label>
        <button type="button" class="reload" (click)="products.reload()">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" />
          </svg>
          Reload
        </button>
      </div>

      <section class="block" aria-labelledby="products-heading">
        <div class="block-head">
          <h3 id="products-heading">Products</h3>
          <p class="status" role="status">{{ status() }}</p>
        </div>
        @if (products.error(); as error) {
          <div class="error" role="alert">
            <p class="error-title">{{ errorText(error) }}</p>
            <p class="error-help">
              Switch the scenario back to Normal or clear the fault rule in the SSR &amp; HTTP tab,
              then press Reload.
            </p>
          </div>
        }
        @if (products.hasValue()) {
          @if (products.value().length) {
            <ul
              class="grid"
              [class.stale]="products.isLoading()"
              [attr.aria-busy]="products.isLoading()"
            >
              @for (product of products.value(); track product.id) {
                <li class="card">
                  <button
                    type="button"
                    [attr.aria-pressed]="selectedId() === product.id"
                    (click)="selectedId.set(product.id)"
                  >
                    <span class="name">{{ product.name }}</span>
                    <span class="meta">\${{ product.price }} · {{ product.stock }} in stock</span>
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="empty">The backend returned no products. Press Reload to try again.</p>
          }
        } @else if (products.isLoading()) {
          <ul class="grid" aria-hidden="true">
            @for (slot of skeleton; track slot) {
              <li class="card skeleton"><span></span><span></span></li>
            }
          </ul>
        }
      </section>

      @if (selectedId() !== null) {
        <section aria-labelledby="detail-heading" class="block detail">
          <h3 id="detail-heading">Detail (client-only request)</h3>
          @if (detail.hasValue()) {
            <p class="detail-body">
              <span class="name">{{ detail.value().name }}</span
              >: <span class="num">{{ detail.value().stock }}</span> left
            </p>
          } @else if (detail.error(); as error) {
            <div class="error" role="alert">
              <p class="error-title">{{ errorText(error) }}</p>
            </div>
          } @else {
            <p class="status">Loading…</p>
          }
        </section>
      }
    </app-example-page>
  `,
  styles: `
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 12px;
    }
    label {
      display: grid;
      gap: 6px;
      min-width: 0;
      color: var(--ink);
      font-size: 14px;
      font-weight: 500;
    }
    select,
    .reload {
      box-sizing: border-box;
      height: 36px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm, 8px);
      background-color: var(--surface);
      color: var(--ink);
      font: inherit;
      font-size: 14px;
      cursor: pointer;
      transition:
        border-color 0.15s var(--ease, ease),
        background-color 0.15s var(--ease, ease),
        box-shadow 0.15s var(--ease, ease);
    }
    select {
      min-width: 220px;
      max-width: 100%;
      padding: 0 36px 0 10px;
      font-weight: 400;
    }
    select:hover {
      border-color: var(--muted);
    }
    select:focus-visible {
      border-color: var(--brand);
      outline: none;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 28%, transparent);
    }
    .reload {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 14px;
      font-weight: 500;
    }
    .reload svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .reload:hover {
      border-color: var(--ink);
      background-color: var(--subtle);
    }
    .block {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .block-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 4px 12px;
    }
    h3 {
      margin: 0;
      font-size: 16px;
      line-height: 1.3;
    }
    .status {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      font-variant-numeric: tabular-nums;
    }
    .error {
      display: grid;
      gap: 4px;
      padding: 12px 14px 12px 38px;
      border: 1px solid color-mix(in srgb, var(--danger-ink) 35%, transparent);
      border-radius: var(--radius-sm, 8px);
      background: var(--danger-soft)
        url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23dc2626' stroke-width='2.4' stroke-linecap='round'%3E%3Ccircle cx='12' cy='12' r='9.5'/%3E%3Cpath d='M12 7.5v5.5M12 16.5v.01'/%3E%3C/svg%3E")
        no-repeat 14px 15px / 16px;
      color: var(--danger-ink);
      font-size: 14px;
    }
    .error p {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .error-title {
      font-weight: 600;
    }
    .grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr));
      margin: 0;
      padding: 0;
      list-style: none;
      transition: opacity 0.15s var(--ease, ease);
    }
    .grid.stale {
      opacity: 0.6;
    }
    .card {
      display: grid;
    }
    .card button {
      display: grid;
      align-content: start;
      gap: 4px;
      width: 100%;
      min-width: 0;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius, 12px);
      background: var(--surface);
      color: var(--ink);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition:
        border-color 0.15s var(--ease, ease),
        background-color 0.15s var(--ease, ease),
        box-shadow 0.15s var(--ease, ease);
    }
    .card button:hover {
      border-color: var(--line-strong);
      box-shadow: var(--shadow-sm);
    }
    .card button[aria-pressed='true'] {
      border-color: var(--brand);
      background: var(--brand-soft);
      box-shadow: inset 0 0 0 1px var(--brand);
    }
    .name {
      overflow-wrap: anywhere;
      font-weight: 600;
    }
    .meta {
      color: var(--muted);
      font-size: 14px;
      font-variant-numeric: tabular-nums;
    }
    .card button[aria-pressed='true'] .meta {
      color: var(--ink);
    }
    .skeleton {
      gap: 8px;
      height: 70px;
      box-sizing: border-box;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius, 12px);
      background: var(--surface);
    }
    .skeleton span {
      height: 12px;
      border-radius: 4px;
      background: var(--subtle);
      animation: pulse 1.2s ease-in-out infinite;
    }
    .skeleton span:last-child {
      width: 60%;
    }
    .empty {
      margin: 0;
      padding: 24px 16px;
      border: 1px dashed var(--line-strong);
      border-radius: var(--radius, 12px);
      color: var(--muted);
      text-align: center;
    }
    .detail {
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius, 12px);
      background: var(--surface);
    }
    .detail-body {
      margin: 0;
    }
    .num {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    :focus-visible {
      outline: 2px solid var(--brand);
      outline-offset: 2px;
    }
    @keyframes pulse {
      50% {
        opacity: 0.45;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .skeleton span {
        animation: none;
      }
    }
    @media (max-width: 480px) {
      .controls label {
        flex: 1 1 100%;
      }
      select {
        width: 100%;
        min-width: 0;
      }
    }
  `,
})
export class HttpExample {
  protected readonly scenarios = SCENARIOS;
  protected readonly scenario = signal<Scenario>('ok');
  protected readonly selectedId = signal<number | null>(null);
  protected readonly skeleton = [0, 1, 2, 3];

  protected readonly products = httpResource<Product[]>(
    () => `/api/products${SCENARIOS.find((s) => s.value === this.scenario())?.query ?? ''}`,
  );

  protected readonly detail = httpResource<Product>(() => {
    const id = this.selectedId();
    return id === null ? undefined : `/api/products/${id}`;
  });

  protected readonly status = computed(() => {
    if (this.products.isLoading()) return 'Loading products…';
    if (this.products.hasValue()) return `${this.products.value().length} product(s) loaded.`;
    return this.products.error() ? 'The request failed.' : '';
  });

  protected setScenario(event: Event) {
    this.scenario.set((event.target as HTMLSelectElement).value as Scenario);
  }

  protected errorText(error: unknown): string {
    const cause = (error as { cause?: unknown })?.cause ?? error;
    const status = (cause as { status?: number })?.status;
    const message = (cause as { message?: string })?.message ?? String(cause);
    return status ? `HTTP ${status}: ${message}` : message;
  }
}
