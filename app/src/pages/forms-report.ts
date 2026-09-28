import { Component, effect, input, signal, untracked } from '@angular/core';
import type { DevframeRpcClient } from 'devframe/client';
import { FORMS_STYLES, formsCall, plain, type FormLintFinding } from './forms-types';

@Component({
  selector: 'app-forms-submit',
  template: `
    <section class="block" aria-labelledby="forms-submit-title">
      <h3 id="forms-submit-title" class="section-label">Submit</h3>
      <pre class="explain" [attr.aria-busy]="submit() ? null : 'true'">{{
        submit() || 'Loading…'
      }}</pre>
    </section>
    <section class="block" aria-labelledby="forms-payload-title">
      <h3 id="forms-payload-title" class="section-label">Payload</h3>
      <pre class="explain" [attr.aria-busy]="payload() ? null : 'true'">{{
        payload() || 'Loading…'
      }}</pre>
    </section>
    <div class="fixture">
      <button type="button" class="small" (click)="copyFixture()">Copy test fixture</button>
      <span class="status" role="status">{{ message() }}</span>
    </div>
  `,
  styles: `
    ${FORMS_STYLES}
    :host {
      display: grid;
      gap: 16px;
      min-width: 0;
      animation: enter 0.35s var(--ease) both;
    }
    .block {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .explain {
      max-height: 420px;
      overflow: auto;
    }
    .fixture {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
    }
  `,
})
export class FormsSubmit {
  formId = input.required<string>();
  version = input(0);
  rpc = input<DevframeRpcClient | null>(null);

  readonly submit = signal('');
  readonly payload = signal('');
  readonly message = signal('');

  constructor() {
    effect(() => {
      const form = this.formId();
      this.version();
      const client = this.rpc();
      untracked(async () => {
        const [submit, payload] = await Promise.all([
          formsCall<string>(client, 'forms-explain', { kind: 'submit', form }),
          formsCall<string>(client, 'forms-explain', { kind: 'payload', form }),
        ]);
        if (this.formId() !== form) return;
        this.submit.set(plain(submit));
        this.payload.set(plain(payload));
      });
    });
  }

  async copyFixture() {
    const text = await formsCall<string>(this.rpc(), 'forms-explain', {
      kind: 'fixture',
      form: this.formId(),
    });
    const code = (text ?? '').match(/```ts\n([\s\S]*?)```/)?.[1];
    if (!code) {
      this.message.set('No test fixture is available for this form.');
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      this.message.set('Copied.');
    } catch {
      this.message.set('Clipboard is not available here.');
    }
  }
}

@Component({
  selector: 'app-forms-lint',
  template: `
    @if (findings() === null) {
      <div class="empty-state" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <p>Checking the form for problems…</p>
      </div>
    } @else if (!findings()!.length) {
      <div class="empty-state">
        <span class="ok-icon" aria-hidden="true">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <p class="empty-title">No problems found</p>
        <p>For generic accessibility checks, run axe on the page.</p>
      </div>
    } @else {
      <p class="summary">
        <span class="tabular">{{ findings()!.length }}</span>
        {{ findings()!.length === 1 ? 'finding' : 'findings' }}
      </p>
      <ul class="findings">
        @for (f of findings(); track $index) {
          <li [attr.data-severity]="f.severity">
            <div class="meta">
              <span
                class="tag severity"
                [attr.data-tone]="
                  f.severity === 'info' ? '' : f.severity === 'error' ? 'bad' : 'warn'
                "
                >{{ f.severity }}</span
              >
              <code class="rule">{{ f.rule }}</code>
              @if (f.path) {
                <span class="muted path"
                  >at <code>{{ f.path }}</code></span
                >
              }
            </div>
            <p class="message">{{ f.message }}</p>
            <p class="fix"><span class="fix-label">Fix</span> {{ f.fix }}</p>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    ${FORMS_STYLES}
    :host {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .ok-icon {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      margin-bottom: 4px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--ok) 12%, transparent);
      color: var(--ok);
    }
    .summary {
      margin: 0;
      color: var(--text-2);
      font-size: 12.5px;
    }
    .tabular {
      color: var(--text-strong);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .findings {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--text);
      font-size: 13px;
      animation: enter 0.35s var(--ease) both;
    }
    .findings li {
      display: grid;
      gap: 6px;
      min-width: 0;
      padding: 12px 16px;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      box-shadow: inset 3px 0 0 var(--border-strong);
      transition: border-color 150ms var(--ease);
    }
    .findings li[data-severity='error'] {
      box-shadow: inset 3px 0 0 var(--danger);
    }
    .findings li[data-severity='warning'] {
      box-shadow: inset 3px 0 0 var(--warn);
    }
    .findings li:hover {
      border-color: var(--border-strong);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      align-items: center;
      min-width: 0;
    }
    .severity {
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .rule {
      color: var(--text-strong);
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .path {
      font-size: 12.5px;
      overflow-wrap: anywhere;
    }
    .path code {
      color: #fde68a;
    }
    .message,
    .fix {
      margin: 0;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .fix {
      color: var(--text-2);
      font-size: 12.5px;
    }
    .fix-label {
      margin-right: 4px;
      color: var(--accent);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
  `,
})
export class FormsLint {
  formId = input.required<string>();
  version = input(0);
  rpc = input<DevframeRpcClient | null>(null);

  readonly findings = signal<FormLintFinding[] | null>(null);

  constructor() {
    effect(() => {
      const form = this.formId();
      this.version();
      const client = this.rpc();
      untracked(async () => {
        const found = await formsCall<FormLintFinding[]>(client, 'forms-lint', { form });
        if (this.formId() === form) this.findings.set(found ?? []);
      });
    });
  }
}
