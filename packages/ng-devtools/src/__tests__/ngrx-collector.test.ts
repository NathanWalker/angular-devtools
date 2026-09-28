// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createNgrxCollector } from '../ngrx-collector.ts';
import { diff, serialize } from '../ngrx-shared.ts';
import { mergeNgrxReport, nameStore, ngrxStateOf, type NgrxPages } from '../rpc/ngrx-tools.ts';

const SIGNAL = Symbol('SIGNAL');
const STATE_SOURCE = Symbol('STATE_SOURCE');

function writable<T>(initial: T) {
  const node = { value: initial };
  const getter = (() => node.value) as (() => T) & {
    set(v: T): void;
    update(fn: (v: T) => T): void;
  };
  (getter as any)[SIGNAL] = node;
  getter.set = (v: T) => {
    node.value = v;
  };
  getter.update = (fn: (v: T) => T) => {
    node.value = fn(node.value);
  };
  return getter;
}

function computedOf<T>(fn: () => T) {
  const getter = () => fn();
  (getter as any)[SIGNAL] = { computation: fn };
  return getter;
}

function patchState(store: any, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) store[STATE_SOURCE][key].set(value);
}

class SignalStore {
  [STATE_SOURCE] = { query: writable(''), saved: writable<string[]>([]) };
  query = computedOf(() => (this as any)[STATE_SOURCE].query());
  saved = computedOf(() => (this as any)[STATE_SOURCE].saved());
  savedCount = computedOf(() => (this as any)[STATE_SOURCE].saved().length);
  setQuery = (query: string) => patchState(this, { query });
  isSaved = (id: string) => (this as any)[STATE_SOURCE].saved().includes(id);
  toggle = (id: string) => {
    const saved = (this as any)[STATE_SOURCE].saved();
    patchState(this, { saved: saved.includes(id) ? [] : [...saved, id] });
  };
}

class App {
  store: SignalStore;
  constructor(store: SignalStore) {
    this.store = store;
  }
}

function setup() {
  document.body.innerHTML = '<app-root ng-version="22"></app-root>';
  const root = document.querySelector('app-root')!;
  const store = new SignalStore();
  const app = new App(store);
  const rootEnv = {
    scopes: new Set(['root']),
    records: new Map<unknown, { value: unknown }>([
      [class Router {}, { value: {} }],
      [SignalStore, { value: store }],
    ]),
    get: () => null,
  };
  const node = { el: root, get: () => null };
  const ng = {
    getInjector: () => node,
    getComponent: (el: Element) => (el === root ? app : null),
    ɵgetInjectorMetadata: (inj: unknown) =>
      inj === rootEnv ? { type: 'environment', source: 'R3Injector' } : { type: 'element' },
    ɵgetInjectorResolutionPath: () => [node, rootEnv],
    ɵgetInjectorProviders: () => [],
  };
  const onChange = vi.fn();
  const collector = createNgrxCollector(() => ng as any, onChange);
  return { store, app, rootEnv, collector, onChange };
}

