// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  MAX_INJECTOR_NODES,
  collectInjectorTree,
  providerKind,
  tokenName,
} from '../injector-tree.ts';

class ElementRef {
  static __NG_ELEMENT_ID__ = 1;
}
class Store {}
class Logger {}
class App {}
class Card {}
class Tooltip {}
const API_URL = { _desc: 'API_URL', toString: () => 'InjectionToken API_URL' };

function fakeNg() {
  document.body.innerHTML = `
    <app-root>
      <header><a href="/">Home</a></header>
      <main><div><app-card tooltip></app-card></div></main>
    </app-root>`;
  const root = document.querySelector('app-root')!;
  const card = document.querySelector('app-card')!;

  const nullInjector = { kind: 'null' };
  const platform = { kind: 'env', scopes: new Set(['platform']), source: 'Platform: core' };
  const rootEnv = { kind: 'env', scopes: new Set(['root']), source: 'Environment Injector' };
  const routeEnv = { kind: 'env', scopes: new Set(), source: 'Route: cards' };
  const node = (el: Element) => ({ kind: 'node', el });

  const meta = (inj: any) =>
    inj.kind === 'node'
      ? { type: 'element', source: inj.el }
      : inj.kind === 'null'
        ? { type: 'null', source: null }
        : { type: 'environment', source: inj.source };

  return {
    root,
    card,
    ng: {
      getInjector: (el: Element) => node(el),
      getComponent: (el: Element) => (el === root ? new App() : el === card ? new Card() : null),
      getDirectives: (el: Element) =>
        el === root ? [new App()] : el === card ? [new Card(), new Tooltip()] : [],
      ɵgetInjectorMetadata: meta,
      ɵgetInjectorResolutionPath: (inj: any) =>
        inj.el === card
          ? [inj, node(root), routeEnv, rootEnv, platform, nullInjector]
          : [inj, rootEnv, platform, nullInjector],
      ɵgetInjectorProviders: (inj: any) => {
        if (inj === rootEnv)
          return [
            { token: Store, provider: Store, importPath: [App] },
            { token: API_URL, provider: { provide: API_URL, useValue: '/api' } },
          ];
        if (inj.el === card)
          return [
            { token: ElementRef, provider: ElementRef },
            {
              token: Logger,
              provider: { provide: Logger, useFactory: () => 0 },
              isViewProvider: true,
            },
          ];
        return [{ token: ElementRef, provider: ElementRef }];
      },
      ɵgetDependenciesFromInjectable: (_inj: any, ctor: unknown) =>
        ctor === Card
          ? {
              dependencies: [
                { token: Store, flags: { optional: false }, providedIn: rootEnv },
                { token: Logger, flags: { self: true }, providedIn: node(card) },
                { token: API_URL, flags: { optional: true } },
              ],
            }
          : { dependencies: [] },
    } as any,
  };
}

