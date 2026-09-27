import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import type { DevframeRpcClient } from 'devframe/client';

interface AnalogRoute {
  id: string;
  fullPath: string;
  file?: string;
  kind: 'page' | 'layout' | 'markdown' | 'group' | 'implicit';
  params: string[];
  catchAll?: 'required' | 'optional';
  serverFile?: string;
  serverExports?: string[];
  routeMeta?: string[];
  title?: string;
  children: AnalogRoute[];
}

interface ApiRoute {
  path: string;
  method: string;
  file: string;
}

interface ContentFile {
  file: string;
  slug: string;
  attributes: Record<string, string>;
  error?: string;
}

interface AnalogProject {
  analog: boolean;
  version?: string;
  routes: AnalogRoute[];
  api: ApiRoute[];
  middleware: string[];
  content: ContentFile[];
}

interface AnalogCall {
  id: number;
  at: number;
  kind: 'page' | 'load' | 'fn' | 'api';
  method: string;
  url: string;
  status: number;
  ms: number;
  bytes?: number;
  from: string;
  render?: 'ssr' | 'client';
  preview?: string;
}

interface AnalogPage {
  pageId: string;
  url: string;
  chain: { path: string; file?: string; serverFile?: string }[];
  load?: { preview: string; bytes: number; keys: string[] };
  serverContext?: string;
  hydrated: number;
  hydrationErrors: string[];
}

interface AnalogState {
  pages?: AnalogPage[];
  calls?: AnalogCall[];
}

interface Finding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  file?: string;
  path?: string;
  message: string;
  fix: string;
}

interface UrlMatch {
  matched: boolean;
  chain: AnalogRoute[];
  params: Record<string, string>;
  rejected: { file?: string; path: string; reason: string }[];
}

interface RenderRow {
  path: string;
  file?: string;
  mode: 'ssr' | 'ssg' | 'client';
  reason: string;
  last?: { render?: 'ssr' | 'client'; status: number; ms: number; at: number };
}

interface PrerenderPlan {
  dynamicConfig: boolean;
  listed: string[] | null;
  staticMissing: string[];
  dynamic: string[];
  built: string[];
  notBuilt: string[];
}

interface ApiResult {
  ok?: boolean;
  status?: number;
  ms?: number;
  type?: string;
  body?: string;
  error?: string;
}

type View = 'routes' | 'server' | 'render' | 'content' | 'lint';

interface LintCard {
  rule: string;
  severity: Finding['severity'];
  title: string;
  summary: string;
  fix: string;
  items: { file?: string; path?: string }[];
}

const LINT_TEXT: Record<string, { title: string; summary: string }> = {
  'scan-error': {
    title: 'A folder could not be read',
    summary: 'Its files are missing from routes, API routes and lint results.',
  },
  'duplicate-url': {
    title: 'Two files serve the same URL',
    summary: 'Only one of them is reachable; the other never renders.',
  },
  'sibling-params': {
    title: 'Two dynamic pages in one folder',
    summary: 'Both are [param] pages at the same level, so the first one always wins.',
  },
  'missing-default-export': {
    title: 'Page has no default export',
    summary: 'Analog needs the component as the default export, so the page renders nothing.',
  },
  'redirect-with-component': {
    title: 'Redirect page also exports a component',
    summary: 'The redirect runs first, so the component never shows.',
  },
  'redirect-path-match': {
    title: 'Redirect matches too much',
    summary: 'An empty-path redirect without pathMatch "full" catches every URL below it.',
  },
  'layout-without-outlet': {
    title: 'Layout has no router-outlet',
    summary: 'The layout has child pages, but without <router-outlet> they never render.',
  },
  'server-without-load': {
    title: '.server.ts without load or action',
    summary: 'The server file exports nothing Analog calls.',
  },
  'orphan-server-file': {
    title: '.server.ts without a page',
    summary: 'No page file sits next to it, so its load never runs.',
  },
  'api-method-suffix': {
    title: 'Unknown method suffix on an API file',
    summary: 'The suffix is not an HTTP method, so it becomes part of the URL.',
  },
  'duplicate-api-route': {
    title: 'Two handlers for one API route',
    summary: 'Two files answer the same method and path.',
  },
  'api-outside-prefix': {
    title: 'Server route outside the API prefix',
    summary: 'During vite dev only routes under the prefix reach Nitro.',
  },
  'prerender-unknown-route': {
    title: 'Prerender entry matches no page',
    summary: 'prerender.routes lists a path that no page file serves.',
  },
  'prerender-missing-root': {
    title: 'Home page is not prerendered',
    summary: 'static is on, but prerender.routes leaves out /.',
  },
  'content-frontmatter': {
    title: 'Broken frontmatter',
    summary: 'The markdown frontmatter cannot be read.',
  },
  'duplicate-slug': {
    title: 'Two posts share a slug',
    summary: 'injectContent picks one of them at random.',
  },
  'content-shadows-page': {
    title: 'Markdown file takes over a page',
    summary:
      'Files under src/content are routes too, so these URLs render the markdown file instead of the [param] page.',
  },
  'load-fetched-twice': {
    title: 'load() runs twice',
    summary:
      'These pages fetched their data while rendering on the server and again in the browser.',
  },
  'restart-needed': {
    title: 'New pages need a restart',
    summary: 'These page files exist, but the running router does not know them yet.',
  },
  'hydration-error': {
    title: 'Hydration error',
    summary: 'The browser DOM did not match the server HTML.',
  },
  'api-not-found': {
    title: 'API call failed with 404 or 405',
    summary: 'A request hit a path or method that no server route handles.',
  },
};
type Kind = 'all' | AnalogCall['kind'];

