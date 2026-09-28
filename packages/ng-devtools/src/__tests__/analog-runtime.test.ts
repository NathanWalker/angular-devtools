// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  ANALOG_META_DESCRIPTION,
  analogMetaOf,
  chainOf,
  collectAnalog,
  configPathsOf,
  fileOfEndpoint,
  hasAnalogMeta,
  hydrationErrorOf,
  loadSummary,
} from '../analog-runtime.ts';

const META = Symbol(ANALOG_META_DESCRIPTION);

function analogRoute(path: string, endpointKey: string, extra: Record<string, unknown> = {}) {
  return {
    path,
    component: class {},
    ...extra,
    [META]: { endpoint: `/pages/${path}`, endpointKey },
  };
}

describe('Analog runtime reader', () => {
  it('finds the hidden route metadata and maps it to files', () => {
    const route = analogRoute('', '/src/app/pages/products/[id].server.ts');
    expect(analogMetaOf(route)?.endpointKey).toBe('/src/app/pages/products/[id].server.ts');
    expect(analogMetaOf({ path: 'x' })).toBeNull();
    expect(fileOfEndpoint('/src/app/pages/products/[id].server.ts')).toEqual({
      file: '/src/app/pages/products/[id].page.ts',
      serverFile: '/src/app/pages/products/[id].server.ts',
    });
    expect(fileOfEndpoint('/src/app/pages/about.md')).toEqual({ file: '/src/app/pages/about.md' });
  });

  it('walks the active snapshot and picks up load data', () => {
    const leaf = {
      routeConfig: analogRoute('', '/src/app/pages/products/[id].server.ts'),
      data: { load: { id: '1', token: 'abc' } },
      firstChild: null,
    };
    const param = { routeConfig: { path: ':id' }, data: {}, firstChild: leaf };
    const layout = {
      routeConfig: analogRoute('', '/src/app/pages/products.server.ts'),
      data: {},
      firstChild: param,
    };
    const top = { routeConfig: { path: 'products' }, data: {}, firstChild: layout };
    const root = { routeConfig: null, data: {}, firstChild: top };
    const { chain, data, loadFrom } = chainOf(root);
    expect(loadFrom).toBe(1);
    expect(chain.map((c) => `${c.path} ${c.file}`)).toEqual([
      '/products /src/app/pages/products.page.ts',
      '/products/:id /src/app/pages/products/[id].page.ts',
    ]);
    const summary = loadSummary(data)!;
    expect(summary.keys).toEqual(['id', 'token']);
    expect(summary.preview).toBe('{"id":"1","token":"[redacted]"}');
  });

  it('lists router paths including loaded children', () => {
    const config = [
      {
        path: '',
        loadChildren: () => null,
        _loadedRoutes: [analogRoute('', '/src/app/pages/index.server.ts')],
      },
      { path: 'products', children: [{ path: ':id' }] },
    ];
    expect(configPathsOf(config)).toEqual(['/', '/products', '/products/:id']);
  });

  it('recognises hydration errors', () => {
    expect(
      hydrationErrorOf([new Error('NG0500: During hydration Angular expected <div>')]),
    ).toContain('NG0500');
    expect(hydrationErrorOf(['NG04002: Cannot match any routes'])).toBeNull();
    expect(hydrationErrorOf(['NG05104: Root element was not found'])).toBeNull();
    expect(hydrationErrorOf(['NG0505: no hydration info in server response'])).toContain('NG0505');
  });

  it('builds a report from the router behind window.ng', () => {
    document.body.innerHTML =
      '<app-root ng-version="22" ng-server-context="ssr-analog"><p ngh="0"></p><span></span></app-root><script id="shop-state" type="application/json">{}</script>';
    const p = document.querySelector('p') as unknown as Record<string, unknown>;
    p['__ngDebugHydrationInfo__'] = { status: 'hydrated' };
    (document.querySelector('span') as unknown as Record<string, unknown>)[
      '__ngDebugHydrationInfo__'
    ] = { status: 'hydrated' };
    const leaf = {
      routeConfig: analogRoute('', '/src/app/pages/about.md'),
      data: {},
      firstChild: null,
    };
    const router = {
      url: '/about',
      config: [{ path: 'about', loadChildren: () => null }],
      routerState: {
        snapshot: {
          root: {
            routeConfig: null,
            data: {},
            firstChild: { routeConfig: { path: 'about' }, data: {}, firstChild: leaf },
          },
        },
      },
    };
    const ng = { getInjector: () => ({}), ɵgetRouterInstance: () => router };
    const report = collectAnalog(ng, 'p1', ['NG0500: x'])!;
    expect(report).toMatchObject({
      pageId: 'p1',
      url: '/about',
      analog: true,
      serverContext: 'ssr-analog',
      hydrated: 2,
      transferState: true,
      hydrationErrors: ['NG0500: x'],
      configPaths: ['/about'],
    });
    expect(report.chain[0].file).toBe('/src/app/pages/about.md');
    expect(collectAnalog({}, 'p', [])).toBeNull();
  });

  it('does not mistake a plain Angular app with lazy routes for Analog', () => {
    document.body.innerHTML = '<app-root ng-version="22"></app-root>';
    const router = {
      url: '/admin',
      config: [{ path: 'admin', loadChildren: () => null, _loadedRoutes: [{ path: '' }] }],
      routerState: { snapshot: { root: { routeConfig: null, data: {}, firstChild: null } } },
    };
    const ng = { getInjector: () => ({}), ɵgetRouterInstance: () => router };
    const scanner = vi.fn(() => ({ hydrated: 5 }));
    expect(collectAnalog(ng, 'p', [], scanner)).toMatchObject({ analog: false, hydrated: 0 });
    expect(scanner).not.toHaveBeenCalled();
    router.config.push(analogRoute('x', '/src/app/pages/x.page.ts') as never);
    expect(collectAnalog(ng, 'p', [], scanner)).toMatchObject({ analog: true, hydrated: 5 });
    expect(scanner).toHaveBeenCalledTimes(1);
    expect(
      hasAnalogMeta([{ path: 'x', _loadedRoutes: [analogRoute('', '/src/app/pages/x.page.ts')] }]),
    ).toBe(true);
  });
});