describe('ngrx collector', () => {
  it('finds a root signal store and splits state, computed and methods', () => {
    const { collector } = setup();
    const { stores, classic } = collector.collect();
    expect(classic).toBeNull();
    expect(stores).toHaveLength(1);
    const [info] = stores;
    expect(info.kind).toBe('signal-store');
    expect(info.className).toBe('SignalStore');
    expect(info.scope).toBe('root');
    expect(info.stateKeys).toEqual(['query', 'saved']);
    expect(info.state).toEqual({ query: '', saved: [] });
    expect(info.computed).toEqual({ savedCount: 0 });
    expect(info.methods.map((m) => m.name)).toEqual(['setQuery', 'isSaved', 'toggle']);
    expect(info.references).toEqual(['App.store']);
    expect(info.writable).toBe(true);
  });

  it('unwraps a store that is no longer found and wraps it once when it comes back', () => {
    const { store, app, rootEnv, collector } = setup();
    const original = store.setQuery;
    collector.collect();
    expect(store.setQuery).not.toBe(original);

    rootEnv.records.delete(SignalStore);
    (app as any).store = null;
    expect(collector.collect().stores).toHaveLength(0);
    expect(store.setQuery).toBe(original);

    rootEnv.records.set(SignalStore, { value: store });
    collector.collect();
    store.setQuery('rome');
    expect(collector.logSince(0).filter((entry) => entry.type === 'setQuery')).toHaveLength(1);
  });

  it('keeps a stable id across collections', () => {
    const { collector } = setup();
    const first = collector.collect().stores[0].id;
    expect(collector.collect().stores[0].id).toBe(first);
  });

  it('logs method calls with args and a diff, and calls that change nothing at most once a second', () => {
    const { store, collector, onChange } = setup();
    collector.collect();
    store.setQuery('rome');
    store.isSaved('a');
    store.isSaved('b');
    const log = collector.logSince(0);
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ type: 'isSaved', args: ['a'], diff: [] });
    expect(log[0]).toMatchObject({
      seq: 1,
      type: 'setQuery',
      args: ['rome'],
      restorable: true,
      diff: [{ path: 'query', op: 'change', before: '', after: 'rome' }],
    });
    expect(onChange).toHaveBeenCalled();
    expect(collector.collect().stores[0].methods.find((m) => m.name === 'isSaved')?.calls).toBe(2);
  });

  it('logs writes made outside a method as patchState', async () => {
    const { store, collector } = setup();
    collector.collect();
    patchState(store, { saved: ['x'] });
    await Promise.resolve();
    const [entry] = collector.logSince(0);
    expect(entry.type).toBe('patchState');
    expect(entry.diff).toEqual([{ path: 'saved[0]', op: 'add', after: 'x' }]);
  });

  it('restores a snapshot from the log', () => {
    const { store, collector } = setup();
    collector.collect();
    store.setQuery('a');
    store.setQuery('b');
    const result = collector.run({ type: 'restore', seq: 1 });
    expect(result.ok).toBe(true);
    expect((store as any)[STATE_SOURCE].query()).toBe('a');
    const last = collector.logSince(2)[0];
    expect(last.type).toBe('Restore #1 (watchState listeners not notified)');
    expect(collector.run({ type: 'restore', seq: 99 }).error).toBeTruthy();
  });

  it('logs a change past the serialize limits by reference and restores the raw value', () => {
    const { store, collector } = setup();
    const many = Array.from({ length: 150 }, (_, i) => `id${i}`);
    (store as any).replace = (next: string[]) => patchState(store, { saved: next });
    patchState(store, { saved: many });
    collector.collect();
    const changed = many.map((id, i) => (i === 140 ? 'changed' : id));
    (store as any).replace(changed);
    const [entry] = collector.logSince(0);
    expect(entry).toMatchObject({
      type: 'replace',
      diff: [{ path: 'saved[140]', op: 'change', before: 'id140', after: 'changed' }],
    });
    (store as any).replace([...changed]);
    expect(collector.run({ type: 'restore', seq: entry.seq }).ok).toBe(true);
    expect((store as any)[STATE_SOURCE].saved()).toBe(changed);
  });

  it('finds a changed entity past the first hundred map keys', () => {
    const { store, collector } = setup();
    const entityMap = Object.fromEntries(
      Array.from({ length: 150 }, (_, i) => [`e${i}`, { id: i, done: false }]),
    );
    patchState(store, { saved: entityMap });
    collector.collect();
    (store as any)[STATE_SOURCE].saved.set({ ...entityMap, e149: { id: 149, done: true } });
    return Promise.resolve().then(() => {
      const [entry] = collector.logSince(0);
      expect(entry.type).toBe('patchState');
      expect(entry.diff).toEqual([
        { path: 'saved.e149.done', op: 'change', before: false, after: true },
      ]);
    });
  });

  it('redacts secret-looking state keys and nested fields', () => {
    const { store, collector } = setup();
    patchState(store, { saved: [{ user: 'ann', password: 'hunter2' }] });
    collector.collect();
    expect(collector.collect().stores[0].state).toEqual({
      query: '',
      saved: [{ user: 'ann', password: '[redacted]' }],
    });
    patchState(store, { saved: [{ user: 'ann', password: 'swordfish' }] });
    return Promise.resolve().then(() => {
      expect(JSON.stringify(collector.logSince(0))).not.toMatch(/hunter2|swordfish/);
    });
  });

  it('only rescans the page when asked to rediscover stores', () => {
    const { store, collector } = setup();
    const spy = vi.spyOn(document, 'createTreeWalker');
    collector.collect();
    expect(spy).toHaveBeenCalledTimes(1);
    store.setQuery('a');
    expect(collector.collect(false).stores[0].state).toMatchObject({ query: 'a' });
    expect(spy).toHaveBeenCalledTimes(1);
    collector.collect();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('only returns entries after a sequence number', () => {
    const { store, collector } = setup();
    collector.collect();
    store.setQuery('a');
    store.toggle('x');
    expect(collector.logSince(1).map((e) => e.seq)).toEqual([2]);
  });

  it('reads classic store state and logs actions through ScannedActionsSubject', () => {
    document.body.innerHTML = '<app-root ng-version="22"></app-root>';
    const root = document.querySelector('app-root')!;
    let state = { count: 0 };
    const listeners: ((a: unknown) => void)[] = [];
    class _Store {
      source = { getValue: () => state };
      dispatch(action: { type: string }) {
        if (action.type === 'inc') state = { count: state.count + 1 };
        for (const l of listeners) l(action);
      }
      select() {}
    }
    class ScannedActionsSubject {
      subscribe(fn: (a: unknown) => void) {
        listeners.push(fn);
        return { unsubscribe: () => {} };
      }
    }
    const store = new _Store();
    const scanned = new ScannedActionsSubject();
    const values = new Map<unknown, unknown>([
      [_Store, store],
      [ScannedActionsSubject, scanned],
    ]);
    const rootEnv = {
      scopes: new Set(['root']),
      records: new Map([...values.keys()].map((k) => [k, { value: undefined }])),
    };
    const node = { get: (token: unknown) => values.get(token) ?? null };
    const ng = {
      getInjector: () => node,
      getComponent: (el: Element) => (el === root ? {} : null),
      ɵgetInjectorResolutionPath: () => [node, rootEnv],
      ɵgetInjectorProviders: () => [],
    };
    const collector = createNgrxCollector(
      () => ng as any,
      () => {},
    );
    expect(collector.collect().classic).toEqual({
      state: { count: 0 },
      devtools: false,
      scope: 'root',
    });
    store.dispatch({ type: 'inc' });
    const [entry] = collector.logSince(0);
    expect(entry).toMatchObject({
      source: 'store',
      type: 'inc',
      action: { type: 'inc' },
      restorable: false,
      diff: [{ path: 'count', op: 'change', before: 0, after: 1 }],
    });
    expect(collector.run({ type: 'restore', seq: entry.seq }).error).toMatch(
      /provideStoreDevtools/,
    );
  });
});

