import { createHostContext } from 'devframe/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ngDevtools from '../devframe.ts';

async function boot() {
  const host = {
    mountStatic: () => {},
    resolveOrigin: () => 'http://localhost',
    getStorageDir: () => '',
  };
  const ctx = await createHostContext({ cwd: process.cwd(), mode: 'dev', host: host as never });
  await ngDevtools.setup(ctx as never);
  const push = (name: string, payload: unknown) =>
    ctx.rpc.invokeLocal(`ng-devtools:${name}` as never, ...([payload] as never));
  const call = async (tool: string, selector: string, extra: Record<string, unknown> = {}) =>
    (
      (await ctx.agent.invoke(`ng-devtools:${tool}`, { selector, ...extra })) as {
        markdown: string;
      }
    ).markdown;
  const injectorState = async () =>
    (
      await (
        ctx.rpc as unknown as {
          sharedState: {
            get: (key: string) => Promise<{ value: () => Record<string, unknown> }>;
          };
        }
      ).sharedState.get('ng-devtools:injector-tree')
    ).value();
  return { push, call, injectorState };
}

const injectorRoot = (name: string) => ({
  injector: { id: 'inj-1', type: 'element', name, providerCount: 0 },
  providers: [],
  children: [],
});

const elementInjectors = (markdown: string) =>
  JSON.parse(markdown.split(/Element injectors:|Environment injectors:/)[1]!);

