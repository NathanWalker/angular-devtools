// @vitest-environment jsdom
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationRef, Injector, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import {
  HttpHeaders,
  HttpRequest,
  HttpResponse,
  type HttpEvent,
  type HttpHandlerFn,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { ngDevtoolsHttpInterceptor, parseBody, resetTransferEntries } from '../http.ts';
import { appIdOf, isHydrationMessage, scanHydration } from '../http-hydration.ts';
import { attachHttp } from '../http-overlay.ts';
import {
  MAX_DELAY_MS,
  MAX_RULES,
  RULES_STORAGE_KEY,
  clientRules,
  httpRegistry,
  MAX_CALLS,
  matchRule,
  sanitizeCalls,
  sanitizeRules,
  storeRules,
  type HttpRule,
} from '../http-rules.ts';
import { decodePayload, sanitizeHydration, sanitizePayload } from '../http-payload.ts';

const rule = (overrides: Partial<HttpRule> = {}): HttpRule => ({
  id: 'r1',
  pattern: '/api/products',
  enabled: true,
  target: 'both',
  status: 500,
  ...overrides,
});

describe('matchRule', () => {
  it('matches by substring on relative and absolute URLs', () => {
    const rules = [rule()];
    expect(matchRule('/api/products?x=1', 'GET', rules, 'client')?.id).toBe('r1');
    expect(matchRule('http://localhost:4000/api/products', 'GET', rules, 'server')?.id).toBe('r1');
    expect(matchRule('/api/users', 'GET', rules, 'client')).toBeUndefined();
  });

  it('supports * globs', () => {
    const rules = [rule({ pattern: '/api/*/42' })];
    expect(matchRule('/api/products/42', 'GET', rules, 'client')).toBeDefined();
    expect(matchRule('http://host/api/orders/42', 'GET', rules, 'server')).toBeDefined();
    expect(matchRule('/api/products/7', 'GET', rules, 'client')).toBeUndefined();
  });

  it('filters by method, side and enabled flag', () => {
    expect(matchRule('/api/products', 'post', [rule({ method: 'POST' })], 'client')).toBeDefined();
    expect(matchRule('/api/products', 'GET', [rule({ method: 'POST' })], 'client')).toBeUndefined();
    expect(
      matchRule('/api/products', 'GET', [rule({ target: 'server' })], 'client'),
    ).toBeUndefined();
    expect(matchRule('/api/products', 'GET', [rule({ target: 'server' })], 'server')).toBeDefined();
    expect(matchRule('/api/products', 'GET', [rule({ enabled: false })], 'client')).toBeUndefined();
    expect(matchRule('/api/products', 'GET', undefined, 'client')).toBeUndefined();
  });

  it('returns the first matching rule', () => {
    const rules = [rule({ id: 'a', enabled: false }), rule({ id: 'b' }), rule({ id: 'c' })];
    expect(matchRule('/api/products', 'GET', rules, 'client')?.id).toBe('b');
  });
});

describe('sanitizeRules', () => {
  it('drops malformed input', () => {
    expect(sanitizeRules(null)).toEqual([]);
    expect(sanitizeRules('x')).toEqual([]);
    expect(sanitizeRules([null, 1, {}, { pattern: '   ' }])).toEqual([]);
  });

  it('normalises fields', () => {
    const [r] = sanitizeRules([
      {
        pattern: ' /api ',
        method: 'get',
        target: 'weird',
        status: 42,
        delayMs: 999_999,
        body: '{}',
      },
    ]);
    expect(r).toMatchObject({
      id: 'r1',
      pattern: '/api',
      method: 'GET',
      target: 'both',
      enabled: true,
      body: '{}',
    });
    expect(r.status).toBeUndefined();
    expect(r.delayMs).toBe(MAX_DELAY_MS);
  });

  it('rejects bad methods and caps the rule count', () => {
    expect(sanitizeRules([{ pattern: '/a', method: 'G T' }])[0].method).toBeUndefined();
    const many = Array.from({ length: MAX_RULES + 10 }, (_, i) => ({ pattern: `/p${i}` }));
    expect(sanitizeRules(many)).toHaveLength(MAX_RULES);
  });
});

describe('push-http report sanitizers', () => {
  it('drops malformed calls and caps the count', () => {
    const ok = { id: 'c1', url: '/a', method: 'GET', status: 200 };
    expect(sanitizeCalls([null, {}, { id: 'x' }, ok])).toEqual([
      expect.objectContaining({ ...ok, side: 'client', cacheHit: false, durationMs: 0 }),
    ]);
    expect(sanitizeCalls('x')).toEqual([]);
    const many = Array.from({ length: MAX_CALLS + 5 }, (_, i) => ({ ...ok, id: `c${i}` }));
    expect(sanitizeCalls(many)).toHaveLength(MAX_CALLS);
  });

  it('falls back for malformed payloads and hydration stats', () => {
    expect(sanitizePayload(null)).toEqual({ found: false, size: 0, entries: [] });
    expect(sanitizePayload({ found: true, entries: [1, { key: 'k', value: 2 }] }).entries).toEqual([
      { key: 'k', size: 0, value: 2 },
    ]);
    expect(sanitizeHydration({})).toBeNull();
    expect(sanitizeHydration({ enabled: true, warnings: ['w', 3] })).toMatchObject({
      enabled: true,
      skipHydrationHosts: [],
      warnings: ['w'],
    });
  });
});

describe('client rule storage', () => {
  afterEach(() => {
    sessionStorage.clear();
    delete httpRegistry().rules;
  });

  it('persists rules and reads them back after a reload', () => {
    storeRules([rule()]);
    expect(JSON.parse(sessionStorage.getItem(RULES_STORAGE_KEY) ?? '[]')).toHaveLength(1);
    delete httpRegistry().rules;
    expect(clientRules()[0].pattern).toBe('/api/products');
  });

  it('removes storage when rules are cleared and survives bad JSON', () => {
    storeRules([rule()]);
    storeRules([]);
    expect(sessionStorage.getItem(RULES_STORAGE_KEY)).toBeNull();
    delete httpRegistry().rules;
    sessionStorage.setItem(RULES_STORAGE_KEY, '{nope');
    expect(clientRules()).toEqual([]);
  });
});

describe('decodePayload', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const addState = (text: string, id = 'ng-state') => {
    const script = document.createElement('script');
    script.id = id;
    script.type = 'application/json';
    script.textContent = text;
    document.body.append(script);
  };

  it('reports a missing payload', () => {
    expect(decodePayload(document)).toEqual({ found: false, size: 0, entries: [] });
  });

  it('decodes HTTP transfer-cache entries and plain keys', () => {
    addState(
      JSON.stringify({
        '123': { b: [{ id: 1 }], s: 200, st: 'OK', u: '/api/products', rt: 'json' },
        theme: 'dark',
      }),
    );
    const summary = decodePayload(document);
    expect(summary.found).toBe(true);
    expect(summary.entries).toHaveLength(2);
    const http = summary.entries.find((e) => e.key === '123');
    expect(http?.http).toEqual({
      url: '/api/products',
      status: 200,
      statusText: 'OK',
      responseType: 'json',
    });
    expect(http?.value).toEqual([{ id: 1 }]);
    expect(summary.entries.find((e) => e.key === 'theme')?.value).toBe('dark');
  });

  it('uses a custom app id and reports parse errors', () => {
    addState('{bad', 'shop-state');
    const summary = decodePayload(document, 'shop');
    expect(summary.found).toBe(true);
    expect(summary.error).toBeTruthy();
  });
});

