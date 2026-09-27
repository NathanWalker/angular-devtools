import { CurrencyPipe, NgOptimizedImage } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Product } from '../../server/data/catalog';
import { CartStore } from './cart.store';

@Component({
  selector: 'app-product-card',
  imports: [RouterLink, CurrencyPipe, NgOptimizedImage],
  template: `
    <article class="card product">
      <a class="photo" [routerLink]="['/products', product().id]" tabindex="-1" aria-hidden="true">
        <img [ngSrc]="product().image" width="800" height="600" alt="" />
        @if (soldOut()) {
          <span class="sold">Sold out</span>
        }
      </a>
      <span class="tag">{{ product().category }}</span>
      <h3>
        <a [routerLink]="['/products', product().id]">{{ product().name }}</a>
      </h3>
      <p class="muted">{{ product().summary }}</p>
      <div class="buy">
        <span class="price">{{ product().price | currency }}</span>
        <button type="button" [disabled]="!cart.canAdd(product())" (click)="cart.add(product())">
          {{ soldOut() ? 'Sold out' : cart.canAdd(product()) ? 'Add to cart' : 'All in cart' }}
          <span class="sr-only">{{ product().name }}</span>
        </button>
      </div>
    </article>
  `,
})
export class ProductCard {
  readonly product = input.required<Product>();
  protected readonly cart = inject(CartStore);
  protected readonly soldOut = computed(() => this.product().stock === 0);
}
