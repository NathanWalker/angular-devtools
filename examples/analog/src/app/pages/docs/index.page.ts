import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RouteMeta } from '@analogjs/router';

export const routeMeta: RouteMeta = {
  title: 'Docs',
};

@Component({
  imports: [RouterLink],
  template: `
    <h1>Help center</h1>
    <p class="lead">Everything about ordering, shipping and returns.</p>
    <div class="grid">
      <a class="card link-card" routerLink="/docs/getting-started">
        <strong>Getting started</strong>
        <span class="muted">Create an account and place your first order.</span>
      </a>
      <a class="card link-card" routerLink="/docs/shipping">
        <strong>Shipping</strong>
        <span class="muted">Delivery times, tracking and costs.</span>
      </a>
      <a class="card link-card" routerLink="/docs/returns">
        <strong>Returns</strong>
        <span class="muted">30 days, free labels, fast refunds.</span>
      </a>
    </div>
  `,
})
export default class DocsHome {}
