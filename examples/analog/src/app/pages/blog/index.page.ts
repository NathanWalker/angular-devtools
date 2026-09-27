import { NgOptimizedImage } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectContentFiles } from '@analogjs/content';
import type { RouteMeta } from '@analogjs/router';

interface PostAttributes {
  title: string;
  date: string;
  summary: string;
  cover: string;
  author: string;
}

export const routeMeta: RouteMeta = {
  title: 'Blog',
};

@Component({
  imports: [RouterLink, NgOptimizedImage],
  template: `
    <h1>Blog</h1>
    <p class="lead">Notes from the team behind Analog Shop.</p>
    <div class="posts">
      @for (post of posts; track post.slug) {
        <article class="post-card">
          <a [routerLink]="['/blog', post.slug]" class="cover" tabindex="-1" aria-hidden="true">
            <img [ngSrc]="post.attributes.cover" width="1200" height="630" alt="" />
          </a>
          <div class="post-body">
            <p class="meta">{{ post.attributes.date }} · {{ post.attributes.author }}</p>
            <h2>
              <a [routerLink]="['/blog', post.slug]">{{ post.attributes.title }}</a>
            </h2>
            <p>{{ post.attributes.summary }}</p>
          </div>
        </article>
      }
    </div>
  `,
})
export default class Blog {
  protected readonly posts = injectContentFiles<PostAttributes>((file) =>
    file.filename.includes('content/blog/'),
  ).sort((a, b) => b.attributes.date.localeCompare(a.attributes.date));
}
