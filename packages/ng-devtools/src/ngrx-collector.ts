import { untracked } from '@angular/core';
import { documentTree, type HostTree } from './host-tree.ts';
import { className, tokenName } from './injector-tree.ts';
import {
  diff,
  referenceDiff,
  serialize,
  serializeSlice,
  type NgrxClassicStoreInfo,
  type NgrxDiffEntry,
  type NgrxLogEntry,
  type NgrxRequest,
  type NgrxRequestResult,
  type NgrxSignalStoreInfo,
} from './ngrx-shared.ts';
import { registeredPatchState } from './ngrx-register.ts';

type AnyRecord = Record<PropertyKey, any>;

export interface NgrxDebugNg<H = Element> {
  getInjector?(el: H): unknown;
  getComponent?(el: H): unknown;
  ɵgetInjectorMetadata?(injector: unknown): { type: string; source: unknown } | null;
  ɵgetInjectorProviders?(injector: unknown): { token: unknown; isViewProvider?: boolean }[];
  ɵgetInjectorResolutionPath?(injector: unknown): unknown[];
}

interface Tracked {
  id: string;
  instance: object;
  source: AnyRecord;
  kind: NgrxSignalStoreInfo['kind'];
  className: string;
  scope: string;
  stateKeys: PropertyKey[];
  methods: Map<string, { calls: number; rx: boolean }>;
  references: Set<string>;
  writable: boolean;
  depth: number;
  pendingBefore: Record<PropertyKey, unknown> | null;
  lastNoop: Map<string, number>;
  undo: (() => void)[];
}

interface Classic {
  store: AnyRecord;
  devtools: AnyRecord | null;
  scope: string;
  last: unknown;
  stop: () => void;
}

type Snapshot = Record<PropertyKey, unknown>;

type Saved =
  { kind: 'signal'; tracked: Tracked; after: Snapshot } | { kind: 'classic'; action: unknown };

const MAX_LOG = 200;
const MAX_DIFF = 50;
const NOOP_GAP_MS = 1000;
const SMALL = { depth: 4, maxKeys: 20, maxString: 300, budget: 400 };

function read<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function symbolNamed(value: unknown, name: string): symbol | undefined {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  return read(
    () => Object.getOwnPropertySymbols(value).find((s) => s.description === name),
    undefined,
  );
}

export function isSignal(value: unknown): boolean {
  return typeof value === 'function' && !!symbolNamed(value, 'SIGNAL');
}

function peek(sig: unknown): unknown {
  const key = symbolNamed(sig, 'SIGNAL');
  const node = key ? (sig as AnyRecord)[key] : undefined;
  if (node && typeof node === 'object' && 'value' in node && !('computation' in node)) {
    return node.value;
  }
  return read(() => untracked(sig as () => unknown), undefined);
}

export function stateSourceOf(value: unknown): AnyRecord | null {
  const key = symbolNamed(value, 'STATE_SOURCE');
  const source = key ? (value as AnyRecord)[key] : undefined;
  return source && typeof source === 'object' ? source : null;
}

function stripped(token: unknown): string {
  return tokenName(token).replace(/^_+/, '');
}

function componentElements<H extends object>(ng: NgrxDebugNg<H>, tree: HostTree<H>): H[] {
  const out: H[] = [];
  const stack = tree.roots().reverse();
  while (stack.length) {
    const el = stack.pop()!;
    if (read(() => !!ng.getComponent?.(el), false)) out.push(el);
    stack.push(...tree.children(el).reverse());
  }
  return out;
}

function envScope<H>(ng: NgrxDebugNg<H>, injector: AnyRecord): string {
  if (read(() => injector['scopes']?.has?.('root'), false)) return 'root';
  if (read(() => injector['scopes']?.has?.('platform'), false)) return 'platform';
  const source = read(() => ng.ɵgetInjectorMetadata?.(injector)?.source, undefined);
  return typeof source === 'string' && source ? source : 'environment';
}

