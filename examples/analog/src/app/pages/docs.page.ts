import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { injectContentFiles } from '@analogjs/content';

interface DocAttributes {
  title: string;
  order: string;
}

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="docs">
      <nav class="docs-nav" aria-label="Documentation">
        <p class="eyebrow">Docs</p>
        <a routerLink="/docs" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
          >Overview</a
        >
        @for (doc of docs; track doc.slug) {
          <a [routerLink]="['/docs', doc.slug]" routerLinkActive="active">{{
            doc.attributes.title
          }}</a>
        }
      </nav>
      <div class="prose">
        <router-outlet />
      </div>
    </div>
  `,
})
export default class DocsLayout {
  protected readonly docs = injectContentFiles<DocAttributes>((file) =>
    file.filename.includes('content/docs/'),
  ).sort((a, b) => Number(a.attributes.order) - Number(b.attributes.order));
}
