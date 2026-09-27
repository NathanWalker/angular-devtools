import { CurrencyPipe, NgOptimizedImage } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RouteMeta } from '@analogjs/router';
import { CartStore } from '../shared/cart.store';

export const routeMeta: RouteMeta = {
  title: 'Cart',
};

@Component({
  imports: [RouterLink, CurrencyPipe, NgOptimizedImage],
  template: `
    <h1>Cart</h1>
    @if (cart.isEmpty()) {
      <p>Your cart is empty. <a routerLink="/products">Browse products</a></p>
    } @else {
      <table>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">Quantity</th>
            <th scope="col">Price</th>
            <th scope="col"><span class="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          @for (line of cart.items(); track line.product.id) {
            <tr>
              <td>
                <div class="line">
                  <img [ngSrc]="line.product.image" width="64" height="48" alt="" />
                  <a [routerLink]="['/products', line.product.id]">{{ line.product.name }}</a>
                </div>
              </td>
              <td>{{ line.quantity }}</td>
              <td>{{ line.product.price * line.quantity | currency }}</td>
              <td>
                <button type="button" class="link" (click)="cart.remove(line.product.id)">
                  Remove <span class="sr-only">{{ line.product.name }}</span>
                </button>
              </td>
            </tr>
          }
        </tbody>
      </table>
      <p class="price">Total {{ cart.total() | currency }}</p>
      <a class="button" routerLink="/checkout">Checkout</a>
    }
  `,
})
export default class Cart {
  protected readonly cart = inject(CartStore);
}