function snapshotDiff(before: Snapshot, after: Snapshot, keys: PropertyKey[]): NgrxDiffEntry[] {
  const out: NgrxDiffEntry[] = [];
  for (const key of keys) {
    if (out.length >= MAX_DIFF) break;
    if (before[key] === after[key]) continue;
    const root = String(key);
    const found = diff(
      serializeSlice(key, before[key]),
      serializeSlice(key, after[key]),
      MAX_DIFF - out.length,
    );
    if (!found.length) {
      out.push(...referenceDiff(before[key], after[key], root, SMALL, MAX_DIFF - out.length));
      continue;
    }
    for (const entry of found) {
      const path =
        entry.path === '(root)'
          ? root
          : entry.path.startsWith('[')
            ? `${root}${entry.path}`
            : `${root}.${entry.path}`;
      out.push({
        ...entry,
        path,
        ...('before' in entry ? { before: serialize(entry.before, SMALL) } : {}),
        ...('after' in entry ? { after: serialize(entry.after, SMALL) } : {}),
      });
    }
  }
  return out;
}

function syncValue(observable: AnyRecord | null | undefined): unknown {
  if (!observable) return undefined;
  if (typeof observable['getValue'] === 'function') {
    return read(() => observable['getValue'](), undefined);
  }
  let value: unknown;
  read(() => observable['subscribe']((v: unknown) => (value = v))?.unsubscribe?.(), undefined);
  return value;
}

export interface NgrxCollector {
  collect(rediscover?: boolean): {
    stores: NgrxSignalStoreInfo[];
    classic: NgrxClassicStoreInfo | null;
  };
  logSince(seq: number): NgrxLogEntry[];
  lastSeq(): number;
  run(request: NgrxRequest): NgrxRequestResult;
  stop(): void;
}

