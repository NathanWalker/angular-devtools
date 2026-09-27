import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterOutlet, RouterLink],
  template: `
    <nav class="crumbs" aria-label="Breadcrumb"><a routerLink="/blog">Blog</a></nav>
    <div class="prose">
      <router-outlet />
    </div>
  `,
})
export default class BlogLayout {}
