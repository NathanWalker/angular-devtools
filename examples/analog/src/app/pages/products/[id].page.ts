import { CurrencyPipe, NgOptimizedImage } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { LoadResult } from '@analogjs/router';
import { CartStore } from '../../shared/cart.store';
import type { load } from './[id].server';

@Component({
  imports: [RouterLink, CurrencyPipe, NgOptimizedImage],
  template: `
    <a class="back" routerLink="/products">← All products</a>
    @if (load().product; as product) {
      <article class="detail">
        <img
          class="detail-photo"
          [ngSrc]="product.image"
          width="800"
          height="600"
          [alt]="product.name"
          priority
        />
        <div class="detail-info">
          <span class="tag">{{ product.category }}</span>
          <h1>{{ product.name }}</h1>
          <p class="lead">{{ product.summary }}</p>
          <p class="price big">{{ product.price | currency }}</p>
          <p class="muted">
            {{ product.stock ? product.stock + ' in stock, ships in two days' : 'Sold out' }}
          </p>
          <div class="hero-actions">
            <button type="button" [disabled]="!cart.canAdd(product)" (click)="cart.add(product)">
              {{
                !product.stock
                  ? 'Sold out'
                  : cart.canAdd(product)
                    ? 'Add to cart'
                    : 'All in stock is in your cart'
              }}
            </button>
            @if (cart.count()) {
              <a class="button secondary" routerLink="/cart">View cart ({{ cart.count() }})</a>
            }
          </div>
        </div>
      </article>
    } @else {
      <h1>Product not found</h1>
    }
  `,
})
export default class ProductPage {
  readonly load = input.required<LoadResult<typeof load>>();
  protected readonly cart = inject(CartStore);
}