export function createNgrxCollector<H extends object = Element>(
  getNg: () => NgrxDebugNg<H> | undefined,
  onChange: () => void,
  tree: HostTree<H> = documentTree(),
): NgrxCollector {
  const ids = new WeakMap<object, string>();
  let nextId = 0;
  const idFor = (value: object) => {
    let id = ids.get(value);
    if (!id) ids.set(value, (id = `ngrx-${++nextId}`));
    return id;
  };

  const tracked = new Map<object, Tracked>();
  const wrappedSignals = new WeakSet<object>();
  const log: NgrxLogEntry[] = [];
  const saved = new Map<number, Saved>();
  let seq = 0;
  let classic: Classic | null = null;
  let classicMisses = 0;

  const append = (entry: Omit<NgrxLogEntry, 'seq'>, keep: Saved) => {
    const full = { ...entry, seq: ++seq };
    log.push(full);
    saved.set(full.seq, keep);
    while (log.length > MAX_LOG) saved.delete(log.shift()!.seq);
    onChange();
    return full;
  };

  const snapshot = (t: Tracked): Snapshot => {
    const out: Snapshot = {};
    for (const key of t.stateKeys) out[key] = peek(t.source[key]);
    return out;
  };

  const finish = (
    t: Tracked,
    type: string,
    args: unknown[] | undefined,
    before: Snapshot,
    logNoop = false,
  ) => {
    const after = snapshot(t);
    const changes = snapshotDiff(before, after, t.stateKeys);
    if (!changes.length) {
      if (!logNoop) return;
      const now = Date.now();
      if (now - (t.lastNoop.get(type) ?? 0) < NOOP_GAP_MS) return;
      t.lastNoop.set(type, now);
    }
    append(
      {
        source: 'signal-store',
        storeId: t.id,
        type,
        ...(args ? { args: args.map((a) => serialize(a, SMALL)) } : {}),
        timestamp: Date.now(),
        diff: changes,
        restorable: t.writable,
      },
      { kind: 'signal', tracked: t, after },
    );
  };

  const onWrite = (t: Tracked) => {
    if (t.depth > 0 || t.pendingBefore) return;
    t.pendingBefore = snapshot(t);
    queueMicrotask(() => {
      const before = t.pendingBefore;
      t.pendingBefore = null;
      if (before) finish(t, 'patchState', undefined, before);
    });
  };

  const wrapSignal = (t: Tracked, sig: AnyRecord) => {
    if (wrappedSignals.has(sig)) return;
    wrappedSignals.add(sig);
    for (const name of ['set', 'update'] as const) {
      const original = sig[name];
      if (typeof original !== 'function') continue;
      sig[name] = function (this: unknown, ...args: unknown[]) {
        onWrite(t);
        return original.apply(this, args);
      };
      t.undo.push(() => {
        sig[name] = original;
        wrappedSignals.delete(sig);
      });
    }
  };

  const wrapMethod = (t: Tracked, name: string) => {
    const instance = t.instance as AnyRecord;
    const original = instance[name];
    const info = { calls: 0, rx: typeof original?.destroy === 'function' };
    t.methods.set(name, info);
    const proxy = new Proxy(original, {
      apply(target, thisArg, args) {
        info.calls++;
        const outer = t.depth === 0;
        const before = outer ? snapshot(t) : null;
        t.depth++;
        try {
          return Reflect.apply(target, thisArg, args);
        } finally {
          t.depth--;
          if (before) finish(t, name, args, before, true);
        }
      },
    });
    const ok = read(() => {
      instance[name] = proxy;
      return instance[name] === proxy;
    }, false);
    if (ok) t.undo.push(() => read(() => (instance[name] = original), undefined));
  };

  const untrack = (value: object) => {
    const t = tracked.get(value);
    if (!t) return;
    tracked.delete(value);
    for (const fn of t.undo.splice(0).reverse()) fn();
  };

  const track = (value: object, scope: string, found: Set<object>): Tracked | null => {
    const source = stateSourceOf(value);
    if (!source) return null;
    found.add(value);
    const existing = tracked.get(value);
    if (existing) return existing;
    const stateKeys = Reflect.ownKeys(source);
    const t: Tracked = {
      id: idFor(value),
      instance: value,
      source,
      kind: typeof value === 'function' ? 'signal-state' : 'signal-store',
      className:
        typeof value === 'function'
          ? 'signalState'
          : className((value as object).constructor as { name?: string }),
      scope,
      stateKeys,
      methods: new Map(),
      references: new Set(),
      writable: stateKeys.every((k) => typeof source[k]?.set === 'function'),
      depth: 0,
      pendingBefore: null,
      lastNoop: new Map(),
      undo: [],
    };
    tracked.set(value, t);
    for (const key of stateKeys) wrapSignal(t, source[key]);
    if (t.kind === 'signal-store') {
      for (const key of Object.keys(value)) {
        const member = (value as AnyRecord)[key];
        if (typeof member === 'function' && !isSignal(member)) wrapMethod(t, key);
      }
    }
    return t;
  };

  const findClassic = (ng: NgrxDebugNg<H>, envs: Map<AnyRecord, string>, rootInjector: unknown) => {
    const want: Record<string, (v: AnyRecord) => boolean> = {
      Store: (v) => typeof v['dispatch'] === 'function' && typeof v['select'] === 'function',
      ScannedActionsSubject: (v) => typeof v['subscribe'] === 'function',
      ActionsSubject: (v) =>
        typeof v['subscribe'] === 'function' && typeof v['next'] === 'function',
      StoreDevtools: (v) =>
        typeof v['jumpToAction'] === 'function' || typeof v['jumpToState'] === 'function',
    };
    const out: Record<string, AnyRecord> = {};
    let scope = 'root';
    for (const [env, envName] of envs) {
      const tokens = new Set<unknown>();
      const records = read(() => env['records'] as Map<unknown, unknown> | undefined, undefined);
      if (records instanceof Map) for (const token of records.keys()) tokens.add(token);
      for (const p of read(() => ng.ɵgetInjectorProviders?.(env) ?? [], [])) tokens.add(p.token);
      for (const token of tokens) {
        const name = stripped(token);
        const accept = want[name];
        if (!accept || out[name]) continue;
        const from = (rootInjector ?? env) as AnyRecord;
        const value = read(() => from['get'](token, null), null) as AnyRecord | null;
        if (value && typeof value === 'object' && accept(value)) {
          out[name] = value;
          if (name === 'Store') scope = envName;
        }
      }
    }
    return out['Store'] ? { parts: out, scope } : null;
  };

  const classicState = (store: AnyRecord) => {
    const fromSource = syncValue(store['source']);
    return fromSource !== undefined ? fromSource : syncValue(store);
  };

  const attachClassic = ({
    parts: found,
    scope,
  }: {
    parts: Record<string, AnyRecord>;
    scope: string;
  }) => {
    const store = found['Store'];
    const devtools = found['StoreDevtools'] ?? null;
    const c: Classic = {
      store,
      devtools,
      scope,
      last: serialize(classicState(store)),
      stop: () => {},
    };
    const record = (action: unknown) => {
      const next = serialize(classicState(store));
      const changes = diff(c.last, next).map((entry) => ({
        ...entry,
        ...('before' in entry ? { before: serialize(entry.before, SMALL) } : {}),
        ...('after' in entry ? { after: serialize(entry.after, SMALL) } : {}),
      }));
      c.last = next;
      const type = read(() => String((action as AnyRecord)['type'] ?? 'action'), 'action');
      append(
        {
          source: 'store',
          storeId: 'store',
          type,
          action: serialize(action, { depth: 5, maxKeys: 50, maxString: 1000, budget: 2000 }),
          timestamp: Date.now(),
          diff: changes,
          restorable: !!devtools,
        },
        { kind: 'classic', action },
      );
    };
    const scanned = found['ScannedActionsSubject'];
    const actions = found['ActionsSubject'];
    let sub: AnyRecord | undefined;
    if (scanned) {
      sub = read(() => scanned['subscribe'](record), undefined);
    } else if (actions) {
      let first = true;
      sub = read(
        () =>
          actions['subscribe']((action: unknown) => {
            if (first) {
              first = false;
              return;
            }
            queueMicrotask(() => record(action));
          }),
        undefined,
      );
    }
    c.stop = () => read(() => sub?.['unsubscribe']?.(), undefined);
    return c;
  };

  let discovered = false;
  const discover = (ng: NgrxDebugNg<H>) => {
    const found = new Set<object>();
    const envs = new Map<AnyRecord, string>();
    const elements = componentElements(ng, tree);
    let rootInjector: unknown = null;

    const perElement: { el: H; injector: unknown; component: AnyRecord | null }[] = [];
    for (const el of elements) {
      const injector = read(() => ng.getInjector!(el), null);
      if (!injector) continue;
      rootInjector ??= injector;
      const path = read(() => ng.ɵgetInjectorResolutionPath?.(injector) ?? [], [] as unknown[]);
      for (const candidate of path) {
        const env = candidate as AnyRecord;
        if (env && !envs.has(env) && read(() => env['records'] instanceof Map, false)) {
          envs.set(env, envScope(ng, env));
        }
      }
      perElement.push({
        el,
        injector,
        component: read(() => (ng.getComponent?.(el) as AnyRecord) ?? null, null),
      });
    }

    for (const [env, scope] of envs) {
      const records = env['records'] as Map<unknown, AnyRecord | undefined>;
      for (const record of read(() => [...records.values()], [] as (AnyRecord | undefined)[])) {
        const value = record?.['value'];
        if (value && (typeof value === 'object' || typeof value === 'function')) {
          track(value, scope, found);
        }
      }
    }

    for (const { el, injector, component } of perElement) {
      const owner = component ? className(component.constructor) : tree.tag(el);
      for (const p of read(() => ng.ɵgetInjectorProviders?.(injector) ?? [], [])) {
        if (!/^SignalStore\d*$/.test(stripped(p.token))) continue;
        const value = read(
          () => (injector as AnyRecord)['get'](p.token, null, { self: true, optional: true }),
          null,
        );
        if (value && typeof value === 'object') track(value, `${owner} (component)`, found);
      }
    }

    for (const { component } of perElement) {
      if (!component) continue;
      const owner = className(component.constructor);
      for (const key of read(() => Object.keys(component), [] as string[])) {
        const value = read(() => component[key], undefined);
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) continue;
        const t = track(value, `${owner} (field)`, found);
        t?.references.add(`${owner}.${key}`);
      }
    }

    for (const key of [...tracked.keys()]) if (!found.has(key)) untrack(key);

    if (!classic && classicMisses < 5) {
      const found = findClassic(ng, envs, rootInjector);
      if (found) classic = attachClassic(found);
      else if (envs.size) classicMisses++;
    }
  };

  const report = () => {
    const stores = [...tracked.values()].map((t): NgrxSignalStoreInfo => {
      const state: Record<string, unknown> = {};
      for (const key of t.stateKeys) {
        state[String(key)] = serializeSlice(key, peek(t.source[key]));
      }
      const computed: Record<string, unknown> = {};
      if (t.kind === 'signal-store') {
        const stateNames = new Set(t.stateKeys.map(String));
        for (const key of Object.keys(t.instance)) {
          if (stateNames.has(key)) continue;
          const member = (t.instance as AnyRecord)[key];
          if (!isSignal(member)) continue;
          computed[key] = read(
            () => serializeSlice(key, untracked(member as () => unknown), { budget: 5000 }),
            {
              '@type': 'Error',
              message: 'Could not read',
            },
          );
        }
      }
      return {
        id: t.id,
        kind: t.kind,
        className: t.className,
        scope: t.scope,
        stateKeys: t.stateKeys.map(String),
        state,
        computed,
        methods: [...t.methods].map(([name, info]) => ({
          name,
          calls: info.calls,
          ...(info.rx ? { rx: true } : {}),
        })),
        references: [...t.references].sort(),
        writable: t.writable,
      };
    });

    return {
      stores,
      classic: classic
        ? {
            state: serialize(classicState(classic.store)),
            devtools: !!classic.devtools,
            scope: classic.scope,
          }
        : null,
    };
  };

  const collect = (rediscover = true) => {
    const ng = getNg();
    if (!ng?.getInjector) return { stores: [] as NgrxSignalStoreInfo[], classic: null };
    if (rediscover || !discovered) {
      discover(ng);
      discovered = true;
    }
    return report();
  };

  const run = (request: NgrxRequest): NgrxRequestResult => {
    if (!request || request.type !== 'restore' || typeof request.seq !== 'number') {
      return { error: 'Unknown request.' };
    }
    const entry = saved.get(request.seq);
    if (!entry) return { error: 'This change is no longer in the page history.' };
    if (entry.kind === 'signal') {
      const t = entry.tracked;
      if (!tracked.has(t.instance)) return { error: 'This store no longer exists on the page.' };
      if (!t.writable) return { error: 'This store state is read-only.' };
      const before = snapshot(t);
      const patch: Record<PropertyKey, unknown> = {};
      for (const key of t.stateKeys) {
        if (entry.after[key] !== peek(t.source[key])) patch[key] = entry.after[key];
      }
      const patchState = t.kind === 'signal-store' ? registeredPatchState() : null;
      t.depth++;
      try {
        if (patchState) {
          patchState(t.instance, patch);
        } else {
          for (const key of Reflect.ownKeys(patch)) t.source[key].set(patch[key]);
        }
      } finally {
        t.depth--;
      }
      if (patchState) {
        finish(t, `Restore #${request.seq}`, undefined, before);
        return { ok: true, message: `Restored the state after change #${request.seq}.` };
      }
      finish(t, `Restore #${request.seq} (watchState listeners not notified)`, undefined, before);
      return {
        ok: true,
        message: `Restored the state after change #${request.seq}. watchState listeners were not notified; call registerNgrxSignals({ patchState }) from @santoshyadavdev/ng-devtools/overlay in your app to have restore notify them.`,
      };
    }
    const devtools = classic?.devtools;
    if (!devtools) {
      return { error: 'Time travel for @ngrx/store needs provideStoreDevtools() in the app.' };
    }
    const lifted = syncValue(devtools['liftedState']) as AnyRecord | undefined;
    const actionsById = (lifted?.['actionsById'] ?? {}) as Record<string, AnyRecord>;
    const id = Object.keys(actionsById).find(
      (key) => actionsById[key]?.['action'] === entry.action,
    );
    if (id === undefined) return { error: 'Store DevTools no longer holds this action.' };
    if (typeof devtools['jumpToAction'] === 'function') devtools['jumpToAction'](Number(id));
    else {
      const index = ((lifted?.['stagedActionIds'] ?? []) as number[]).indexOf(Number(id));
      if (index < 0) return { error: 'Store DevTools no longer holds this action.' };
      devtools['jumpToState'](index);
    }
    return { ok: true, message: `Jumped to the state after action #${request.seq}.` };
  };

  return {
    collect,
    logSince: (after) => log.filter((entry) => entry.seq > after),
    lastSeq: () => seq,
    run,
    stop: () => {
      classic?.stop();
      for (const key of [...tracked.keys()]) untrack(key);
    },
  };
}
