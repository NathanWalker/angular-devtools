// @vitest-environment jsdom
import '@angular/compiler';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { FormField, FormRoot, form, hidden, required } from '@angular/forms/signals';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { findForms } from '../forms.ts';
import {
  isFormAction,
  keepSecrets,
  runFormAction,
  secretInside,
  type ActionContext,
} from '../forms-actions.ts';

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch {
  // already initialized in this worker
}

afterEach(() => TestBed.resetTestingModule());

function contextFor(host: HTMLElement): ActionContext {
  const ng = (globalThis as any).ng;
  const all = () => host.querySelectorAll('*');
  const found = findForms(ng, all());
  const forms = new Map(found.forms.map((f, i) => [`form-${i + 1}`, f]));
  return { ng, forms, elements: found.elements, all };
}

class Signup {
  submits = 0;
  form = new FormGroup({
    name: new FormControl('', Validators.required),
    age: new FormControl<number | null>(null),
    password: new FormControl(''),
    nickname: new FormControl({ value: 'kam', disabled: true }),
  });
}
Component({
  selector: 'signup-form',
  imports: [ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="submits = submits + 1">
      <input id="name" formControlName="name" />
      <input id="age" type="number" formControlName="age" />
      <input id="password" type="password" formControlName="password" />
      <input id="nickname" formControlName="nickname" />
      <button type="submit">Save</button>
    </form>
  `,
})(Signup);

class Notes {
  title = '';
}
Component({
  selector: 'notes-form',
  imports: [FormsModule],
  template: `<form><input id="title" name="title" [(ngModel)]="title" required /></form>`,
})(Notes);

class Profile {
  saved: unknown[] = [];
  model = signal({ name: '', promo: '' });
  form = form(
    this.model,
    (p) => {
      required(p.name);
      hidden(p.promo, () => true);
    },
    { submission: { action: async (f) => void this.saved.push(f().value()) } },
  );
}
Component({
  selector: 'profile-form',
  imports: [FormField, FormRoot],
  template: `<form [formRoot]="form"><input id="pname" [formField]="form.name" /><button>Go</button></form>`,
})(Profile);

async function render<T>(type: new () => T) {
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('form actions on reactive forms', () => {
  it('types through the input, refuses secrets and disabled fields', async () => {
    const fixture = await render(Signup);
    const ctx = contextFor(fixture.nativeElement);
    const form = fixture.componentInstance.form;

    let result = await runFormAction(ctx, {
      action: 'set-value',
      formId: 'form-1',
      path: 'age',
      value: 42,
      mode: 'user',
    });
    expect(result.ok).toBe(true);
    expect(form.controls.age.value).toBe(42);
    expect(form.controls.age.dirty).toBe(true);

    result = await runFormAction(ctx, {
      action: 'set-value',
      formId: 'form-1',
      path: 'password',
      value: 'x',
    });
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toContain('looks secret');
    expect(form.controls.password.value).toBe('');

    result = await runFormAction(ctx, {
      action: 'set-value',
      formId: 'form-1',
      path: 'nickname',
      value: 'ada',
    });
    expect(result.error).toContain('disabled (pass force');
    result = await runFormAction(ctx, {
      action: 'set-value',
      formId: 'form-1',
      path: 'nickname',
      value: 'ada',
      force: true,
    });
    expect(form.controls.nickname.value).toBe('ada');
  });

  it('needs confirm for submit and reset, then submits through the <form>', async () => {
    const fixture = await render(Signup);
    const ctx = contextFor(fixture.nativeElement);
    const refused = await runFormAction(ctx, { action: 'submit', formId: 'form-1' });
    expect(refused.error).toContain('confirm: true');
    expect(fixture.componentInstance.submits).toBe(0);
    const result = await runFormAction(ctx, { action: 'submit', formId: 'form-1', confirm: true });
    expect(result).toMatchObject({ ok: true, status: 'INVALID', invalid: ['name'] });
    expect(fixture.componentInstance.submits).toBe(1);
  });

  it('marks, focuses the first invalid field and stores the form as a global', async () => {
    const fixture = await render(Signup);
    document.body.appendChild(fixture.nativeElement);
    const ctx = contextFor(fixture.nativeElement);
    await runFormAction(ctx, { action: 'touch-all', formId: 'form-1' });
    expect(fixture.componentInstance.form.controls.name.touched).toBe(true);
    const focus = await runFormAction(ctx, { action: 'focus-first-invalid', formId: 'form-1' });
    expect(focus.path).toBe('name');
    expect(document.activeElement?.id).toBe('name');
    const stored = await runFormAction(ctx, {
      action: 'store-as-global',
      formId: 'form-1',
      path: 'name',
    });
    expect(stored.expression).toBe("$form.get('name')");
    expect((window as any).$control).toBe(fixture.componentInstance.form.controls.name);
    fixture.nativeElement.remove();
  });

  it('snapshots and restores values, and locates a field by selector', async () => {
    const fixture = await render(Signup);
    const ctx = contextFor(fixture.nativeElement);
    const form = fixture.componentInstance.form;
    form.controls.name.setValue('Ada');
    const snap = await runFormAction(ctx, { action: 'snapshot', formId: 'form-1' });
    form.controls.name.setValue('Bob');
    expect(
      (await runFormAction(ctx, { action: 'restore', formId: 'form-1', snapshot: snap.snapshot }))
        .ok,
    ).toBe(false);
    await runFormAction(ctx, {
      action: 'restore',
      formId: 'form-1',
      snapshot: snap.snapshot,
      confirm: true,
    });
    expect(form.controls.name.value).toBe('Ada');

    document.body.appendChild(fixture.nativeElement);
    expect(await runFormAction(ctx, { action: 'locate', selector: '#age' })).toMatchObject({
      ok: true,
      formId: 'form-1',
      path: 'age',
    });
    expect((await runFormAction(ctx, { action: 'locate', selector: '[[' })).error).toContain(
      'not a valid CSS selector',
    );
    fixture.nativeElement.remove();
  });

  it('fills several fields and lists the skipped ones', async () => {
    const fixture = await render(Signup);
    const ctx = contextFor(fixture.nativeElement);
    const result = await runFormAction(ctx, {
      action: 'fill',
      formId: 'form-1',
      values: { name: 'Ada', password: 'secret', missing: 1 },
    });
    expect(result.skipped?.map((s) => s.path)).toEqual(['password', 'missing']);
    expect(result).toMatchObject({ ok: true, status: 'VALID' });
    expect(fixture.componentInstance.form.controls.name.value).toBe('Ada');
  });
});

describe('form actions on template-driven and Signal Forms', () => {
  it('writes ngModel through the input so the component property updates', async () => {
    const fixture = await render(Notes);
    const ctx = contextFor(fixture.nativeElement);
    const result = await runFormAction(ctx, {
      action: 'set-value',
      formId: 'form-1',
      path: 'title',
      value: 'Hello',
    });
    expect(result.ok).toBe(true);
    expect(fixture.componentInstance.title).toBe('Hello');
    expect(
      (await runFormAction(ctx, { action: 'disable', formId: 'form-1', path: 'title' })).error,
    ).toContain('ngModel');
  });

  it('writes Signal Forms fields, refuses hidden ones and submits through the form root', async () => {
    const fixture = await render(Profile);
    const ctx = contextFor(fixture.nativeElement);
    const component = fixture.componentInstance;
    expect(
      (
        await runFormAction(ctx, {
          action: 'set-value',
          formId: 'form-1',
          path: 'promo',
          value: '1',
        })
      ).error,
    ).toContain('is hidden');
    expect((await runFormAction(ctx, { action: 'disable', formId: 'form-1' })).error).toContain(
      'disabled() rules',
    );
    await runFormAction(ctx, { action: 'set-value', formId: 'form-1', path: 'name', value: 'Ada' });
    expect(component.model().name).toBe('Ada');
    const submitted = await runFormAction(ctx, {
      action: 'submit',
      formId: 'form-1',
      confirm: true,
    });
    expect(submitted.message).toContain('the action runs');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(component.saved).toEqual([{ name: 'Ada', promo: '' }]);
  });
});

describe('secret safety for group writes', () => {
  it('refuses a group write that would touch a secret field', async () => {
    const fixture = await render(Signup);
    const ctx = contextFor(fixture.nativeElement);
    const account = new FormGroup({
      account: new FormGroup({ name: new FormControl('a'), apiKey: new FormControl('k') }),
    });
    ctx.forms.set('form-3', { kind: 'reactive', root: account as never, owner: null });
    const result = await runFormAction(ctx, {
      action: 'set-value',
      formId: 'form-3',
      path: 'account',
      value: { name: 'b', apiKey: 'stolen' },
    });
    expect(result.error).toContain('secret field "apiKey"');
    expect(account.controls.account.controls.apiKey.value).toBe('k');
    const allowed = await runFormAction(ctx, {
      action: 'set-value',
      formId: 'form-3',
      path: 'account.name',
      value: 'b',
    });
    expect(allowed.ok).toBe(true);
  });

  it('finds secrets inside values and keeps them on restore', () => {
    expect(secretInside({ account: { apiKey: 'x' } })).toBe('account.apiKey');
    expect(secretInside({ items: [{ name: 'a' }] })).toBeNull();
    expect(keepSecrets({ name: 'old', password: 'old' }, { name: 'new', password: 'now' })).toEqual(
      {
        name: 'old',
        password: 'now',
      },
    );
  });

  it('refuses to restore a snapshot into another form', async () => {
    const fixture = await render(Signup);
    const ctx = contextFor(fixture.nativeElement);
    const other = {
      ...ctx.forms.get('form-1')!,
      root: new FormGroup({ name: new FormControl('') }),
    };
    ctx.forms.set('form-2', other as never);
    const snap = await runFormAction(ctx, { action: 'snapshot', formId: 'form-1' });
    const result = await runFormAction(ctx, {
      action: 'restore',
      formId: 'form-2',
      snapshot: snap.snapshot,
      confirm: true,
    });
    expect(result.error).toContain('another form');
  });
});

class Security {
  form = new FormGroup({
    question: new FormControl('first pet'),
    answer: new FormControl('rex'),
  });
}
Component({
  selector: 'security-form',
  imports: [ReactiveFormsModule],
  template: `
    <form [formGroup]="form">
      <input id="question" formControlName="question" />
      <input id="answer" type="password" formControlName="answer" />
    </form>
  `,
})(Security);

describe('protected descendants', () => {
  it('finds a secret nested deeper than any fixed limit', async () => {
    const fixture = await render(Signup);
    const ctx = contextFor(fixture.nativeElement);
    let inner: FormGroup = new FormGroup({ apiKey: new FormControl('k') });
    const value: Record<string, unknown> = { apiKey: 'stolen' };
    let wrapped: Record<string, unknown> = value;
    for (let i = 0; i < 15; i++) {
      inner = new FormGroup({ level: inner });
      wrapped = { level: wrapped };
    }
    ctx.forms.set('deep', { kind: 'reactive', root: inner as never, owner: null });
    const result = await runFormAction(ctx, {
      action: 'set-value',
      formId: 'deep',
      path: '',
      value: wrapped,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(inner.getRawValue())).toContain('"apiKey":"k"');
  });

  it('keeps a password-input field on restore even when its name looks harmless', async () => {
    const fixture = await render(Security);
    document.body.appendChild(fixture.nativeElement);
    const ctx = contextFor(fixture.nativeElement);
    const form = fixture.componentInstance.form;
    const snap = await runFormAction(ctx, { action: 'snapshot', formId: 'form-1' });
    form.controls.answer.setValue('fido');
    form.controls.question.setValue('first car');
    await runFormAction(ctx, {
      action: 'restore',
      formId: 'form-1',
      snapshot: snap.snapshot,
      confirm: true,
    });
    expect(form.controls.question.value).toBe('first pet');
    expect(form.controls.answer.value).toBe('fido');
    fixture.nativeElement.remove();
  });

  it('refuses a group write that changes a hidden Signal Forms child, and restore keeps it', async () => {
    const fixture = await render(Profile);
    const ctx = contextFor(fixture.nativeElement);
    const component = fixture.componentInstance;
    const refused = await runFormAction(ctx, {
      action: 'set-value',
      formId: 'form-1',
      path: '',
      value: { name: 'Ada', promo: 'FREE' },
    });
    expect(refused.error).toContain('would change promo, which is hidden');
    const allowed = await runFormAction(ctx, {
      action: 'set-value',
      formId: 'form-1',
      path: '',
      value: { name: 'Ada', promo: '' },
    });
    expect(allowed.ok).toBe(true);
    const snap = await runFormAction(ctx, { action: 'snapshot', formId: 'form-1' });
    component.model.set({ name: 'Bob', promo: 'LATER' });
    await runFormAction(ctx, {
      action: 'restore',
      formId: 'form-1',
      snapshot: snap.snapshot,
      confirm: true,
    });
    expect(component.model()).toEqual({ name: 'Ada', promo: 'LATER' });
  });
});

describe('request validation', () => {
  it('accepts known actions and rejects the rest', () => {
    expect(isFormAction({ action: 'focus', formId: 'form-1' })).toBe(true);
    expect(isFormAction({ action: 'eval', formId: 'form-1' })).toBe(false);
    expect(
      isFormAction({
        action: 'fill',
        values: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, i])),
      }),
    ).toBe(false);
    expect(isFormAction({ action: 'focus', path: 'x'.repeat(600) })).toBe(false);
  });
});
