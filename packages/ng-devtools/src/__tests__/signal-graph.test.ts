// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { elementId } from '../element-id.ts';
import {
  collectSignalGraph,
  graphKey,
  routedComponent,
  toSignalTarget,
  type SignalDebugNg,
} from '../signal-graph.ts';

const SIGNAL = Symbol('SIGNAL');
const UNSET = Symbol('UNSET');

class Root {}
class Shell {}
class Page {}
class Card {}
class Popup {}

function fakeNg(
  components: Record<string, object>,
  graphOf: (el: Element) => ReturnType<NonNullable<SignalDebugNg['ɵgetSignalGraph']>> = (el) => ({
    nodes: [{ id: '1', kind: 'signal', label: el.tagName.toLowerCase(), epoch: 1, value: 1 }],
    edges: [],
  }),
): SignalDebugNg {
  return {
    getComponent: (el) => components[el.tagName] ?? null,
    getInjector: (el) => el,
    ɵgetSignalGraph: (injector) => graphOf(injector as Element),
    isSignal: (v) => typeof v === 'function' && SIGNAL in (v as object),
  };
}

const standard = {
  'APP-ROOT': new Root(),
  'APP-SHELL': new Shell(),
  'APP-PAGE': new Page(),
  'APP-CARD': new Card(),
  'APP-POPUP': new Popup(),
};

describe('collectSignalGraph target', () => {
  it('follows the deepest component of the primary outlet chain', () => {
    document.body.innerHTML = `
      <app-root ng-version="22.0.0">
        <router-outlet></router-outlet><app-shell>
          <router-outlet></router-outlet><app-page><app-card></app-card></app-page>
        </app-shell>
        <router-outlet name="popup"></router-outlet><app-popup></app-popup>
      </app-root>`;
    const ng = fakeNg(standard);
    expect(routedComponent(ng)?.tagName).toBe('APP-PAGE');
    const graph = collectSignalGraph(ng)!;
    expect(graph.componentSelector).toBe('app-page');
    expect(graph.source).toBe('routed');
    expect(graph.component).toMatchObject({
      name: 'Page',
      tag: 'app-page',
      path: 'app-root > app-shell > app-page',
    });
  });

  it('ignores a primary outlet nested inside an auxiliary route', () => {
    document.body.innerHTML = `
      <app-root ng-version="22.0.0">
        <router-outlet></router-outlet><app-page></app-page>
        <router-outlet name="popup"></router-outlet><app-popup>
          <div><router-outlet></router-outlet><app-card></app-card></div>
        </app-popup>
      </app-root>`;
    expect(routedComponent(fakeNg(standard))?.tagName).toBe('APP-PAGE');
  });

  it('targets one instance by id, so the second of a list can be inspected', () => {
    document.body.innerHTML = `
      <app-root ng-version="22.0.0"><app-card></app-card><app-card></app-card></app-root>`;
    const second = document.querySelectorAll('app-card')[1];
    const ng = fakeNg(standard, (el) => ({
      nodes: [
        {
          id: '1',
          kind: 'signal',
          label: el === second ? 'second' : 'other',
          epoch: 1,
          value: 0,
        },
      ],
      edges: [],
    }));
    const graph = collectSignalGraph(ng, { id: elementId(second) })!;
    expect(graph.source).toBe('selected');
    expect(graph.nodes[0].label).toBe('second');
    expect(graph.component?.path).toBe('app-root > app-card[2]');
  });

  it('falls back when the target is not a component host, missing or invalid', () => {
    document.body.innerHTML = `<app-root ng-version="22.0.0"><div class="plain"></div></app-root>`;
    const ng = fakeNg(standard);
    const plain = document.querySelector('.plain')!;
    expect(collectSignalGraph(ng, { id: elementId(plain) })?.componentSelector).toBe('app-root');
    expect(collectSignalGraph(ng, { selector: 'app-gone' })?.componentSelector).toBe('app-root');
    expect(collectSignalGraph(ng, { selector: '[[bad' })?.componentSelector).toBe('app-root');
    expect(collectSignalGraph(ng, { selector: 'app-root' })?.source).toBe('selected');
  });

  it('finds a component host without relying on _nghost attributes', () => {
    document.body.innerHTML = `<app-root ng-version="22.0.0"><app-card></app-card></app-root>`;
    const ng = fakeNg(standard, (el) =>
      el.tagName === 'APP-CARD'
        ? { nodes: [{ id: '9', kind: 'signal', epoch: 0 }], edges: [] }
        : { nodes: [], edges: [] },
    );
    expect(collectSignalGraph(ng)?.componentSelector).toBe('app-card');
  });

  it('keeps an empty root graph only when no host has signals', () => {
    document.body.innerHTML = `<app-root ng-version="22.0.0"><app-card></app-card></app-root>`;
    const ng = fakeNg(standard, () => ({ nodes: [], edges: [] }));
    const graph = collectSignalGraph(ng)!;
    expect(graph.componentSelector).toBe('app-root');
    expect(graph.nodes).toEqual([]);
  });

  it('falls back to a dialog host outside the ng-version root', () => {
    document.body.innerHTML = `
      <app-root ng-version="22.0.0"></app-root>
      <div class="cdk-overlay-container"><div class="pane"><app-popup></app-popup></div></div>`;
    const ng = fakeNg(standard, (el) =>
      el.tagName === 'APP-POPUP'
        ? { nodes: [{ id: '1', kind: 'signal', label: 'open', epoch: 1, value: true }], edges: [] }
        : { nodes: [], edges: [] },
    );
    expect(collectSignalGraph(ng)?.componentSelector).toBe('app-popup');
  });
});