describe('TransferState payload labels', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('decodes Analog entries and labels hydration annotations', () => {
    const script = document.createElement('script');
    script.id = 'ng-state';
    script.type = 'application/json';
    script.textContent = JSON.stringify({
      analog_123: { body: { ok: true }, status: 200, statusText: 'OK', url: '/api/x', headers: {} },
      __nghData__: [{ c: 1 }],
      __nghDeferData__: {},
      '9': { b: 'hi', s: 200, u: '/api/y' },
    });
    document.body.append(script);
    const entries = decodePayload(document).entries;
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    expect(byKey['analog_123']).toMatchObject({
      source: 'analog',
      http: { url: '/api/x', status: 200, statusText: 'OK' },
      value: { ok: true },
    });
    expect(byKey['__nghData__'].source).toBe('hydration');
    expect(byKey['__nghDeferData__'].source).toBe('hydration');
    expect(byKey['9'].source).toBe('http');
    expect(sanitizePayload({ found: true, entries }).entries.map((e) => e.source)).toEqual([
      'http',
      'analog',
      'hydration',
      'hydration',
    ]);
  });
});

describe('hydration helpers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('matches only hydration error codes', () => {
    expect(isHydrationMessage('NG0500: During hydration Angular expected')).toBe(true);
    expect(isHydrationMessage('NG0507: HTML was modified')).toBe(true);
    expect(isHydrationMessage('NG05104: The selector did not match')).toBe(false);
    expect(isHydrationMessage('NG0200: circular dependency')).toBe(false);
  });

  it('reads the app id and counts node statuses with mismatch details', () => {
    document.body.innerHTML =
      '<app-shop><p>a</p><app-card></app-card></app-shop><script id="shop-state" type="application/json">{}</script>';
    const patch = (selector: string, info: unknown) =>
      ((document.querySelector(selector) as unknown as Record<string, unknown>)[
        '__ngDebugHydrationInfo__'
      ] = info);
    patch('app-shop', { status: 'hydrated' });
    patch('p', { status: 'skipped' });
    patch('app-card', {
      status: 'mismatched',
      expectedNodeDetails: '<div>',
      actualNodeDetails: '<span>',
    });
    expect(appIdOf(document)).toBe('shop');
    expect(scanHydration(document)).toEqual({
      hydrated: 1,
      skipped: 1,
      mismatched: 1,
      mismatches: [{ component: 'app-card', expected: '<div>', actual: '<span>' }],
    });
  });

  it('sanitizes the new hydration fields', () => {
    expect(
      sanitizeHydration({
        enabled: true,
        nodes: { hydrated: 3, skipped: 'x' },
        mismatches: [{ component: 'app-card', expected: '<div>' }, { expected: 'x' }],
        warningsCaptured: true,
      }),
    ).toMatchObject({
      nodes: { hydrated: 3, skipped: 0, mismatched: 0 },
      mismatches: [{ component: 'app-card', expected: '<div>' }],
      warningsCaptured: true,
    });
    expect(sanitizeHydration({ enabled: false })?.warningsCaptured).toBe(false);
  });
});

