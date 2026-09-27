import { Component, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { RouteMeta } from '@analogjs/router';

export const routeMeta: RouteMeta = {
  title: 'Log in',
};

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <h1>Log in</h1>
    <form [formGroup]="form" (ngSubmit)="submit()" class="form">
      <label for="login-email">Email</label>
      <input id="login-email" type="email" formControlName="email" autocomplete="email" />
      <label for="login-password">Password</label>
      <input
        id="login-password"
        type="password"
        formControlName="password"
        autocomplete="current-password"
      />
      <label><input type="checkbox" formControlName="remember" /> Remember me</label>
      <button type="submit">Log in</button>
      @if (message()) {
        <p role="status">{{ message() }}</p>
      }
    </form>
    <p>New here? <a routerLink="/register">Create an account</a></p>
  `,
})
export default class Login {
  protected readonly message = signal('');
  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
    remember: new FormControl(false, { nonNullable: true }),
  });

  submit() {
    this.form.markAllAsTouched();
    this.message.set(this.form.valid ? 'Logged in (demo).' : 'Fix the errors above.');
  }
}