describe('collectSignalGraph values', () => {
  it('reads linkedSignal values from the component fields and names sentinels', () => {
    document.body.innerHTML = `<app-root ng-version="22.0.0"></app-root>`;
    const selection = () => 'Paris';
    (selection as unknown as Record<symbol, unknown>)[SIGNAL] = {
      kind: 'linkedSignal',
      debugName: 'selection',
    };
    const other = () => 'nope';
    (other as unknown as Record<symbol, unknown>)[SIGNAL] = { kind: 'signal', debugName: 'other' };
    const root = Object.assign(new Root(), { selection, other });
    const ng = fakeNg({ 'APP-ROOT': root }, () => ({
      nodes: [
        { id: '1', kind: 'linkedSignal', label: 'selection', epoch: 2 },
        { id: '2', kind: 'computed', label: 'total', epoch: 0, value: UNSET },
        { id: '3', kind: 'computed', label: 'map', epoch: 1, value: new Map([['a', 1]]) },
        { id: '4', kind: 'effect', label: 'log', epoch: 1 },
      ],
      edges: [{ consumer: 3, producer: 0 }],
    }));
    const graph = collectSignalGraph(ng)!;
    expect(graph.nodes[0].value).toBe('Paris');
    expect(graph.nodes[1].value).toBe('(not computed yet)');
    expect(graph.nodes[2].value).toEqual({ $type: 'Map', size: 1, entries: [['a', 1]] });
    expect('value' in graph.nodes[3]).toBe(false);
    expect(graph.nodes.some((n) => 'watched' in n)).toBe(false);
  });

  it('redacts secret-named signals and tokens inside values', () => {
    document.body.innerHTML = `<app-root ng-version="22.0.0"></app-root>`;
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijk';
    const password = () => 'hunter2';
    (password as unknown as Record<symbol, unknown>)[SIGNAL] = {
      kind: 'linkedSignal',
      debugName: 'password',
    };
    const root = Object.assign(new Root(), { password });
    const ng = fakeNg({ 'APP-ROOT': root }, () => ({
      nodes: [
        {
          id: '1',
          kind: 'signal',
          label: 'model',
          epoch: 1,
          value: { email: 'a@b.c', password: 'x' },
        },
        { id: '2', kind: 'signal', label: 'accessToken', epoch: 1, value: 'abc123' },
        { id: '3', kind: 'linkedSignal', label: 'password', epoch: 1 },
        { id: '4', kind: 'computed', label: 'header', epoch: 1, value: `Bearer ${jwt}` },
      ],
      edges: [],
    }));
    const graph = collectSignalGraph(ng)!;
    expect(graph.nodes[0].value).toEqual({ email: 'a@b.c', password: '[redacted]' });
    expect(graph.nodes[1].value).toBe('[redacted]');
    expect(graph.nodes[2].value).toBe('[redacted]');
    expect(graph.nodes[3].value).not.toContain('eyJ');
  });

  it('keys a graph by component, node ids and epochs', () => {
    document.body.innerHTML = `<app-root ng-version="22.0.0"></app-root>`;
    let epoch = 1;
    const ng = fakeNg(standard, () => ({
      nodes: [{ id: '1', kind: 'signal', label: 'count', epoch, value: epoch }],
      edges: [],
    }));
    const first = graphKey(collectSignalGraph(ng)!);
    expect(graphKey(collectSignalGraph(ng)!)).toBe(first);
    epoch = 2;
    expect(graphKey(collectSignalGraph(ng)!)).not.toBe(first);
  });
});

describe('toSignalTarget', () => {
  it('ignores requests for another page and accepts agent selectors', () => {
    expect(toSignalTarget({ pageId: 'b', id: 'c1' }, 'a')).toBeUndefined();
    expect(toSignalTarget({ pageId: 'a', id: 'c1' }, 'a')).toEqual({ id: 'c1' });
    expect(toSignalTarget({ id: null }, 'a')).toBeNull();
    expect(toSignalTarget('app-card', 'a')).toEqual({ selector: 'app-card' });
    expect(toSignalTarget(null, 'a')).toBeNull();
  });
});