describe('interceptor', () => {
  const g = globalThis as { ngDevMode?: unknown };
  let saved: unknown;
  beforeEach(() => {
    saved = g.ngDevMode;
    g.ngDevMode ??= true;
    httpRegistry().calls = [];
    httpRegistry().rules = [];
    resetTransferEntries();
  });
  afterEach(() => {
    g.ngDevMode = saved;
    vi.useRealTimers();
    document.body.innerHTML = '';
    delete httpRegistry().rules;
    sessionStorage.clear();
  });

  const injector = Injector.create({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }] });
  const run = (req: HttpRequest<unknown>, next: HttpHandlerFn) =>
    runInInjectionContext(injector, () => ngDevtoolsHttpInterceptor(req, next));
  const later =
    (body: unknown): HttpHandlerFn =>
    () =>
      new Observable<HttpEvent<unknown>>((subscriber) => {
        const t = setTimeout(() => {
          subscriber.next(new HttpResponse({ status: 200, body }));
          subscriber.complete();
        }, 5);
        return () => clearTimeout(t);
      });

  it('keeps text mock bodies as text and parses JSON ones', () => {
    expect(parseBody('{"a":1}', 'text')).toBe('{"a":1}');
    expect(parseBody(undefined, 'text')).toBe('');
    expect(parseBody('{"a":1}')).toEqual({ a: 1 });
  });

  it('records a request cancelled during a delay rule', () => {
    vi.useFakeTimers();
    storeRules([rule({ status: undefined, delayMs: 1000 })]);
    const sub = run(new HttpRequest('GET', '/api/products'), later([])).subscribe();
    vi.advanceTimersByTime(100);
    sub.unsubscribe();
    expect(httpRegistry().calls).toEqual([
      expect.objectContaining({ error: 'cancelled during the delay', status: 0, faulted: true }),
    ]);
  });

  it('counts a TransferState match as a cache hit once', async () => {
    document.body.innerHTML =
      '<script id="ng-state" type="application/json">{"1":{"b":[],"s":200,"u":"/api/products"}}</script>';
    const get = () =>
      new Promise<void>((resolve) =>
        run(new HttpRequest('GET', '/api/products'), later([])).subscribe({
          complete: resolve,
        }),
      );
    await get();
    await get();
    expect(httpRegistry().calls?.map((c) => c.cacheHit)).toEqual([true, false]);
  });

  it('does not tag a payload URL as a cache hit when Angular would skip the cache', async () => {
    document.body.innerHTML =
      '<script id="ng-state" type="application/json">{"1":{"b":[],"s":200,"u":"/api/trips"}}</script>';
    const get = (req: HttpRequest<unknown>, via = run) =>
      new Promise<void>((resolve) => via(req, later([])).subscribe({ complete: resolve }));
    await get(
      new HttpRequest('GET', '/api/trips', null, {
        headers: new HttpHeaders({ Authorization: 'Bearer x' }),
      }),
    );
    await get(new HttpRequest('GET', '/api/trips', null, { transferCache: false }));
    await get(new HttpRequest('GET', '/api/trips', null, { withCredentials: true }));
    expect(httpRegistry().calls?.map((c) => c.cacheHit)).toEqual([false, false, false]);

    const stable = Injector.create({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ApplicationRef, useValue: { whenStable: () => Promise.resolve() } },
      ],
    });
    const runStable = (req: HttpRequest<unknown>, next: HttpHandlerFn) =>
      runInInjectionContext(stable, () => ngDevtoolsHttpInterceptor(req, next));
    runStable(new HttpRequest('GET', '/other'), later([])).subscribe().unsubscribe();
    await Promise.resolve();
    await get(new HttpRequest('GET', '/api/trips'), runStable);
    expect(httpRegistry().calls?.at(-1)?.cacheHit).toBe(false);
    await get(new HttpRequest('GET', '/api/trips'));
    expect(httpRegistry().calls?.at(-1)?.cacheHit).toBe(true);
  });
});

