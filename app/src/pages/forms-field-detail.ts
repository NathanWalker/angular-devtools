import { Component, computed, effect, input, linkedSignal, signal, untracked } from '@angular/core';
import type { DevframeRpcClient } from 'devframe/client';
import {
  FORMS_STYLES,
  actionMessage,
  formAction,
  formsCall,
  plain,
  type CollectedForm,
  type FormFieldNode,
} from './forms-types';

@Component({
  selector: 'app-forms-field-detail',
  template: `
    <div class="head">
      <span class="section-label">Field</span>
      <h3>{{ node().path || '(form)' }}</h3>
      <span class="tag">{{ node().type }}</span>
    </div>
    <pre class="explain" [attr.aria-busy]="text() ? null : 'true'">{{ text() || 'Loading…' }}</pre>
    @if (node().type === 'control' && !node().redacted) {
      <div class="editor">
        <label class="sr-only" for="field-value">New value for {{ node().path }}</label>
        <input
          id="field-value"
          class="field-input"
          type="text"
          placeholder="New value, read as the current value's type"
          autocomplete="off"
          spellcheck="false"
          [value]="draft()"
          (input)="draft.set($any($event.target).value)"
          (keydown.enter)="setValue()"
        />
        <button type="button" class="small primary" (click)="setValue()">Set</button>
      </div>
    }
    <div class="row" role="group" aria-label="Field actions">
      <button type="button" class="small" (click)="act('focus')">Focus</button>
      <button type="button" class="small" (click)="act('mark-touched')">Touch</button>
      <button type="button" class="small" (click)="act('revalidate')">Revalidate</button>
      <button type="button" class="small" (click)="act('store-as-global')">Store as global</button>
    </div>
    <p class="status" role="status">{{ message() }}</p>
  `,
  styles: `
    ${FORMS_STYLES}
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
      padding: 16px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      animation: enter 0.35s var(--ease) both;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      align-items: center;
      min-width: 0;
    }
    .head .section-label {
      flex-basis: 100%;
    }
    h3 {
      min-width: 0;
      margin: 0;
      color: var(--text-strong);
      font-family: var(--font-mono);
      font-size: 14px;
      font-weight: 600;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .editor {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .editor .field-input {
      flex: 1 1 auto;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .status {
      margin-top: -4px;
    }
    .status:empty {
      height: 0;
      margin: -12px 0 0;
    }
  `,
})
export class FormsFieldDetail {
  form = input.required<CollectedForm>();
  node = input.required<FormFieldNode>();
  version = input(0);
  rpc = input<DevframeRpcClient | null>(null);

  readonly text = signal('');
  private readonly target = computed(() => `${this.form().id}|${this.node().path}`);
  readonly draft = linkedSignal({ source: this.target, computation: () => '' });
  readonly message = linkedSignal({ source: this.target, computation: () => '' });

  constructor() {
    effect(() => {
      const form = this.form().id;
      const path = this.node().path;
      this.version();
      const client = this.rpc();
      untracked(() => this.load(client, form, path));
    });
  }

  private async load(client: DevframeRpcClient | null, form: string, path: string) {
    const text = await formsCall<string>(client, 'forms-explain', { kind: 'field', form, path });
    if (this.form().id === form && this.node().path === path) this.text.set(plain(text));
  }

  async act(action: string) {
    const result = await formAction(this.rpc(), {
      action,
      formId: this.form().id,
      path: this.node().path,
    });
    this.message.set(
      result.expression ? `${actionMessage(result)} ${result.expression}` : actionMessage(result),
    );
  }

  async setValue() {
    const result = await formAction(this.rpc(), {
      action: 'set-value',
      formId: this.form().id,
      path: this.node().path,
      value: this.draft(),
      coerce: true,
      mode: 'user',
    });
    this.message.set(actionMessage(result));
  }
}