const MODE_LABEL = { ssr: 'SSR', ssg: 'Prerendered', client: 'Client only' } as const;
const KIND_LABEL: Record<Kind, string> = {
  all: 'All',
  page: 'Pages',
  load: 'load()',
  fn: 'Server fn',
  api: 'API',
};

function call<T>(client: DevframeRpcClient | null, name: string, arg?: unknown): Promise<T | null> {
  if (!client) return Promise.resolve(null);
  const rpc = client.scope('ng-devtools').rpc as unknown as {
    call: (name: string, ...args: unknown[]) => Promise<unknown>;
  };
  return rpc.call(name, ...(arg === undefined ? [] : [arg])).then(
    (value) => value as T,
    () => null,
  );
}

function walk(routes: AnalogRoute[], depth = 0, out: { route: AnalogRoute; depth: number }[] = []) {
  for (const route of routes) {
    out.push({ route, depth });
    walk(route.children, depth + 1, out);
  }
  return out;
}

@Component({
  selector: 'app-analog-inspector',
  template: `
    @if (project() === null) {
      <p class="muted pad">Reading the project…</p>
    } @else if (!project()!.analog) {
      <div class="empty">
        <p>This app is not an Analog app.</p>
        <p class="muted">
          Add <code>ngDevtools()</code> from <code>@santoshyadavdev/ng-devtools/vite</code> next to
          <code>analog()</code> in vite.config.ts and run the Analog dev server.
        </p>
      </div>
    } @else {
      <section class="summary" aria-label="Analog summary">
        <div class="stat">
          <span class="label">Analog</span>
          <span class="value">{{ project()!.version }}</span>
        </div>
        <div class="stat">
          <span class="label">Pages</span>
          <span class="value">{{ pageCount() }}</span>
        </div>
        <div class="stat">
          <span class="label">API routes</span>
          <span class="value">{{ project()!.api.length }}</span>
        </div>
        <div class="stat">
          <span class="label">Server calls</span>
          <span class="value">{{ allCalls().length }}</span>
        </div>
        <div class="stat" [attr.data-tone]="findings().length ? 'warn' : 'good'">
          <span class="label">Issues</span>
          <span class="value">{{ findings().length }}</span>
        </div>
        @if (page(); as p) {
          <div class="stat wide">
            <span class="label">Open in the browser</span>
            <span class="value mono">{{ p.url }}</span>
          </div>
        }
      </section>

      <div class="tabs" role="tablist" aria-label="Analog views" (keydown)="onKey($event)">
        @for (v of views(); track v.id) {
          <button
            type="button"
            role="tab"
            [id]="'analog-tab-' + v.id"
            [attr.aria-selected]="v.id === view()"
            [attr.aria-controls]="'analog-panel-' + v.id"
            [attr.tabindex]="v.id === view() ? 0 : -1"
            (click)="view.set(v.id)"
          >
            {{ v.label }}
            <span class="count" [attr.data-tone]="v.tone">{{ v.count }}</span>
          </button>
        }
      </div>

      <div
        class="panel"
        role="tabpanel"
        [id]="'analog-panel-' + view()"
        [attr.aria-labelledby]="'analog-tab-' + view()"
      >
        @switch (view()) {
          @case ('routes') {
            <div class="toolbar">
              <form class="inline" (submit)="$event.preventDefault(); explain()">
                <label for="analog-url">Test a URL</label>
                <input
                  id="analog-url"
                  class="field"
                  type="text"
                  placeholder="/products/42"
                  [value]="testUrl()"
                  (input)="testUrl.set($any($event.target).value)"
                />
                <button type="submit" class="btn">Explain</button>
              </form>
              <label class="sr-only" for="route-filter">Filter routes</label>
              <input
                id="route-filter"
                class="field"
                type="search"
                placeholder="Filter by path or file"
                [value]="filter()"
                (input)="filter.set($any($event.target).value)"
              />
            </div>
            @if (match(); as m) {
              <div class="callout" [attr.data-tone]="m.matched ? 'good' : 'bad'" role="status">
                @if (m.matched) {
                  <strong>{{ testUrl() }}</strong> renders
                  <ol class="chain">
                    @for (r of m.chain; track r.id) {
                      <li>
                        <span class="mono">{{ short(r.file) ?? r.fullPath }}</span>
                        <span class="pill" [attr.data-kind]="r.kind">{{ r.kind }}</span>
                      </li>
                    }
                  </ol>
                  @if (paramList(m.params).length) {
                    <div class="chips">
                      @for (p of paramList(m.params); track p[0]) {
                        <span class="chip mono">{{ p[0] }} = {{ p[1] }}</span>
                      }
                    </div>
                  }
                } @else {
                  <strong>{{ testUrl() }}</strong> matches no file route. Angular throws NG04002
                  "Cannot match any routes".
                  @if (m.rejected.length) {
                    <ul class="plain">
                      @for (r of m.rejected.slice(0, 5); track $index) {
                        <li>
                          <span class="mono">{{ short(r.file) ?? r.path }}</span>
                          <span class="muted">{{ r.reason }}</span>
                        </li>
                      }
                    </ul>
                  }
                }
              </div>
            }
            <div class="table-wrap" role="region" aria-label="File routes" tabindex="0">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Route</th>
                    <th scope="col">File</th>
                    <th scope="col">Data</th>
                    <th scope="col">Route meta</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of routeRows(); track row.route.id) {
                    <tr
                      [class.open]="isOpen(row.route)"
                      [class.dim]="row.route.kind === 'group' || row.route.kind === 'implicit'"
                    >
                      <td>
                        <div class="route" [style.padding-left.px]="row.depth * 18">
                          @if (row.depth) {
                            <span class="guide" aria-hidden="true">└</span>
                          }
                          <span class="mono path">{{ row.route.fullPath }}</span>
                          <span class="pill" [attr.data-kind]="row.route.kind">{{
                            kindText(row.route)
                          }}</span>
                          @if (isOpen(row.route)) {
                            <span class="pill live">open</span>
                          }
                        </div>
                      </td>
                      <td>
                        @if (row.route.file) {
                          <span class="file"
                            ><span class="dir">{{ dir(row.route.file) }}</span
                            >{{ base(row.route.file) }}</span
                          >
                        } @else {
                          <span class="muted">folder only</span>
                        }
                      </td>
                      <td>
                        @for (e of serverExports(row.route); track e) {
                          <span class="pill" data-kind="load">{{ e }}()</span>
                        }
                      </td>
                      <td>
                        @if (row.route.title) {
                          <span class="chip">"{{ row.route.title }}"</span>
                        }
                        @for (key of row.route.routeMeta ?? []; track key) {
                          @if (key !== 'title') {
                            <span class="chip mono">{{ key }}</span>
                          }
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="4" class="muted">No route matches the filter.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          @case ('server') {
            @if (duplicates().length) {
              <div class="callout" data-tone="warn" role="note">
                <strong>load() ran twice</strong> for
                @for (d of duplicates(); track d; let last = $last) {
                  <span class="mono">{{ d }}</span
                  >{{ last ? '' : ', ' }}
                }
                : once while server rendering, again in the browser. TransferState did not serve the
                server result.
              </div>
            }
            <fieldset class="segmented">
              <legend class="sr-only">Show calls of kind</legend>
              @for (k of kinds; track k) {
                <label [class.on]="kind() === k">
                  <input
                    type="radio"
                    name="analog-kind"
                    class="sr-only"
                    [checked]="kind() === k"
                    (change)="kind.set(k)"
                  />
                  {{ kindLabel(k) }} <span class="muted">{{ kindCount(k) }}</span>
                </label>
              }
            </fieldset>
            @if (calls().length) {
              <div class="table-wrap" role="region" aria-label="Server calls" tabindex="0">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Kind</th>
                      <th scope="col">Request</th>
                      <th scope="col">Status</th>
                      <th scope="col" class="num">Time</th>
                      <th scope="col">From</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (c of calls(); track c.id) {
                      <tr>
                        <td class="muted nowrap">{{ time(c.at) }}</td>
                        <td>
                          <span class="pill" [attr.data-call]="c.kind">{{
                            kindLabel(c.kind)
                          }}</span>
                        </td>
                        <td class="request">
                          <span class="method" [attr.data-method]="c.method">{{ c.method }}</span>
                          <span class="mono">{{ c.url }}</span>
                          @if (c.render) {
                            <span
                              class="pill"
                              [attr.data-mode]="c.render === 'ssr' ? 'ssr' : 'client'"
                              >{{ c.render === 'ssr' ? 'server rendered' : 'client only' }}</span
                            >
                          }
                          @if (c.preview) {
                            <details>
                              <summary>Response</summary>
                              <pre class="code">{{ pretty(c.preview) }}</pre>
                            </details>
                          }
                        </td>
                        <td>
                          <span class="status" [attr.data-status]="statusClass(c.status)">{{
                            c.status
                          }}</span>
                        </td>
                        <td class="num nowrap">{{ c.ms }} ms</td>
                        <td class="muted">{{ c.from }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="muted">
                No calls yet. Navigate in the app to see page renders, load() fetches and API calls.
              </p>
            }

            <h3>API routes</h3>
            <div class="table-wrap" role="region" aria-label="API routes" tabindex="0">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Method</th>
                    <th scope="col">Path</th>
                    <th scope="col">File</th>
                    <th scope="col"><span class="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (api of project()!.api; track api.file + api.method) {
                    <tr>
                      <td>
                        <span class="method" [attr.data-method]="api.method">{{ api.method }}</span>
                      </td>
                      <td class="mono">{{ api.path }}</td>
                      <td>
                        <span class="file"
                          ><span class="dir">{{ dir(api.file) }}</span
                          >{{ base(api.file) }}</span
                        >
                      </td>
                      <td>
                        <button
                          type="button"
                          class="btn ghost"
                          [attr.aria-label]="'Try ' + api.method + ' ' + api.path"
                          (click)="tryApi(api)"
                        >
                          Try
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <form class="card playground" (submit)="$event.preventDefault(); send()">
              <h3>Request playground</h3>
              <div class="row">
                <label for="api-method" class="sr-only">Method</label>
                <select
                  id="api-method"
                  class="field"
                  [value]="method()"
                  (change)="method.set($any($event.target).value)"
                >
                  @for (m of methods; track m) {
                    <option [value]="m">{{ m }}</option>
                  }
                </select>
                <label for="api-path" class="sr-only">Path</label>
                <input
                  id="api-path"
                  class="field grow mono"
                  type="text"
                  placeholder="/api/v1/products"
                  [value]="apiPath()"
                  (input)="apiPath.set($any($event.target).value)"
                />
                <button type="submit" class="btn">Send</button>
              </div>
              @if (method() !== 'GET') {
                <label for="api-body">JSON body</label>
                <textarea
                  id="api-body"
                  class="field mono"
                  rows="3"
                  placeholder='{"name": "Ada"}'
                  [value]="apiBody()"
                  (input)="apiBody.set($any($event.target).value)"
                ></textarea>
                <label class="check"
                  ><input
                    type="checkbox"
                    [checked]="confirmSend()"
                    (change)="confirmSend.set(!confirmSend())"
                  />
                  This request can change data on the dev server</label
                >
              }
              @if (response(); as r) {
                <div class="response" role="status">
                  @if (r.error) {
                    <span class="status" data-status="bad">Refused</span>
                    <span>{{ r.error }}</span>
                  } @else {
                    <div class="row">
                      <span class="status" [attr.data-status]="statusClass(r.status ?? 0)">{{
                        r.status
                      }}</span>
                      <span class="muted">{{ r.ms }} ms · {{ r.type || 'no content type' }}</span>
                    </div>
                    <pre class="code">{{ pretty(r.body ?? '') }}</pre>
                  }
                </div>
              }
            </form>
          }

          @case ('render') {
            <div class="chips">
              @for (m of modeCounts(); track m.mode) {
                <span class="pill" [attr.data-mode]="m.mode">{{ m.label }} · {{ m.count }}</span>
              }
            </div>
            <div class="table-wrap" role="region" aria-label="Render modes" tabindex="0">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Route</th>
                    <th scope="col">Configured</th>
                    <th scope="col">Last request</th>
                    <th scope="col">File</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of renderRows(); track row.path) {
                    <tr>
                      <td class="mono path">{{ row.path }}</td>
                      <td>
                        <span class="pill" [attr.data-mode]="row.mode">{{
                          modeLabel(row.mode)
                        }}</span>
                        <span class="muted small">{{ row.reason }}</span>
                      </td>
                      <td>
                        @if (row.last; as last) {
                          <span class="status" [attr.data-status]="statusClass(last.status)">{{
                            last.status
                          }}</span>
                          <span class="muted small"
                            >{{ last.render === 'client' ? 'client only' : 'server rendered' }} ·
                            {{ last.ms }} ms</span
                          >
                          @if (mismatch(row)) {
                            <span class="pill" data-tone="warn">differs from config</span>
                          }
                        } @else {
                          <span class="muted small">not requested yet</span>
                        }
                      </td>
                      <td>
                        @if (row.file) {
                          <span class="file"
                            ><span class="dir">{{ dir(row.file) }}</span
                            >{{ base(row.file) }}</span
                          >
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (plan(); as p) {
              <div class="card">
                <h3>Prerender plan</h3>
                @if (p.dynamicConfig) {
                  <p class="muted">
                    prerender.routes is a function, so the list is known only at build time.
                  </p>
                } @else {
                  <dl class="facts">
                    <dt>Listed</dt>
                    <dd>
                      @for (r of p.listed ?? ['/']; track r) {
                        <span class="chip mono">{{ r }}</span>
                      }
                      @if (!p.listed) {
                        <span class="muted small">default, nothing configured</span>
                      }
                    </dd>
                    @if (p.staticMissing.length) {
                      <dt>Static, not listed</dt>
                      <dd>
                        @for (r of p.staticMissing; track r) {
                          <span class="chip mono" data-tone="warn">{{ r }}</span>
                        }
                      </dd>
                    }
                    @if (p.dynamic.length) {
                      <dt>Need explicit entries</dt>
                      <dd>
                        @for (r of p.dynamic; track r) {
                          <span class="chip mono">{{ r }}</span>
                        }
                      </dd>
                    }
                    <dt>Build output</dt>
                    <dd>
                      @if (p.built.length) {
                        {{ p.built.length }} page(s) in dist/analog/public
                        @if (p.notBuilt.length) {
                          · missing
                          @for (r of p.notBuilt; track r) {
                            <span class="chip mono" data-tone="bad">{{ r }}</span>
                          }
                        }
                      } @else {
                        <span class="muted small">no build yet</span>
                      }
                    </dd>
                  </dl>
                }
              </div>
            }
          }

          @case ('content') {
            @if (project()!.content.length) {
              <div class="table-wrap" role="region" aria-label="Content files" tabindex="0">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Title</th>
                      <th scope="col">URL</th>
                      <th scope="col">Slug</th>
                      <th scope="col">Date</th>
                      <th scope="col">File</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (f of project()!.content; track f.file) {
                      <tr>
                        <td>
                          <strong>{{ f.attributes['title'] || '(no title)' }}</strong>
                          @if (f.error) {
                            <div>
                              <span class="pill" data-tone="bad">{{ f.error }}</span>
                            </div>
                          }
                          @if (shadowed(f.file); as page) {
                            <div>
                              <span class="pill" data-tone="warn">takes over {{ base(page) }}</span>
                            </div>
                          }
                        </td>
                        <td class="mono path">{{ contentUrl(f.file) ?? '' }}</td>
                        <td class="mono">{{ f.slug }}</td>
                        <td class="muted nowrap">{{ f.attributes['date'] || '' }}</td>
                        <td>
                          <span class="file"
                            ><span class="dir">{{ dir(f.file) }}</span
                            >{{ base(f.file) }}</span
                          >
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="muted">No markdown files under src/content.</p>
            }
          }

          @case ('lint') {
            @if (findings().length) {
              <p class="muted">
                {{ findings().length }} issue(s) in {{ lintCards().length }} group(s). Each card
                says what is wrong, where, and how to fix it.
              </p>
              <ul class="findings">
                @for (card of lintCards(); track card.rule) {
                  <li [attr.data-tone]="tone(card.severity)">
                    <div class="finding-head">
                      <span class="pill" [attr.data-tone]="tone(card.severity)">{{
                        card.severity
                      }}</span>
                      <strong class="finding-title">{{ card.title }}</strong>
                      @if (card.items.length > 1) {
                        <span class="count">{{ card.items.length }}</span>
                      }
                    </div>
                    <p>{{ card.summary }}</p>
                    <ul class="where">
                      @for (item of card.items; track $index) {
                        <li>
                          @if (item.file) {
                            <span class="file"
                              ><span class="dir">{{ dir(item.file) }}</span
                              >{{ base(item.file) }}</span
                            >
                          }
                          @if (item.path && item.path !== item.file) {
                            <span class="mono path">{{ item.path }}</span>
                          }
                        </li>
                      }
                    </ul>
                    <div class="fix"><strong>How to fix</strong> {{ card.fix }}</div>
                    <span class="rule mono">{{ card.rule }}</span>
                  </li>
                }
              </ul>
            } @else {
              <div class="callout" data-tone="good">No Analog problems found.</div>
            }
          }
        }
      </div>
    }
  `,
  styles: `
    :host {
      --good: #4ade80;
      --warn: #facc15;
      --bad: #f87171;
      --info: #60a5fa;
      --line: #27272a;
      --soft: #18181b;
      display: grid;
      gap: 14px;
      color: #e4e4e7;
      font-size: 13px;
    }
    .pad {
      padding: 16px;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }
    .muted {
      color: #a1a1aa;
    }
    .small {
      font-size: 12px;
    }
    .pill + .small,
    .status + .small {
      margin-left: 8px;
    }
    .nowrap {
      white-space: nowrap;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 10px;
    }
    .stat {
      display: grid;
      gap: 2px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--soft);
    }
    .stat.wide {
      grid-column: span 2;
    }
    .stat .label {
      color: #a1a1aa;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .stat .value {
      font-size: 18px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .stat .value.mono {
      font-size: 14px;
    }
    .stat[data-tone='warn'] .value {
      color: var(--warn);
    }
    .stat[data-tone='good'] .value {
      color: var(--good);
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      border-bottom: 1px solid var(--line);
    }
    [role='tab'] {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      padding: 8px 12px;
      border: none;
      border-bottom: 2px solid transparent;
      background: none;
      color: #d4d4d8;
      font: inherit;
      cursor: pointer;
    }
    [role='tab'][aria-selected='true'] {
      border-bottom-color: var(--accent);
      color: #fafafa;
    }
    .count {
      min-width: 18px;
      padding: 0 6px;
      border-radius: 999px;
      background: #27272a;
      color: #d4d4d8;
      font-size: 11px;
      text-align: center;
    }
    .count[data-tone='warn'] {
      background: #422006;
      color: var(--warn);
    }
    .panel {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
    }
    .inline,
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .field {
      padding: 6px 10px;
      border: 1px solid #3f3f46;
      border-radius: 8px;
      background: var(--soft);
      color: #e4e4e7;
      font: inherit;
    }
    textarea.field {
      width: 100%;
      box-sizing: border-box;
      resize: vertical;
    }
    .grow {
      flex: 1;
      min-width: 180px;
    }
    .btn {
      padding: 6px 12px;
      border: 1px solid #52525b;
      border-radius: 8px;
      background: #27272a;
      color: #fafafa;
      font: inherit;
      cursor: pointer;
    }
    .btn:hover {
      border-color: var(--accent);
    }
    .btn.ghost {
      padding: 2px 10px;
      background: transparent;
    }
    [role='tab']:focus-visible,
    .btn:focus-visible,
    .field:focus-visible,
    .table-wrap:focus-visible,
    summary:focus-visible,
    .segmented label:focus-within {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .callout {
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-left: 3px solid var(--info);
      border-radius: 8px;
      background: var(--soft);
      line-height: 1.6;
    }
    .callout[data-tone='good'] {
      border-left-color: var(--good);
    }
    .callout[data-tone='warn'] {
      border-left-color: var(--warn);
    }
    .callout[data-tone='bad'] {
      border-left-color: var(--bad);
    }
    .chain {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 6px 0 0;
      padding: 0;
      list-style: none;
    }
    .chain li:not(:last-child)::after {
      content: '›';
      margin-left: 6px;
      color: #71717a;
    }
    .plain {
      margin: 6px 0 0;
      padding-left: 18px;
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    th {
      background: var(--soft);
      color: #a1a1aa;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .num {
      text-align: right;
    }
    tbody tr:hover td {
      background: #141417;
    }
    tr.open td {
      background: #1c1917;
    }
    tr.open td:first-child {
      box-shadow: inset 3px 0 0 var(--accent);
    }
    tr.dim .path {
      color: #a1a1aa;
    }
    .route {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .guide {
      color: #52525b;
    }
    .path {
      color: #f0abfc;
    }
    .file {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: #e4e4e7;
      overflow-wrap: anywhere;
    }
    .dir {
      color: #a1a1aa;
    }
    .pill,
    .chip,
    .status,
    .method {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 11px;
      line-height: 18px;
      white-space: nowrap;
    }
    .pill,
    .chip {
      border: 1px solid #3f3f46;
      color: #d4d4d8;
    }
    .chip {
      border-radius: 6px;
      margin: 0 4px 4px 0;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .pill.live {
      border-color: var(--accent);
      color: #fda4af;
    }
    .pill[data-kind='layout'] {
      border-color: #6366f1;
      color: #c7d2fe;
    }
    .pill[data-kind='markdown'] {
      border-color: #0ea5e9;
      color: #bae6fd;
    }
    .pill[data-kind='load'] {
      border-color: #a855f7;
      color: #e9d5ff;
    }
    .pill[data-mode='ssr'] {
      border-color: #3b82f6;
      color: #bfdbfe;
    }
    .pill[data-mode='ssg'] {
      border-color: #22c55e;
      color: #bbf7d0;
    }
    .pill[data-mode='client'] {
      border-color: #eab308;
      color: #fef08a;
    }
    .pill[data-call='page'] {
      border-color: #3b82f6;
      color: #bfdbfe;
    }
    .pill[data-call='load'] {
      border-color: #a855f7;
      color: #e9d5ff;
    }
    .pill[data-call='fn'] {
      border-color: #14b8a6;
      color: #99f6e4;
    }
    .pill[data-call='api'] {
      border-color: #f97316;
      color: #fed7aa;
    }
    [data-tone='warn'].pill,
    [data-tone='warn'].chip {
      border-color: #a16207;
      color: #fef08a;
    }
    [data-tone='bad'].pill,
    [data-tone='bad'].chip {
      border-color: #b91c1c;
      color: #fecaca;
    }
    [data-tone='info'].pill {
      border-color: #1d4ed8;
      color: #bfdbfe;
    }
    .status {
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .status[data-status='good'] {
      background: #052e16;
      color: #86efac;
    }
    .status[data-status='warn'] {
      background: #422006;
      color: #fde68a;
    }
    .status[data-status='bad'] {
      background: #450a0a;
      color: #fecaca;
    }
    .method {
      min-width: 44px;
      margin-right: 6px;
      background: #27272a;
      color: #e4e4e7;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 600;
      text-align: center;
    }
    .method[data-method='GET'] {
      background: #082f49;
      color: #7dd3fc;
    }
    .method[data-method='POST'] {
      background: #052e16;
      color: #86efac;
    }
    .method[data-method='PUT'],
    .method[data-method='PATCH'] {
      background: #422006;
      color: #fde68a;
    }
    .method[data-method='DELETE'] {
      background: #450a0a;
      color: #fecaca;
    }
    .request {
      min-width: 260px;
    }
    .request .pill {
      margin-left: 6px;
    }
    details {
      margin-top: 6px;
    }
    summary {
      cursor: pointer;
      color: #a1a1aa;
      font-size: 12px;
    }
    .code {
      margin: 6px 0 0;
      padding: 8px 10px;
      max-height: 220px;
      overflow: auto;
      border-radius: 8px;
      background: #09090b;
      color: #e4e4e7;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .segmented {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 2px;
      margin: 0;
      padding: 3px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--soft);
      justify-self: start;
    }
    .segmented label {
      padding: 4px 10px;
      border-radius: 7px;
      cursor: pointer;
    }
    .segmented label.on {
      background: #3f3f46;
      color: #fafafa;
    }
    .segmented label.on .muted {
      color: #d4d4d8;
    }
    h3 {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 6px 0 0;
      color: #e4e4e7;
      font-size: 13px;
    }
    .card {
      display: grid;
      gap: 8px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--soft);
    }
    .card h3 {
      margin: 0;
    }
    .check {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .response {
      display: grid;
      gap: 6px;
    }
    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 14px;
      margin: 0;
    }
    .facts dt {
      color: #a1a1aa;
    }
    .facts dd {
      margin: 0;
    }
    .findings {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .findings li {
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-left: 3px solid var(--info);
      border-radius: 8px;
      background: var(--soft);
    }
    .findings li[data-tone='bad'] {
      border-left-color: var(--bad);
    }
    .findings li[data-tone='warn'] {
      border-left-color: var(--warn);
    }
    .findings p {
      margin: 6px 0 0;
      line-height: 1.5;
    }
    .finding-head {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .finding-title {
      font-size: 14px;
      color: #fafafa;
    }
    .where {
      display: grid;
      gap: 4px;
      margin: 8px 0 0;
      padding: 8px 10px;
      border-radius: 8px;
      background: #0f0f11;
      list-style: none;
    }
    .where li {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .fix {
      margin-top: 8px;
      color: #e4e4e7;
      line-height: 1.5;
    }
    .fix strong {
      display: block;
      margin-bottom: 2px;
      color: var(--good);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .rule {
      display: block;
      margin-top: 8px;
      color: #a1a1aa;
    }
    .findings > li > p {
      color: #d4d4d8;
    }
    .empty {
      padding: 32px;
      text-align: center;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class AnalogInspector {
  rpc = input<DevframeRpcClient | null>(null);

  readonly kinds: Kind[] = ['all', 'page', 'load', 'fn', 'api'];
  readonly methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  readonly view = signal<View>('routes');
  readonly project = signal<AnalogProject | null>(null);
  readonly state = signal<AnalogState>({});
  readonly findings = signal<Finding[]>([]);
  readonly renderRows = signal<RenderRow[]>([]);
  readonly plan = signal<PrerenderPlan | null>(null);
  readonly filter = signal('');
  readonly testUrl = signal('');
  readonly match = signal<UrlMatch | null>(null);
  readonly kind = signal<Kind>('all');
  readonly method = signal('GET');
  readonly apiPath = signal('');
  readonly apiBody = signal('');
  readonly confirmSend = signal(false);
  readonly response = signal<ApiResult | null>(null);

  private unsubscribe: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshRun = 0;
  private readonly destroyRef = inject(DestroyRef);

  readonly page = computed(() => this.state().pages?.[0] ?? null);
  readonly openFiles = computed(() => new Set((this.page()?.chain ?? []).map((c) => c.file)));
  readonly allCalls = computed(() => this.state().calls ?? []);
  readonly calls = computed(() => {
    const kind = this.kind();
    return this.allCalls()
      .filter((c) => kind === 'all' || c.kind === kind)
      .slice(-150)
      .reverse();
  });
  readonly allRoutes = computed(() => walk(this.project()?.routes ?? []));
  readonly pageCount = computed(
    () => this.allRoutes().filter((r) => r.route.file && r.route.kind !== 'layout').length,
  );
  readonly routeRows = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    if (!needle) return this.allRoutes();
    return this.allRoutes().filter(
      (r) =>
        r.route.fullPath.toLowerCase().includes(needle) ||
        !!r.route.file?.toLowerCase().includes(needle),
    );
  });
  readonly duplicates = computed(() => {
    const seen = new Map<string, number>();
    const out = new Set<string>();
    for (const c of this.allCalls()) {
      if (c.kind !== 'load') continue;
      const route = c.url.replace(/^.*\/_analog\/pages/, '').replace(/\/index$/, '') || '/';
      if (c.from === 'ssr') seen.set(route, c.at);
      else if (c.from === 'browser' && (seen.get(route) ?? -Infinity) > c.at - 15_000)
        out.add(route);
    }
    return Array.from(out);
  });
  readonly modeCounts = computed(() =>
    (['ssr', 'ssg', 'client'] as const)
      .map((mode) => ({
        mode,
        label: MODE_LABEL[mode],
        count: this.renderRows().filter((r) => r.mode === mode).length,
      }))
      .filter((m) => m.count),
  );
  readonly lintCards = computed(() => {
    const order = { error: 0, warning: 1, info: 2 };
    const cards = new Map<string, LintCard>();
    for (const finding of this.findings()) {
      let card = cards.get(finding.rule);
      if (!card) {
        const known = LINT_TEXT[finding.rule];
        card = {
          rule: finding.rule,
          severity: finding.severity,
          title: known?.title ?? finding.rule,
          summary: known?.summary ?? finding.message,
          fix: finding.fix,
          items: [],
        };
        cards.set(finding.rule, card);
      }
      card.items.push({ file: finding.file, path: finding.path });
    }
    return Array.from(cards.values()).sort((a, b) => order[a.severity] - order[b.severity]);
  });
  readonly views = computed(() => {
    const errors = this.findings().length;
    return [
      { id: 'routes' as View, label: 'Routes', count: this.pageCount(), tone: '' },
      { id: 'server' as View, label: 'Server', count: this.allCalls().length, tone: '' },
      { id: 'render' as View, label: 'Render', count: this.renderRows().length, tone: '' },
      {
        id: 'content' as View,
        label: 'Content',
        count: this.project()?.content.length ?? 0,
        tone: '',
      },
      { id: 'lint' as View, label: 'Lint', count: errors, tone: errors ? 'warn' : '' },
    ];
  });

  constructor() {
    effect(() => {
      const client = this.rpc();
      if (client) untracked(() => void this.load(client));
    });
    effect(() => {
      const view = this.view();
      this.state();
      untracked(() => this.scheduleRefresh(view));
    });
    this.destroyRef.onDestroy(() => {
      this.unsubscribe?.();
      clearTimeout(this.refreshTimer);
    });
  }

  private async load(client: DevframeRpcClient) {
    this.project.set(await call<AnalogProject>(client, 'analog-project'));
    try {
      const shared = await client.scope('ng-devtools').rpc.sharedState('analog');
      const apply = (value: unknown) => this.state.set((value as AnalogState) ?? {});
      apply(shared.value());
      this.unsubscribe?.();
      this.unsubscribe = shared.on('updated', apply);
    } catch {
      this.state.set({});
    }
    await this.refresh(this.view());
  }

  private scheduleRefresh(view: View) {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(view), 300);
  }

  private async refresh(view: View) {
    const client = this.rpc();
    if (!client) return;
    const run = ++this.refreshRun;
    const [findings, render] = await Promise.all([
      call<Finding[]>(client, 'analog-lint'),
      call<{ rows: RenderRow[]; plan: PrerenderPlan }>(client, 'analog-render'),
    ]);
    if (run !== this.refreshRun) return;
    this.findings.set(findings ?? []);
    this.renderRows.set(render?.rows ?? []);
    this.plan.set(render?.plan ?? null);
    if (view === 'routes' || view === 'content') {
      const project = await call<AnalogProject>(client, 'analog-project');
      if (project && run === this.refreshRun) this.project.set(project);
    }
  }

  isOpen(route: AnalogRoute): boolean {
    return !!route.file && this.openFiles().has(route.file);
  }

  kindText(route: AnalogRoute): string {
    if (route.catchAll) return route.catchAll === 'optional' ? 'optional catch-all' : 'catch-all';
    if (route.kind === 'implicit') return 'folder';
    return route.kind;
  }

  serverExports(route: AnalogRoute): string[] {
    return (route.serverExports ?? []).filter((e) => e === 'load' || e === 'action');
  }

  short(file: string | undefined): string | undefined {
    return file?.replace(/^\/src\/app\//, '').replace(/^\//, '');
  }

  dir(file: string): string {
    const short = this.short(file) ?? file;
    return short.includes('/') ? short.slice(0, short.lastIndexOf('/') + 1) : '';
  }

  base(file: string): string {
    return file.slice(file.lastIndexOf('/') + 1);
  }

  paramList(params: Record<string, string>): [string, string][] {
    return Object.entries(params);
  }

  kindLabel(kind: Kind): string {
    return KIND_LABEL[kind];
  }

  kindCount(kind: Kind): number {
    return kind === 'all'
      ? this.allCalls().length
      : this.allCalls().filter((c) => c.kind === kind).length;
  }

  modeLabel(mode: RenderRow['mode']): string {
    return MODE_LABEL[mode];
  }

  mismatch(row: RenderRow): boolean {
    if (!row.last?.render) return false;
    return row.mode === 'client' ? row.last.render !== 'client' : row.last.render === 'client';
  }

  statusClass(status: number): 'good' | 'warn' | 'bad' {
    if (status >= 500 || status === 0) return 'bad';
    if (status >= 400) return 'warn';
    return 'good';
  }

  tone(severity: Finding['severity']): 'bad' | 'warn' | 'info' {
    return severity === 'error' ? 'bad' : severity === 'warning' ? 'warn' : 'info';
  }

  shadowed(file: string): string | undefined {
    const finding = this.findings().find(
      (f) => f.rule === 'content-shadows-page' && f.file === file,
    );
    return finding?.message.match(/(\/\S+\.page\.ts)/)?.[1];
  }

  contentUrl(file: string): string | undefined {
    return this.allRoutes().find((r) => r.route.file === file)?.route.fullPath;
  }

  pretty(text: string): string {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  time(at: number): string {
    return new Date(at).toLocaleTimeString();
  }

  tryApi(api: ApiRoute) {
    this.method.set(api.method === 'ANY' ? 'GET' : api.method);
    this.apiPath.set(api.path.replace(/:(\w+)/g, '1').replace('**', 'x'));
    this.response.set(null);
    queueMicrotask(() => document.getElementById('api-path')?.focus());
  }

  async explain() {
    const url = this.testUrl().trim();
    if (!url) return;
    this.match.set(await call<UrlMatch>(this.rpc(), 'analog-explain-url', url));
  }

  async send() {
    const path = this.apiPath().trim();
    if (!path) return;
    let body: unknown;
    if (this.method() !== 'GET' && this.apiBody().trim()) {
      try {
        body = JSON.parse(this.apiBody());
      } catch {
        this.response.set({ error: 'The body is not valid JSON.' });
        return;
      }
    }
    const result = await call<ApiResult>(this.rpc(), 'analog-call-api', {
      method: this.method(),
      path,
      body,
      confirm: this.confirmSend(),
    });
    this.response.set(result ?? { error: 'No answer from the devtools server.' });
  }

  onKey(event: KeyboardEvent) {
    const order = this.views().map((v) => v.id);
    const index = order.indexOf(this.view());
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % order.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + order.length) % order.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    else return;
    event.preventDefault();
    this.view.set(order[next]);
    const host = event.currentTarget as HTMLElement;
    queueMicrotask(() => host.querySelector<HTMLElement>(`#analog-tab-${order[next]}`)?.focus());
  }
}