describe('attachHttp', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sends the payload once, then again only when the server asks for it', async () => {
    const sent: Record<string, unknown>[] = [];
    let answer: unknown = { needPayload: false };
    const my = {
      rpc: {
        call: async (name: string, report?: unknown) => {
          if (name === 'push-http') sent.push(report as Record<string, unknown>);
          if (name === 'get-http-rules') return [];
          return name === 'push-http' ? answer : undefined;
        },
        register: () => {},
      },
    };
    const http = attachHttp(my, 'p1');
    await http.push();
    httpRegistry().calls = [
      {
        id: 'c',
        url: '/a',
        method: 'GET',
        status: 200,
        durationMs: 1,
        side: 'client',
        cacheHit: false,
        faulted: false,
        at: 1,
      },
    ];
    answer = { needPayload: true };
    await http.push();
    answer = { needPayload: false };
    await http.push();
    expect(sent.map((r) => 'payload' in r)).toEqual([true, false, true]);
    expect(sent[0]).toMatchObject({ pageId: 'p1', initialUrl: '/' });
    expect(sent[0]['hydration']).toMatchObject({ warningsCaptured: false, mismatches: [] });
    httpRegistry().calls = [];
  });
});

describe('hydration scanner', () => {
  it('reuses the DOM scan until the hydration counters change', async () => {
    const { createHydrationScanner } = await import('../http-overlay.ts');
    let calls = 0;
    const scanner = createHydrationScanner(() => {
      calls++;
      return { hydrated: 3, skipped: 0, mismatched: 0, mismatches: [] };
    });
    const counters = { hydratedNodes: 3 };
    for (let i = 0; i < 10; i++) scanner(counters);
    expect(calls).toBe(3);
    scanner({ hydratedNodes: 5 });
    expect(calls).toBe(4);
  });
});
