import { Component, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Account } from '../travel/auth';

@Component({
  selector: 'app-sign-in',
  imports: [ReactiveFormsModule],
  template: `
    <div class="container page">
      <form class="panel" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <header class="head">
          <p class="eyebrow">Welcome back</p>
          <h1>Sign in</h1>
          <p class="muted">Use any name and email. This demo keeps nothing.</p>
        </header>

        <div class="field">
          <label for="signin-name">Name</label>
          <input
            id="signin-name"
            formControlName="name"
            autocomplete="name"
            [attr.aria-invalid]="invalid('name')"
            aria-describedby="signin-name-error"
          />
          <p id="signin-name-error" class="error">
            @if (invalid('name')) {
              Enter your name
            }
          </p>
        </div>

        <div class="field">
          <label for="signin-email">Email</label>
          <input
            id="signin-email"
            type="email"
            formControlName="email"
            autocomplete="email"
            spellcheck="false"
            [attr.aria-invalid]="invalid('email')"
            aria-describedby="signin-email-error"
          />
          <p id="signin-email-error" class="error">
            @if (invalid('email')) {
              Enter a valid email address
            }
          </p>
        </div>

        <p class="status" role="status">{{ status() }}</p>
        <button type="submit" class="btn btn-primary wide">Sign In</button>
      </form>
    </div>
  `,
  styles: `
    .page {
      padding-top: 56px;
      padding-bottom: 72px;
    }
    .panel {
      display: grid;
      gap: 4px;
      max-width: 420px;
      margin: 0 auto;
      padding: 32px 28px 28px;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg, 16px);
      background: var(--surface);
      box-shadow: var(--shadow-sm);
    }
    .head {
      margin-bottom: 16px;
    }
    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }
    .muted {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 14px;
    }
    .field {
      display: grid;
      gap: 6px;
    }
    label {
      font-size: 14px;
      font-weight: 600;
    }
    input {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      height: var(--control-h, 40px);
      padding: 0 12px;
      border: 1px solid var(--line-strong);
      border-radius: 10px;
      background: var(--surface);
      color: var(--ink);
      transition:
        border-color 0.15s var(--ease, ease),
        box-shadow 0.15s var(--ease, ease);
    }
    input:hover {
      border-color: var(--muted);
    }
    input:focus-visible {
      border-color: var(--brand);
      outline: none;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 28%, transparent);
    }
    input[aria-invalid='true'] {
      border-color: var(--danger-ink);
    }
    input[aria-invalid='true']:focus-visible {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger-ink) 24%, transparent);
    }
    .error {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      min-height: 24px;
      margin: 0;
      padding-top: 2px;
      color: var(--danger-ink);
      font-size: 13px;
      line-height: 1.4;
    }
    .error:not(:empty)::before,
    .status::before {
      content: '';
      flex: none;
      width: 14px;
      height: 14px;
      margin-top: 2px;
      background: currentColor;
      mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round'%3E%3Ccircle cx='12' cy='12' r='9.5'/%3E%3Cpath d='M12 7.5v5.5M12 16.5v.01'/%3E%3C/svg%3E")
        center / contain no-repeat;
    }
    .status {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0 0 12px;
      padding: 10px 12px;
      border: 1px solid color-mix(in srgb, var(--danger-ink) 35%, transparent);
      border-radius: 10px;
      background: var(--danger-soft);
      color: var(--danger-ink);
      font-size: 14px;
      font-weight: 500;
    }
    .status:empty {
      margin: 0;
      padding: 0;
      border: 0;
    }
    .status:empty::before {
      display: none;
    }
    .wide {
      width: 100%;
      margin-top: 4px;
    }
    @media (max-width: 480px) {
      .page {
        padding-top: 32px;
      }
      .panel {
        padding: 24px 16px 20px;
      }
    }
  `,
})
export class SignIn {
  readonly returnUrl = input<string>();
  private readonly account = inject(Account);
  private readonly router = inject(Router);
  protected readonly status = signal('');

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
  });

  protected invalid(name: 'name' | 'email') {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || control.dirty);
  }

  protected submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.status.set('Check the highlighted fields.');
      return;
    }
    const { name, email } = this.form.getRawValue();
    this.account.signIn(name, email);
    const target = this.returnUrl();
    void this.router.navigateByUrl(target?.startsWith('/') ? target : '/trips');
  }
}