describe('serialize', () => {
  it('handles Map, Set, Date, circular and depth limits', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    expect(
      serialize(
        {
          map: new Map([['k', 1]]),
          set: new Set([1]),
          date: new Date(0),
          circular,
          deep: { a: { b: { c: 1 } } },
          none: undefined,
        },
        { depth: 3 },
      ),
    ).toEqual({
      map: { '@type': 'Map', size: 1, entries: [['k', 1]] },
      set: { '@type': 'Set', size: 1, values: [1] },
      date: { '@type': 'Date', value: '1970-01-01T00:00:00.000Z' },
      circular: { a: 1, self: '[Circular]' },
      deep: { a: { b: '[Object]' } },
      none: { '@type': 'undefined' },
    });
  });

  it('diffs nested objects and arrays by path', () => {
    expect(diff({ a: { b: 1 }, list: [1] }, { a: { b: 2 }, list: [1, 2], c: true })).toEqual([
      { path: 'a.b', op: 'change', before: 1, after: 2 },
      { path: 'list[1]', op: 'add', after: 2 },
      { path: 'c', op: 'add', after: true },
    ]);
  });
});

describe('ngrx tools', () => {
  const store = {
    id: 'ngrx-1',
    kind: 'signal-store' as const,
    className: 'SignalStore',
    scope: 'root',
    stateKeys: ['query', 'saved'],
    state: {},
    computed: {},
    methods: [{ name: 'setQuery', calls: 0 }],
    references: [],
    writable: true,
  };

  it('names a store from the matching withState keys', () => {
    expect(
      nameStore(store, [
        { name: 'OtherStore', kind: 'signal-store', file: 'a.ts', members: { state: ['x'] } },
        {
          name: 'TravelStore',
          kind: 'signal-store',
          file: 'travel.store.ts',
          members: { state: ['query', 'saved'] },
        },
      ]),
    ).toEqual({ name: 'TravelStore', declaredIn: 'travel.store.ts' });
  });

  it('appends only new log entries and restarts on a new session', () => {
    const pages: NgrxPages = new Map();
    const entry = (seq: number) => ({
      seq,
      source: 'signal-store' as const,
      storeId: 'ngrx-1',
      type: 't',
      timestamp: 0,
      diff: [],
      restorable: true,
    });
    const report = (session: string, log: ReturnType<typeof entry>[]) => ({
      pageId: 'p1',
      session,
      url: '/',
      title: '',
      stores: [store],
      classic: null,
      log,
    });
    expect(mergeNgrxReport(pages, report('s1', [entry(1), entry(2)]), [])).toBe(2);
    expect(mergeNgrxReport(pages, report('s1', [entry(2), entry(3)]), [])).toBe(3);
    expect(ngrxStateOf(pages).pages[0].log.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(mergeNgrxReport(pages, report('s2', [entry(1)]), [])).toBe(1);
    expect(ngrxStateOf(pages).pages[0]).not.toHaveProperty('session');
  });
});

describe('ngrx collector with @ngrx/signals', () => {
  it('reads, logs and restores a real signal store from an injector', async () => {
    await import('@angular/compiler');
    const { Injector, computed } = await import('@angular/core');
    const {
      signalStore,
      withState,
      withComputed,
      withMethods,
      patchState: patch,
    } = await import('@ngrx/signals');
    const TravelStore = signalStore(
      { providedIn: 'root' },
      withState({ query: '', saved: [] as string[] }),
      withComputed(({ saved }) => ({ savedCount: computed(() => saved().length) })),
      withMethods((store) => ({
        setQuery(query: string) {
          patch(store, { query });
        },
      })),
    );
    const injector = Injector.create({ providers: [TravelStore] });
    const store = injector.get(TravelStore);
    document.body.innerHTML = '<app-root ng-version="22"></app-root>';
    const root = document.querySelector('app-root')!;
    const node = { get: () => null };
    const ng = {
      getInjector: () => node,
      getComponent: (el: Element) => (el === root ? { store } : null),
      ɵgetInjectorResolutionPath: () => [node, injector],
      ɵgetInjectorProviders: () => [],
    };
    const collector = createNgrxCollector(
      () => ng as any,
      () => {},
    );
    const [info] = collector.collect().stores;
    expect(info).toMatchObject({
      className: 'SignalStore',
      stateKeys: ['query', 'saved'],
      state: { query: '', saved: [] },
      computed: { savedCount: 0 },
      methods: [{ name: 'setQuery', calls: 0 }],
      references: ['Object.store'],
    });
    store.setQuery('rome');
    store.setQuery('oslo');
    expect(collector.logSince(0).map((e) => e.type)).toEqual(['setQuery', 'setQuery']);
    expect(collector.run({ type: 'restore', seq: 1 }).ok).toBe(true);
    expect(store.query()).toBe('rome');
  });

  it('restores without notifying watchState listeners and says so', async () => {
    await import('@angular/compiler');
    const { Injector } = await import('@angular/core');
    const {
      signalStore,
      withState,
      withMethods,
      watchState,
      patchState: patch,
    } = await import('@ngrx/signals');
    const Store = signalStore(
      withState({ query: '' }),
      withMethods((store) => ({
        setQuery(query: string) {
          patch(store, { query });
        },
      })),
    );
    const injector = Injector.create({ providers: [Store] });
    const store = injector.get(Store);
    const seen: string[] = [];
    watchState(store, (state) => seen.push(state.query), { injector });
    const collector = realCollector(store);
    collector.collect();
    store.setQuery('rome');
    store.setQuery('oslo');
    const original = WeakMap.prototype.get;
    const result = collector.run({ type: 'restore', seq: 1 });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/watchState listeners were not notified/);
    expect(store.query()).toBe('rome');
    expect(seen).toEqual(['', 'rome', 'oslo']);
    expect(collector.logSince(2)[0].type).toMatch(/watchState listeners not notified/);
    expect(WeakMap.prototype.get).toBe(original);
  });

  it('notifies watchState listeners on restore once the app registers patchState', async () => {
    await import('@angular/compiler');
    const { Injector } = await import('@angular/core');
    const { signalStore, withState, withMethods, watchState, patchState } =
      await import('@ngrx/signals');
    const { registerNgrxSignals } = await import('../ngrx-register.ts');
    const Store = signalStore(
      withState({ query: '' }),
      withMethods((store) => ({
        setQuery(query: string) {
          patchState(store, { query });
        },
      })),
    );
    const injector = Injector.create({ providers: [Store] });
    const store = injector.get(Store);
    const seen: string[] = [];
    watchState(store, (state) => seen.push(state.query), { injector });
    const collector = realCollector(store);
    collector.collect();
    store.setQuery('rome');
    store.setQuery('oslo');
    registerNgrxSignals({ patchState });
    try {
      const result = collector.run({ type: 'restore', seq: 1 });
      expect(result.ok).toBe(true);
      expect(result.message).not.toMatch(/not notified/);
      expect(store.query()).toBe('rome');
      expect(seen).toEqual(['', 'rome', 'oslo', 'rome']);
      expect(collector.logSince(2)[0].type).toBe('Restore #1');
    } finally {
      delete (globalThis as Record<string, unknown>)['__NG_DEVTOOLS_NGRX_SIGNALS__'];
    }
  });

  it('does not add reactive dependencies when a method runs inside a computed', async () => {
    await import('@angular/compiler');
    const { Injector, computed } = await import('@angular/core');
    const {
      signalStore,
      withState,
      withLinkedState,
      withMethods,
      patchState: patch,
    } = await import('@ngrx/signals');
    const Store = signalStore(
      withState({ base: 1 }),
      withLinkedState(({ base }) => ({ doubled: () => base() * 2 })),
      withMethods((store) => ({
        ping() {},
        bump() {
          patch(store, { base: store.base() + 1 });
        },
      })),
    );
    const store = Injector.create({ providers: [Store] }).get(Store);
    const collector = realCollector(store);
    collector.collect();
    let runs = 0;
    const outer = computed(() => {
      runs++;
      store.ping();
      return runs;
    });
    outer();
    store.bump();
    outer();
    expect(store.doubled()).toBe(4);
    expect(runs).toBe(1);
  });
});

function realCollector(store: object) {
  document.body.innerHTML = '<app-root ng-version="22"></app-root>';
  const root = document.querySelector('app-root')!;
  const node = { get: () => null };
  const ng = {
    getInjector: () => node,
    getComponent: (el: Element) => (el === root ? { store } : null),
    ɵgetInjectorResolutionPath: () => [node],
    ɵgetInjectorProviders: () => [],
  };
  return createNgrxCollector(
    () => ng as any,
    () => {},
  );
}