describe('agent tools', () => {
  afterEach(() => vi.useRealTimers());

  it('say so when nothing has been reported', async () => {
    const { call } = await boot();
    // Worded after the data, not the connection: an empty tree is what both a
    // page that never connected and a page with no readable components send.
    expect(await call('highlight', 'app-root')).toMatch(/no component tree has been reported/i);
    expect(await call('inspect-signals', 'app-root')).toMatch(/no signal graph/i);
    expect(await call('inspect-providers', 'app-root')).toMatch(/no injector data/i);
  });

  it('answer from the data the page pushed', async () => {
    const { push, call } = await boot();
    await push('push-component-tree', {
      pageId: 'p1',
      roots: [{ id: 'c1', name: 'App', tag: 'app-root', children: [] }],
      count: 1,
      detail: null,
    });
    await push('push-signal-graph', {
      nodes: [{ id: 'a', kind: 'signal', label: 'count' }],
      edges: [],
      componentSelector: 'app-root',
    });
    await push('push-injector-tree', {
      pageId: 'p1',
      roots: [
        {
          injector: { id: 'i1', type: 'element', name: 'App', providerCount: 0 },
          providers: [],
          children: [],
        },
      ],
      environment: [],
    });

    expect(await call('highlight', 'app-root')).toMatch(/highlight request/i);

    // The payload matters, not how it is worded around.
    const signals = await call('inspect-signals', 'app-root');
    expect(JSON.parse(signals)).toMatchObject({ nodes: [{ label: 'count' }] });

    const other = await call('inspect-signals', 'app-other');
    expect(other).toMatch(/app-other/);
    expect(other).toMatch(/app-root/);

    // The answer carries the whole injector tree, whatever it is worded like.
    const providers = await call('inspect-providers', 'app-root');
    const [elements, environment] = providers
      .split(/Element injectors:|Environment injectors:/)
      .slice(1)
      .map((part) => JSON.parse(part));
    expect(elements).toMatchObject([{ injector: { name: 'App' } }]);
    expect(environment).toEqual([]);
  });

  it('keeps component trees per page and resolves a class name to one instance', async () => {
    const { push, call } = await boot();
    const card = (id: string) => ({ id, name: 'Card', tag: 'app-card', children: [] });
    await push('push-component-tree', {
      pageId: 'p1',
      roots: [{ id: 'c1', name: 'App', tag: 'app-root', children: [card('c2'), card('c3')] }],
      count: 3,
      detail: null,
    });
    await push('push-component-tree', { pageId: 'bad' });
    expect(await call('highlight', 'Card')).toMatch(/instance `c2` on page `p1`/);
    expect(await call('highlight', 'c3')).toMatch(/instance `c3`/);
    expect(await call('highlight', '.promo')).toMatch(/only shows if the selector matches/);
    await push('forget-component-page', 'p1');
    expect(await call('highlight', 'Card')).toMatch(/no component tree has been reported/i);
  });

  it('matches inspect-signals on the class name of the graph component', async () => {
    const { push, call } = await boot();
    await push('push-signal-graph', {
      pageId: 'p1',
      nodes: [{ id: 'a', kind: 'signal', label: 'count', epoch: 0 }],
      edges: [],
      componentSelector: 'app-card',
      component: { id: 'c2', name: 'Card', tag: 'app-card', path: 'app-root > app-card' },
    });
    expect(JSON.parse(await call('inspect-signals', 'Card'))).toMatchObject({
      component: { name: 'Card' },
    });
  });

  it('prefers a per-page signal graph that matches the selector over the last pushed graph', async () => {
    const { push, call } = await boot();
    await push('push-signal-graph', {
      pageId: 'p1',
      nodes: [{ id: 'a', kind: 'signal', label: 'open', epoch: 0 }],
      edges: [],
      componentSelector: 'app-card',
      component: { id: 'c2', name: 'Card', tag: 'app-card', path: 'app-root > app-card' },
    });
    await push('push-signal-graph', {
      pageId: 'p2',
      nodes: [{ id: 'b', kind: 'signal', label: 'count', epoch: 0 }],
      edges: [],
      componentSelector: 'app-x',
      component: { id: 'c9', name: 'X', tag: 'app-x', path: 'app-root > app-x' },
    });
    expect(JSON.parse(await call('inspect-signals', 'Card'))).toMatchObject({
      pageId: 'p1',
      nodes: [{ label: 'open' }],
    });
    expect(JSON.parse(await call('inspect-signals', 'c9'))).toMatchObject({ pageId: 'p2' });
    const missing = await call('inspect-signals', 'app-none');
    expect(missing).toMatch(/No signal graph for `app-none`/);
    expect(missing).toMatch(/app-x/);
  });

  it('keeps injector trees per page, forgets a page on request and ignores reports without a page', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { push, call, injectorState } = await boot();
    vi.setSystemTime(1000);
    await push('push-injector-tree', { pageId: 'p1', roots: [injectorRoot('A')], environment: [] });
    vi.setSystemTime(2000);
    await push('push-injector-tree', { pageId: 'p2', roots: [injectorRoot('B')], environment: [] });
    await push('push-injector-tree', { roots: [injectorRoot('C')], environment: [] });

    expect(Object.keys((await injectorState())['pages'] as object).sort()).toEqual(['p1', 'p2']);
    expect(await injectorState()).toMatchObject({ roots: [{ injector: { name: 'B' } }] });
    expect(elementInjectors(await call('inspect-providers', 'app-root'))).toMatchObject([
      { injector: { name: 'B' } },
    ]);
    const first = await call('inspect-providers', 'app-root', { pageId: 'p1' });
    expect(first).toMatch(/`p1`/);
    expect(elementInjectors(first)).toMatchObject([{ injector: { name: 'A' } }]);

    await push('forget-injector-page', 'p2');
    expect(elementInjectors(await call('inspect-providers', 'app-root'))).toMatchObject([
      { injector: { name: 'A' } },
    ]);
    await push('forget-injector-page', 'p1');
    expect(await call('inspect-providers', 'app-root')).toMatch(/no injector data/i);
    expect(await injectorState()).toMatchObject({ roots: [], environment: [], pages: {} });
  });

  it('expires injector trees a page stopped reporting', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const { push, call } = await boot();
    await push('push-injector-tree', { pageId: 'p1', roots: [injectorRoot('A')], environment: [] });
    vi.advanceTimersByTime(10_000);
    expect(await call('inspect-providers', 'app-root')).toMatch(/`p1`/);
    vi.advanceTimersByTime(10_000);
    expect(await call('inspect-providers', 'app-root')).toMatch(/no injector data/i);
  });
});
