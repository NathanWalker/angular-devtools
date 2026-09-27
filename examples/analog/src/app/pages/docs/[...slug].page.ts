import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RouteMeta } from '@analogjs/router';

export const routeMeta: RouteMeta = {
  title: 'Page not found',
};

@Component({
  imports: [RouterLink],
  template: `
    <h1>Page not found</h1>
    <p>This help page does not exist. <a routerLink="/docs">Back to the help center</a>.</p>
  `,
})
export default class DocNotFound {}
