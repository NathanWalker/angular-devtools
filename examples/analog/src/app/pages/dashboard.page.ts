import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed } from '@angular/core';
import type { RouteMeta } from '@analogjs/router';
import type { OrderSummary } from '../../server/data/catalog';

export const routeMeta: RouteMeta = {
  title: 'Dashboard',
};

@Component({
  imports: [CurrencyPipe, DatePipe],
  template: `
    <h1>Orders</h1>
    <p class="muted">This page renders only in the browser (routeRules ssr: false).</p>
    @if (orders.isLoading()) {
      <p>Loading…</p>
    } @else if (orders.error()) {
      <p class="error">Could not load orders.</p>
    } @else {
      <p>{{ count() }} orders, {{ revenue() | currency }} in total</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Customer</th>
            <th scope="col">Total</th>
            <th scope="col">Date</th>
          </tr>
        </thead>
        <tbody>
          @for (order of orders.value() ?? []; track order.id) {
            <tr>
              <td>{{ order.id }}</td>
              <td>{{ order.name }}</td>
              <td>{{ order.total | currency }}</td>
              <td>{{ order.createdAt | date: 'medium' }}</td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
})
export default class Dashboard {
  protected readonly orders = httpResource<OrderSummary[]>(() => '/api/v1/orders');
  protected readonly count = computed(() => this.orders.value()?.length ?? 0);
  protected readonly revenue = computed(() =>
    (this.orders.value() ?? []).reduce((sum, order) => sum + order.total, 0),
  );
}
