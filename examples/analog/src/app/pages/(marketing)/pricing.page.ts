import { Component } from '@angular/core';
import type { RouteMeta } from '@analogjs/router';

export const routeMeta: RouteMeta = {
  title: 'Pricing',
  meta: [{ name: 'description', content: 'Free shipping on every plan' }],
};

@Component({
  template: `
    <h1>Pricing</h1>
    <div class="grid">
      <article class="card">
        <h2>Basic</h2>
        <p class="price">Free</p>
        <p class="muted">Standard shipping.</p>
      </article>
      <article class="card">
        <h2>Plus</h2>
        <p class="price">$5 / month</p>
        <p class="muted">Next-day shipping and free returns.</p>
      </article>
    </div>
  `,
})
export default class Pricing {}
