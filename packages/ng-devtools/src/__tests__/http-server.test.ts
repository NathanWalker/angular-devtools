import { createHostContext } from 'devframe/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NgDevtoolsConfig } from '../config.ts';
import ngDevtools, { createNgDevtools } from '../devframe.ts';
import { httpRegistry, type HttpRule } from '../http-rules.ts';
import type { HttpState } from '../types.ts';

async function boot(config?: NgDevtoolsConfig) {
  const host = {
    mountStatic: () => {},
    resolveOrigin: () => 'http://localhost',
    getStorageDir: () => '',
  };
  const ctx = await createHostContext({ cwd: process.cwd(), mode: 'dev', host: host as never });
  await (config ? createNgDevtools(config) : ngDevtools).setup(ctx as never);
  const push = (name: string, payload: unknown) =>
    ctx.rpc.invokeLocal(
      `ng-devtools:${name}` as never,
      ...([payload] as never),
    ) as Promise<unknown>;
  const state = async () =>
    (
      await (
        ctx.rpc as unknown as {
          sharedState: { get: (key: string) => Promise<{ value: () => HttpState }> };
        }
      ).sharedState.get('ng-devtools:http')
    ).value();
  return { push, state };
}

const report = (pageId: string, extra: Record<string, unknown> = {}) => ({
  pageId,
  url: `/${pageId}`,
  initialUrl: `/${pageId}`,
  title: pageId,
  hydration: { enabled: true, warnings: [], skipHydrationHosts: [] },
  calls: [],
  ...extra,
});

describe('push-http', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps pages in first-seen order and keeps the payload between pushes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { push, state } = await boot();
    vi.setSystemTime(1000);
    expect(
      await push('push-http', report('a', { payload: { found: true, size: 2, entries: [] } })),
    ).toEqual({ needPayload: false });
    vi.setSystemTime(2000);
    await push('push-http', report('b', { payload: { found: false, size: 0, entries: [] } }));
    vi.setSystemTime(3000);
    expect(await push('push-http', report('a', { url: '/a/next' }))).toEqual({
      needPayload: false,
    });
    vi.setSystemTime(4000);
    await push('push-http', report('b'));
    const pages = (await state()).pages;
    expect(pages.map((p) => p.pageId)).toEqual(['a', 'b']);
    expect(pages[0]).toMatchObject({
      url: '/a/next',
      initialUrl: '/a',
      firstSeenAt: 1000,
      reportedAt: 3000,
      payload: { found: true, size: 2 },
    });
    expect(pages[1]).toMatchObject({ firstSeenAt: 2000, reportedAt: 4000 });
  });

  it('asks for the payload of an unknown page without listing it as not server rendered', async () => {
    const { push, state } = await boot();
    expect(await push('push-http', report('c'))).toEqual({ needPayload: true });
    expect((await state()).pages).toEqual([]);
    expect(
      await push('push-http', report('c', { payload: { found: true, size: 1, entries: [] } })),
    ).toEqual({ needPayload: false });
    expect((await state()).pages).toMatchObject([{ pageId: 'c', payload: { found: true } }]);
  });
});

describe('http rules across restarts', () => {
  const rule: HttpRule = {
    id: 'r1',
    pattern: '/api',
    enabled: true,
    target: 'server',
    status: 503,
  };

  afterEach(() => {
    httpRegistry().dispose?.();
    delete httpRegistry().rules;
  });

  it('shows the rules that still apply after a restart', async () => {
    httpRegistry().rules = [rule];
    const { state } = await boot();
    expect(httpRegistry().rules).toEqual([rule]);
    expect((await state()).rules).toEqual([rule]);
  });

  it('clears the rules when http actions are turned off', async () => {
    httpRegistry().rules = [rule];
    const { push, state } = await boot({ actions: { http: false } });
    expect(httpRegistry().rules).toEqual([]);
    expect((await state()).rules).toEqual([]);
    expect(await push('get-http-rules', undefined)).toEqual([]);
  });

  it('clears the rules when the http inspector is turned off', async () => {
    httpRegistry().rules = [rule];
    const { state } = await boot({ inspectors: { http: false } });
    expect(httpRegistry().rules).toEqual([]);
    expect((await state()).rules).toEqual([]);
  });
});