describe('collectInjectorTree', () => {
  it('only lists elements that carry a component or directive', () => {
    const { ng } = fakeNg();
    const { roots } = collectInjectorTree(ng);
    expect(roots).toHaveLength(1);
    expect(roots[0].injector).toMatchObject({ name: 'app-root', component: 'App' });
    expect(roots[0].children.map((c) => c.injector.name)).toEqual(['app-card']);
    expect(roots[0].children[0].injector.directives).toEqual(['Card', 'Tooltip']);
  });

  it('drops built-in element tokens and names provider kinds', () => {
    const { ng } = fakeNg();
    const card = collectInjectorTree(ng).roots[0].children[0];
    expect(card.providers).toEqual([{ token: 'Logger', type: 'factory', isViewProvider: true }]);
    expect(card.injector.providerCount).toBe(1);
  });

  it('builds the environment chain from the platform down', () => {
    const { ng } = fakeNg();
    const { environment } = collectInjectorTree(ng);
    expect(environment.map((e) => e.injector.name)).toEqual(['Platform']);
    const root = environment[0].children[0];
    expect(root.injector.name).toBe('Root');
    expect(root.children.map((c) => c.injector.name)).toEqual(['Route: cards']);
    expect(root.providers).toEqual([
      { token: 'Store', type: 'class', isViewProvider: false, importPath: ['App'] },
      { token: 'API_URL', type: 'value', isViewProvider: false },
    ]);
  });

  it('reports what each component injected and which injector supplied it', () => {
    const { ng } = fakeNg();
    const { roots, environment } = collectInjectorTree(ng);
    const card = roots[0].children[0];
    const rootId = environment[0].children[0].injector.id;
    expect(card.dependencies).toEqual([
      { from: 'Card', token: 'Store', flags: [], providedBy: rootId },
      { from: 'Card', token: 'Logger', flags: ['self'], providedBy: card.injector.id },
      { from: 'Card', token: 'API_URL', flags: ['optional'], providedBy: null },
    ]);
    expect(card.injector.path).toEqual([
      card.injector.id,
      roots[0].injector.id,
      environment[0].children[0].children[0].injector.id,
      rootId,
      environment[0].injector.id,
      'inj-null',
    ]);
  });

  it('keeps ids stable between collections and gives each element a selector', () => {
    const { ng, card } = fakeNg();
    const first = collectInjectorTree(ng).roots[0].children[0].injector;
    const again = collectInjectorTree(ng).roots[0].children[0].injector;
    expect(again.id).toBe(first.id);
    expect(document.querySelector(first.selector!)).toBe(card);
  });

  it('reads element providers and dependencies once per element', () => {
    const { ng } = fakeNg();
    let calls = 0;
    const providers = ng.ɵgetInjectorProviders;
    ng.ɵgetInjectorProviders = (inj: any) => {
      if (inj.kind === 'node') calls++;
      return providers(inj);
    };
    const first = collectInjectorTree(ng);
    const afterFirst = calls;
    const again = collectInjectorTree(ng);
    expect(afterFirst).toBe(2);
    expect(calls).toBe(afterFirst);
    expect(again).toEqual(first);
  });

  it('caps the number of element nodes and says so', () => {
    document.body.innerHTML = `<ul>${'<li></li>'.repeat(MAX_INJECTOR_NODES + 5)}</ul>`;
    const env = { kind: 'env' };
    const ng = {
      getInjector: (el: Element) => ({ kind: 'node', el }),
      getComponent: () => null,
      getDirectives: (el: Element) => (el.tagName === 'LI' ? [new Tooltip()] : []),
      ɵgetInjectorMetadata: (inj: any) =>
        inj.kind === 'node'
          ? { type: 'element', source: inj.el }
          : { type: 'environment', source: 'R' },
      ɵgetInjectorResolutionPath: (inj: any) => [inj, env],
      ɵgetInjectorProviders: () => [],
    } as any;
    const report = collectInjectorTree(ng);
    expect(report.roots).toHaveLength(MAX_INJECTOR_NODES);
    expect(report.truncated).toBe(true);
    expect(document.querySelector(report.roots[1].injector.selector!)).toBe(
      document.querySelectorAll('li')[1],
    );
  });

  it('returns nothing without the Angular debug APIs', () => {
    expect(collectInjectorTree(undefined)).toEqual({ roots: [], environment: [] });
  });
});

describe('token and provider naming', () => {
  it('reads class names and injection token descriptions', () => {
    expect(tokenName(Store)).toBe('Store');
    expect(tokenName(API_URL)).toBe('API_URL');
    expect(tokenName({ toString: () => 'InjectionToken X' })).toBe('X');
  });

  it('tells provider kinds apart', () => {
    expect(providerKind(Store)).toBe('class');
    expect(providerKind({ useValue: 0 })).toBe('value');
    expect(providerKind({ useFactory: () => 0 })).toBe('factory');
    expect(providerKind({ useExisting: Store })).toBe('existing');
    expect(providerKind({ useClass: Store })).toBe('class');
  });
});
