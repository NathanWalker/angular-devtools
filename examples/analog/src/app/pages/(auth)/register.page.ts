import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { RouteMeta } from '@analogjs/router';

export const routeMeta: RouteMeta = {
  title: 'Create account',
};

@Component({
  imports: [FormsModule],
  template: `
    <h1>Create account</h1>
    <form #f="ngForm" (ngSubmit)="done.set(!!f.valid)" class="form">
      <label for="reg-name">Name</label>
      <input id="reg-name" name="name" [(ngModel)]="name" required minlength="2" />
      <label for="reg-email">Email</label>
      <input id="reg-email" name="email" type="email" [(ngModel)]="email" required email />
      <label
        ><input type="checkbox" name="terms" [(ngModel)]="terms" required /> I accept the
        terms</label
      >
      <button type="submit">Create account</button>
      @if (done()) {
        <p role="status">Account created (demo).</p>
      }
    </form>
  `,
})
export default class Register {
  protected name = '';
  protected email = '';
  protected terms = false;
  protected readonly done = signal(false);
}
