import {
  DEVTOOLS_HEADER,
  clearCalls,
  devOrigin,
  duplicateLoads,
  onCalls,
  recentCalls,
  type AnalogCall,
} from '../analog-server-log.ts';
import { explainUrl, scanAnalog, type AnalogProject } from './analog-scan.ts';
import {
  analogApiRoutesText,
  analogContentText,
  analogCurrentPageText,
  analogExplainUrlText,
  analogLint,
  analogLintText,
  analogPrerenderText,
  analogRenderModesText,
  analogRoutesText,
  analogServerCallsText,
  isAnalogReport,
  mergeAnalogReport,
  prerenderPlan,
  renderRows,
  resolveAnalogReport,
  type AnalogState,
} from './analog-tools.ts';

type AnyRecord = Record<string, any>;

const SCAN_CACHE_MS = 2000;
const CALL_TIMEOUT_MS = 10_000;
const MAX_BODY = 2000;
const PAGE_TTL_MS = 15_000;

let disposeAnalog: (() => void) | undefined;

interface Scoped {
  rpc: {
    register(definition: AnyRecord): void;
    sharedState(name: string, options: AnyRecord): Promise<AnyRecord>;
  };
}

interface AgentHost {
  cwd: string;
  agent: { registerTool(tool: AnyRecord): void };
}

export interface ApiRequest {
  method?: string;
  path: string;
  body?: unknown;
  confirm?: boolean;
}

