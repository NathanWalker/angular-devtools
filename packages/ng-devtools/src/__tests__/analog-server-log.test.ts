import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analogMiddleware,
  classify,
  clearCalls,
  duplicateLoads,
  isSecretKey,
  previewOf,
  recentCalls,
  redactMessage,
  type AnalogCall,
} from '../analog-server-log.ts';
import ngDevtoolsVite from '../vite.ts';

class FakeRes extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = '';
  getHeader(name: string) {
    return this.headers[name.toLowerCase()];
  }
  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  write(chunk: unknown) {
    this.body += String(chunk);
    return true;
  }
  end(chunk?: unknown) {
    if (chunk !== undefined) this.body += String(chunk);
    this.emit('finish');
    return this;
  }
}

function run(
  url: string,
  respond: (res: FakeRes) => void,
  headers: Record<string, string> = {},
  method = 'GET',
) {
  const req = { url: '/index.html', originalUrl: url, method, headers } as never;
  const res = new FakeRes();
  let nexted = false;
  analogMiddleware('api')(req, res as never, () => {
    nexted = true;
  });
  respond(res);
  return { nexted, call: recentCalls().at(-1) };
}

afterEach(() => clearCalls());

describe('Analog server call log', () => {
  it('classifies load, server function, API and page requests', () => {
    expect(classify('/api/_analog/pages/products/1', 'GET', '', 'api')).toEqual({
      kind: 'load',
      route: '/products/1',
    });
    expect(classify('/_analog/pages/', 'GET', '', 'api')).toEqual({ kind: 'load', route: '/' });
    expect(classify('/api/_analog/pages/index', 'GET', '', 'api')).toEqual({
      kind: 'load',
      route: '/',
    });
    expect(classify('/api/_analog/pages/products/index', 'GET', '', 'api')).toEqual({
      kind: 'load',
      route: '/products',
    });
    expect(classify('/api/_analog/fn/abc', 'POST', '', 'api')).toEqual({
      kind: 'fn',
      route: 'abc',
    });
    expect(classify('/api/v1/hello?x=1', 'GET', '', 'api')).toEqual({
      kind: 'api',
      route: '/api/v1/hello',
    });
    expect(classify('/products/1', 'GET', 'text/html,*/*', 'api')).toEqual({
      kind: 'page',
      route: '/products/1',
    });
    expect(classify('/main.js', 'GET', 'text/html', 'api')).toBeNull();
    expect(classify('/@vite/client', 'GET', 'text/html', 'api')).toBeNull();
    expect(classify('/__ng-devtools/', 'GET', 'text/html', 'api')).toBeNull();
  });

  it('records a load call with a redacted preview and who called it', () => {
    const { nexted, call } = run(
      '/api/_analog/pages/account',
      (res) => {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({ name: 'Ada', password: 'hunter2', apiKey: 'k', note: 'Bearer abc.def' }),
        );
      },
      { 'user-agent': 'node' },
    );
    expect(nexted).toBe(true);
    expect(call).toMatchObject({ kind: 'load', route: '/account', status: 200, from: 'ssr' });
    expect(call!.preview).toContain('"name":"Ada"');
    expect(call!.preview).not.toMatch(/hunter2|"k"|abc\.def/);
  });

  it('uses the original URL and detects server rendered versus client only pages', () => {
    const ssr = run('/products/1', (res) => res.end('<app-root ng-server-context="ssr-analog">'), {
      accept: 'text/html',
      'user-agent': 'Mozilla',
    });
    expect(ssr.call).toMatchObject({
      kind: 'page',
      url: '/products/1',
      render: 'ssr',
      from: 'browser',
    });
    expect(ssr.call!.preview).toBeUndefined();
    const client = run('/dashboard', (res) => res.end('<app-root></app-root>'), {
      accept: 'text/html',
      'user-agent': 'Mozilla',
    });
    expect(client.call!.render).toBe('client');
    const devtools = run('/api/v1/hello', (res) => res.end('{}'), { 'x-ng-devtools': '1' });
    expect(devtools.call!.from).toBe('devtools');
  });

  it('passes unrelated requests straight through', () => {
    const { nexted, call } = run('/src/main.ts', (res) => res.end('code'));
    expect(nexted).toBe(true);
    expect(call).toBeUndefined();
  });

  it('finds loads fetched on the server and again in the browser', () => {
    const base = { method: 'GET', url: '', status: 200, ms: 1, kind: 'load' as const };
    const list: AnalogCall[] = [
      { ...base, id: 1, at: 1000, route: '/a', from: 'ssr' },
      { ...base, id: 2, at: 1500, route: '/a', from: 'browser' },
      { ...base, id: 3, at: 2000, route: '/b', from: 'ssr' },
      { ...base, id: 4, at: 60_000, route: '/b', from: 'browser' },
      { ...base, id: 5, at: 61_000, route: '/c', from: 'devtools' },
    ];
    expect(duplicateLoads(list)).toEqual([{ route: '/a', ssrAt: 1000, browserAt: 1500 }]);
  });

  it('redacts secrets in text and keys', () => {
    expect(isSecretKey('sessionToken')).toBe(true);
    expect(isSecretKey('passenger')).toBe(false);
    expect(redactMessage('/cb?token=abc&x=1')).toBe('/cb?token=[redacted]&x=1');
    expect(previewOf('<html>', 'text/html')).toBeUndefined();
    expect(previewOf('x'.repeat(2000), 'text/plain')!.length).toBeLessThan(1100);
  });
});

describe('Vite plugin', () => {
  it('runs in dev before Analog and mounts the log before the devtools server', () => {
    const plugin = ngDevtoolsVite();
    expect(plugin).toMatchObject({ name: 'ng-devtools', apply: 'serve', enforce: 'pre' });
    const used: unknown[] = [];
    let onListening: (() => void) | undefined;
    const server = {
      config: { root: process.cwd() },
      middlewares: { use: (fn: unknown) => used.push(fn) },
      httpServer: { once: (_event: string, fn: () => void) => (onListening = fn) },
      resolvedUrls: { local: ['http://localhost:5174/'] },
    };
    (plugin.configureServer as (server: unknown) => void)(server);
    expect(used).toHaveLength(3);
    const probe = used[0] as (req: unknown, res: unknown, next: () => void) => void;
    const res = new FakeRes();
    let passed = false;
    probe({ url: '/products/__connection.json' }, res, () => (passed = true));
    expect([res.statusCode, passed]).toEqual([404, false]);
    const local = { remoteAddress: '::ffff:127.0.0.1' };
    probe(
      { url: '/__ng-devtools/__connection.json', socket: local },
      new FakeRes(),
      () => (passed = true),
    );
    expect(passed).toBe(true);
    const remote = new FakeRes();
    passed = false;
    probe(
      { url: '/__ng-devtools/__sse', socket: { remoteAddress: '192.168.1.20' } },
      remote,
      () => (passed = true),
    );
    expect([remote.statusCode, passed]).toEqual([403, false]);
    expect(onListening).toBeTypeOf('function');
  });
});
