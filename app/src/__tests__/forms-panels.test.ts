import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { DevframeRpcClient } from 'devframe/client';
import { afterEach, describe, expect, it } from 'vitest';
import { FormsFieldDetail } from '../pages/forms-field-detail';
import { FormsInspector } from '../pages/forms-inspector';
import { FormsLint, FormsSubmit } from '../pages/forms-report';
import type { CollectedForm, FormFieldNode } from '../pages/forms-types';

type Call = (name: string, arg: Record<string, unknown>) => Promise<unknown>;

function fakeClient(call: Call, forms: CollectedForm[] = []): DevframeRpcClient {
  const rpc = {
    call,
    callEvent: () => Promise.resolve(),
    sharedState: () => Promise.resolve({ value: () => ({ forms }), on: () => () => {} }),
  };
  return { connectionMeta: {}, scope: () => ({ rpc }) } as unknown as DevframeRpcClient;
}

const fail: Call = () => Promise.reject(new Error('offline'));

function field(path: string, extra: Partial<FormFieldNode> = {}): FormFieldNode {
  return {
    key: path.split('.').pop() ?? '',
    path,
    type: 'control',
    status: 'VALID',
    touched: false,
    dirty: false,
    bound: true,
    value: 'x',
    errors: [],
    ...extra,
  };
}

const form: CollectedForm = {
  id: 'signup@p1',
  kind: 'reactive',
  owner: 'Signup',
  label: 'Signup.form',
  root: { ...field(''), type: 'group', children: [field('email'), field('name')] },
};

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  }
}

function text(fixture: ComponentFixture<unknown>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function button(fixture: ComponentFixture<unknown>, name: string): HTMLButtonElement {
  const found = Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
  ).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === name);
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('FormsLint', () => {
  it('shows a failure with Try again instead of "No problems found" when the check fails', async () => {
    let answer: Call = fail;
    const fixture = TestBed.createComponent(FormsLint);
    fixture.componentRef.setInput('formId', form.id);
    fixture.componentRef.setInput(
      'rpc',
      fakeClient((name, arg) => answer(name, arg)),
    );
    await settle(fixture);
    expect(text(fixture)).toContain('Could not check this form');
    expect(text(fixture)).not.toContain('No problems found');

    answer = () => Promise.resolve([]);
    button(fixture, 'Try again').click();
    await settle(fixture);
    expect(text(fixture)).toContain('No problems found');
  });
});

describe('FormsSubmit', () => {
  it('shows a failure instead of loading forever when the explain call fails', async () => {
    const fixture = TestBed.createComponent(FormsSubmit);
    fixture.componentRef.setInput('formId', form.id);
    fixture.componentRef.setInput('rpc', fakeClient(fail));
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    expect(text(fixture)).toContain('Could not explain this form');
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(text(fixture)).not.toContain('Loading');
  });

  it('shows the submit and payload text once both answer', async () => {
    const fixture = TestBed.createComponent(FormsSubmit);
    fixture.componentRef.setInput('formId', form.id);
    fixture.componentRef.setInput(
      'rpc',
      fakeClient((_, arg) => Promise.resolve(`${arg['kind']} text`)),
    );
    await settle(fixture);
    expect(text(fixture)).toContain('submit text');
    expect(text(fixture)).toContain('payload text');
  });
});

describe('FormsFieldDetail', () => {
  function detail(call: Call) {
    const fixture = TestBed.createComponent(FormsFieldDetail);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('node', form.root.children![0]);
    fixture.componentRef.setInput('rpc', fakeClient(call));
    document.body.append(fixture.nativeElement);
    return fixture;
  }

  it('shows a failure with Try again when the field explain call fails', async () => {
    const fixture = detail(fail);
    await settle(fixture);
    expect(text(fixture)).toContain('Could not explain this field');
    expect((fixture.nativeElement as HTMLElement).querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("drops the previous field's text while the next field loads", async () => {
    const pending: ((value: string) => void)[] = [];
    const fixture = detail((_, arg) =>
      arg['path'] === 'email'
        ? Promise.resolve('about email')
        : new Promise((resolve) => pending.push(resolve)),
    );
    await settle(fixture);
    expect(text(fixture)).toContain('about email');

    fixture.componentRef.setInput('node', form.root.children![1]);
    await settle(fixture);
    expect(text(fixture)).not.toContain('about email');
    expect(text(fixture)).toContain('Loading…');
    pending[0]('about name');
    await settle(fixture);
    expect(text(fixture)).toContain('about name');
  });

  it('moves focus to its heading when it opens and emits closed from Close', async () => {
    const fixture = detail(() => Promise.resolve('about email'));
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    await settle(fixture);
    expect(document.activeElement?.id).toBe('forms-field-heading');
    button(fixture, 'Close details for email').click();
    expect(closed).toBe(1);
  });
});

describe('FormsInspector fields', () => {
  it('names the row button for what it does, toggles it, and closes the detail', async () => {
    const fixture = TestBed.createComponent(FormsInspector);
    fixture.componentRef.setInput(
      'rpc',
      fakeClient(() => Promise.resolve('about email'), [form]),
    );
    document.body.append(fixture.nativeElement);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const row = button(fixture, 'Show details for email');
    expect(row.getAttribute('aria-pressed')).toBe('false');

    row.click();
    await settle(fixture);
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('app-forms-field-detail')).not.toBeNull();
    expect(document.activeElement?.id).toBe('forms-field-heading');

    row.click();
    await settle(fixture);
    expect(row.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('app-forms-field-detail')).toBeNull();

    row.click();
    await settle(fixture);
    button(fixture, 'Close details for email').click();
    await settle(fixture);
    expect(host.querySelector('app-forms-field-detail')).toBeNull();
    expect(document.activeElement).toBe(row);
  });
});