export async function callApi(request: ApiRequest, origin = devOrigin()): Promise<AnyRecord> {
  const method = (request.method ?? 'GET').toUpperCase();
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)) {
    return { ok: false, error: `Unsupported method ${method}.` };
  }
  if (
    typeof request.path !== 'string' ||
    !request.path.startsWith('/') ||
    request.path.startsWith('//') ||
    request.path.length > 2000
  ) {
    return { ok: false, error: 'Pass a path that starts with /, for example /api/v1/hello.' };
  }
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && request.confirm !== true) {
    return { ok: false, error: `${method} can change data; call again with confirm: true.` };
  }
  if (!origin) {
    return {
      ok: false,
      error:
        'The dev server address is unknown. This works only through the ngDevtools() Vite plugin.',
    };
  }
  const started = performance.now();
  try {
    const response = await fetch(`${origin}${request.path}`, {
      method,
      headers: {
        [DEVTOOLS_HEADER]: '1',
        ...(request.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      redirect: 'manual',
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      ms: Math.round(performance.now() - started),
      type: response.headers.get('content-type') ?? '',
      body: text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}…` : text,
    };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export function stopAnalog() {
  disposeAnalog?.();
  disposeAnalog = undefined;
}

export async function registerAnalog(my: Scoped, ctx: AgentHost) {
  disposeAnalog?.();
  const state = await my.rpc.sharedState('analog', {
    initialValue: { pages: [], calls: [], duplicates: [], reportedAt: 0 } as AnalogState,
  });
  const current = () => state['value']() as AnalogState;
  const apply = (next: AnalogState) =>
    state['mutate']((draft: AnalogState) => {
      draft.pages = next.pages;
      draft.calls = next.calls;
      draft.duplicates = next.duplicates;
      draft.reportedAt = next.reportedAt;
    });
  const withCalls = (calls: AnalogCall[]) =>
    apply({ ...current(), calls, duplicates: duplicateLoads(calls) });
  withCalls(recentCalls());
  const stopCalls = onCalls(withCalls);

  const seenAt = new Map<string, number>();
  const dropPages = (ids: string[]) => {
    if (!ids.length) return;
    for (const id of ids) seenAt.delete(id);
    const now = current();
    apply({ ...now, pages: now.pages.filter((p) => !ids.includes(p.pageId)) });
  };
  const expiry = setInterval(() => {
    const now = Date.now();
    dropPages(
      current()
        .pages.map((p) => p.pageId)
        .filter((id) => now - (seenAt.get(id) ?? 0) > PAGE_TTL_MS),
    );
  }, 5000);
  expiry.unref?.();
  disposeAnalog = () => {
    clearInterval(expiry);
    stopCalls();
  };

  let cache: { at: number; project: AnalogProject } | null = null;
  const project = () => {
    if (!cache || Date.now() - cache.at > SCAN_CACHE_MS) {
      cache = { at: Date.now(), project: scanAnalog(ctx.cwd) };
    }
    return cache.project;
  };

  my.rpc.register({
    name: 'push-analog',
    type: 'action',
    jsonSerializable: true,
    handler: (report: unknown) => {
      if (!isAnalogReport(report)) return;
      seenAt.set(report.pageId, Date.now());
      apply(mergeAnalogReport(current(), resolveAnalogReport(project(), report)));
    },
  });
  my.rpc.register({
    name: 'forget-analog-page',
    type: 'action',
    jsonSerializable: true,
    handler: (pageId: unknown) => {
      if (typeof pageId === 'string') dropPages([pageId]);
    },
  });
  my.rpc.register({
    name: 'analog-clear-calls',
    type: 'action',
    jsonSerializable: true,
    handler: () => clearCalls(),
  });
  my.rpc.register({
    name: 'analog-project',
    type: 'query',
    jsonSerializable: true,
    handler: () => project(),
  });
  my.rpc.register({
    name: 'analog-explain-url',
    type: 'query',
    jsonSerializable: true,
    handler: (url: unknown) =>
      typeof url === 'string' ? explainUrl(project().routes, url.slice(0, 2000)) : null,
  });
  my.rpc.register({
    name: 'analog-lint',
    type: 'query',
    jsonSerializable: true,
    handler: () => analogLint(project(), current()),
  });
  my.rpc.register({
    name: 'analog-render',
    type: 'query',
    jsonSerializable: true,
    handler: () => ({ rows: renderRows(project(), current()), plan: prerenderPlan(project()) }),
  });
  my.rpc.register({
    name: 'analog-text',
    type: 'query',
    jsonSerializable: true,
    handler: (kind: unknown) => {
      const p = project();
      if (kind === 'render') return analogRenderModesText(p, current());
      if (kind === 'prerender') return analogPrerenderText(p);
      if (kind === 'page') return analogCurrentPageText(p, current());
      return '';
    },
  });
  my.rpc.register({
    name: 'analog-call-api',
    type: 'action',
    jsonSerializable: true,
    handler: (request: unknown) =>
      request && typeof request === 'object'
        ? callApi(request as ApiRequest)
        : { ok: false, error: 'Bad request.' },
  });

  const page = { type: 'string', description: 'Page id when several tabs are connected.' };
  const text = (markdown: string) => ({ markdown });

  ctx.agent.registerTool({
    id: 'ng-devtools:analog-routes',
    description:
      'List the Analog file-based routes in match order: URL pattern, page or layout file, route groups, [param] and catch-all segments, sibling .server.ts (load/action), routeMeta keys and titles. Pass `filter` to narrow by path or file.',
    safety: 'read',
    inputSchema: { type: 'object', properties: { filter: { type: 'string' } } },
    handler: async (args: { filter?: string }) => text(analogRoutesText(project(), args?.filter)),
  });
  ctx.agent.registerTool({
    id: 'ng-devtools:analog-explain-url',
    description:
      'Explain which Analog files render a URL (layout chain, page, .server.ts load and its endpoint), the params, or why nothing matches with the closest candidates.',
    safety: 'read',
    inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
    handler: async (args: { url?: string }) =>
      text(
        typeof args?.url === 'string'
          ? analogExplainUrlText(project(), args.url, current())
          : 'Pass a url.',
      ),
  });
  ctx.agent.registerTool({
    id: 'ng-devtools:analog-current-page',
    description:
      'The Analog page open in the browser: its files (layouts first), load() data it received, server rendering and hydration state, hydration errors, and page files the running router does not know yet (restart needed).',
    safety: 'read',
    inputSchema: { type: 'object', properties: { page } },
    handler: async (args: { page?: string }) =>
      text(analogCurrentPageText(project(), current(), args?.page)),
  });
  ctx.agent.registerTool({
    id: 'ng-devtools:analog-server-calls',
    description:
      'Recent server calls seen by the dev server: page renders (with render mode), load() fetches (/_analog/pages), server functions and API routes, with status, time, size, who called (ssr or browser) and a redacted response preview. Flags load() fetched twice.',
    safety: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['page', 'load', 'fn', 'api'] },
        route: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    handler: async (args: { kind?: string; route?: string; limit?: number }) =>
      text(analogServerCallsText(current(), args ?? {})),
  });
  ctx.agent.registerTool({
    id: 'ng-devtools:analog-api-routes',
    description:
      'List Analog/Nitro server routes under src/server/routes with method, URL and file, plus server middleware.',
    safety: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => text(analogApiRoutesText(project())),
  });
  ctx.agent.registerTool({
    id: 'ng-devtools:analog-call-api',
    description:
      'Send a request to a route on the running dev server (for example GET /api/v1/hello) and return status, time and body. Methods other than GET, HEAD and OPTIONS need confirm: true.',
    safety: 'action',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
        },
        body: { description: 'JSON body.' },
        confirm: { type: 'boolean' },
      },
    },
    handler: async (args: ApiRequest) => {
      const result = await callApi(args ?? { path: '' });
      if (result['error']) return text(`Refused: ${result['error']}`);
      return text(
        `${args.method ?? 'GET'} ${args.path}: ${result['status']} in ${result['ms']}ms (${result['type'] || 'no content type'})\n\n${result['body']}`,
      );
    },
  });
  ctx.agent.registerTool({
    id: 'ng-devtools:analog-render-modes',
    description:
      'For each Analog page: how it is rendered (server rendered per request, prerendered, or client only from routeRules ssr: false), and what the last request actually did.',
    safety: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => text(analogRenderModesText(project(), current())),
  });
  ctx.agent.registerTool({
    id: 'ng-devtools:analog-prerender-plan',
    description:
      'Compare prerender.routes with the page files and the build output: static pages left out, dynamic pages that need explicit entries, and listed routes missing from dist.',
    safety: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => text(analogPrerenderText(project())),
  });
  ctx.agent.registerTool({
    id: 'ng-devtools:analog-content',
    description:
      'List markdown content files with slug, frontmatter, the route that serves them and parse errors. Pass `filter` to narrow.',
    safety: 'read',
    inputSchema: { type: 'object', properties: { filter: { type: 'string' } } },
    handler: async (args: { filter?: string }) => text(analogContentText(project(), args?.filter)),
  });
  ctx.agent.registerTool({
    id: 'ng-devtools:analog-lint',
    description:
      'Analog checks: two files for one URL, sibling [param] files, missing default export, layout without router-outlet, .server.ts without load or without a page, redirect mistakes, bad API method suffix, duplicate API routes, routes outside the API prefix, prerender entries that match nothing, frontmatter errors, duplicate slugs, plus live problems (load fetched twice, hydration errors, restart needed, API 404/405).',
    safety: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => text(analogLintText(project(), current())),
  });
}
