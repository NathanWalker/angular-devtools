import { Component, computed, input, signal } from '@angular/core';
import type { LoadResult, RouteMeta } from '@analogjs/router';
import { ProductCard } from '../../shared/product-card';
import type { load } from './index.server';

export const routeMeta: RouteMeta = {
  title: 'Products',
};

@Component({
  imports: [ProductCard],
  template: `
    <h1>Products</h1>
    <div class="filters">
      <label for="search">Search</label>
      <input
        id="search"
        type="search"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />
      <label for="category">Category</label>
      <select id="category" (change)="category.set($any($event.target).value)">
        <option value="">All</option>
        @for (c of categories; track c) {
          <option [value]="c">{{ c }}</option>
        }
      </select>
    </div>
    <p class="muted">{{ visible().length }} of {{ load().products.length }} products</p>
    <div class="grid">
      @for (product of visible(); track product.id) {
        <app-product-card [product]="product" />
      } @empty {
        <p>No product matches.</p>
      }
    </div>
  `,
})
export default class ProductList {
  readonly load = input.required<LoadResult<typeof load>>();
  protected readonly categories = ['audio', 'desk', 'bags'];
  protected readonly query = signal('');
  protected readonly category = signal('');
  protected readonly visible = computed(() => {
    const q = this.query().toLowerCase();
    const c = this.category();
    return this.load().products.filter(
      (p) => (!c || p.category === c) && (!q || p.name.toLowerCase().includes(q)),
    );
  });
}
