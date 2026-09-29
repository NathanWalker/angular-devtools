import type {
  DependencyInfo,
  InjectorInfo,
  InjectorTreeNode,
  InjectorTreeReport,
  ProviderInfo,
} from './types.ts';
import { documentTree, type HostTree } from './host-tree.ts';

interface ProviderRecord {
  token: unknown;
  provider: unknown;
  isViewProvider?: boolean;
  importPath?: unknown[];
}

export interface DebugNg<H = Element> {
  getInjector?(el: H): unknown;
  getComponent?(el: H): unknown;
  getDirectives?(el: H): unknown[];
  ɵgetInjectorMetadata?(injector: unknown): { type: string; source: unknown } | null;
  ɵgetInjectorProviders?(injector: unknown): ProviderRecord[];
  ɵgetInjectorResolutionPath?(injector: unknown): unknown[];
  ɵgetDependenciesFromInjectable?(
    injector: unknown,
    token: unknown,
  ): {
    dependencies: {
      token?: unknown;
      flags?: { optional?: boolean; host?: boolean; self?: boolean; skipSelf?: boolean };
      providedIn?: unknown;
    }[];
  };
}

const ids = new WeakMap<object, string>();
let nextId = 0;

function idFor(key: object): string {
  let id = ids.get(key);
  if (!id) {
    id = `inj-${++nextId}`;
    ids.set(key, id);
  }
  return id;
}

export function className(
  ctor: { readonly name?: string } | (abstract new (...args: never[]) => unknown),
): string {
  return (ctor.name || 'anonymous class').replace(/^_(?=[A-Z])/, '');
}

export function tokenName(token: unknown): string {
  if (typeof token === 'function') return className(token);
  if (token && typeof token === 'object') {
    const desc = (token as { _desc?: unknown })._desc;
    if (typeof desc === 'string' && desc) return desc;
    const text = String(token);
    return text.startsWith('InjectionToken ') ? text.slice('InjectionToken '.length) : text;
  }
  return String(token);
}

export function providerKind(provider: unknown): ProviderInfo['type'] {
  if (typeof provider === 'function') return 'class';
  if (!provider || typeof provider !== 'object') return 'unknown';
  if ('useValue' in provider) return 'value';
  if ('useFactory' in provider) return 'factory';
  if ('useExisting' in provider) return 'existing';
  if ('useClass' in provider) return 'class';
  return 'unknown';
}

function isBuiltInElementToken(record: ProviderRecord): boolean {
  const token = record.token as { __NG_ELEMENT_ID__?: unknown } | null;
  return record.provider === record.token && !!token && '__NG_ELEMENT_ID__' in token;
}

function toProviders<H>(ng: DebugNg<H>, injector: unknown): ProviderInfo[] {
  let records: ProviderRecord[];
  try {
    records = ng.ɵgetInjectorProviders?.(injector) ?? [];
  } catch {
    return [];
  }
  return records
    .filter((record) => !isBuiltInElementToken(record))
    .map((record) => {
      const info: ProviderInfo = {
        token: tokenName(record.token),
        type: providerKind(record.provider),
        isViewProvider: !!record.isViewProvider,
      };
      const multi = (record.provider as { multi?: unknown } | null)?.multi;
      if (multi === true) info.multi = true;
      if (record.importPath?.length) info.importPath = record.importPath.map(tokenName);
      return info;
    });
}

function environmentName(injector: unknown, source: unknown): string {
  const scopes = (injector as { scopes?: Set<string> } | null)?.scopes;
  if (scopes?.has('platform')) return 'Platform';
  if (scopes?.has('root')) return 'Root';
  if (typeof source === 'string' && source) return source;
  return 'Environment';
}

export const NULL_INJECTOR_ID = 'inj-null';

export function injectorRef<H extends object = Element>(
  ng: DebugNg<H>,
  injector: unknown,
  tree: HostTree<H> = documentTree(),
): { id: string; name: string } | null {
  if (!injector || typeof injector !== 'object') return null;
  let meta: { type: string; source: unknown } | null = null;
  try {
    meta = ng.ɵgetInjectorMetadata?.(injector) ?? null;
  } catch {
    return null;
  }
  if (meta?.type === 'element') {
    return tree.isHost(meta.source)
      ? { id: idFor(meta.source), name: `<${tree.tag(meta.source)}>` }
      : null;
  }
  if (meta?.type === 'null') return { id: NULL_INJECTOR_ID, name: 'Null injector' };
  return { id: idFor(injector), name: environmentName(injector, meta?.source) };
}

export function dependenciesOf<H extends object = Element>(
  ng: DebugNg<H>,
  injector: unknown,
  owners: Iterable<unknown>,
  withNames = false,
  tree: HostTree<H> = documentTree(),
): DependencyInfo[] {
  const out: DependencyInfo[] = [];
  for (const ctor of owners) {
    if (typeof ctor !== 'function') continue;
    try {
      const result = ng.ɵgetDependenciesFromInjectable?.(injector, ctor);
      for (const dep of result?.dependencies ?? []) {
        if (dep.token === undefined) continue;
        const flags = Object.entries(dep.flags ?? {})
          .filter(([, on]) => on)
          .map(([flag]) => flag);
        const by = dep.providedIn ? injectorRef(ng, dep.providedIn, tree) : null;
        const info: DependencyInfo = {
          from: className(ctor),
          token: tokenName(dep.token),
          flags,
          providedBy: by?.id ?? null,
        };
        if (withNames && by) info.providedByName = by.name;
        out.push(info);
      }
    } catch {
      continue;
    }
  }
  return out;
}

interface Env {
  node: InjectorTreeNode;
  parent: object | null;
}

interface ElementEntry {
  info: Omit<InjectorInfo, 'selector'>;
  providers: ProviderInfo[];
  dependencies: DependencyInfo[];
  environments: object[];
}

export const MAX_INJECTOR_NODES = 2000;

const elementEntries = new WeakMap<object, ElementEntry>();

function environmentsOf<H>(ng: DebugNg<H>, path: unknown[]): object[] {
  return path.filter((injector) => {
    try {
      return ng.ɵgetInjectorMetadata!(injector)?.type === 'environment';
    } catch {
      return false;
    }
  }) as object[];
}

function readElement<H extends object>(
  ng: DebugNg<H>,
  el: H,
  tree: HostTree<H>,
): ElementEntry | null {
  const cached = elementEntries.get(el);
  if (cached) return cached;
  let component: unknown = null;
  let directives: unknown[] = [];
  try {
    component = ng.getComponent?.(el) ?? null;
    directives = ng.getDirectives?.(el) ?? [];
  } catch {
    return null;
  }
  if (!component && directives.length === 0) return null;

  let injector: unknown;
  try {
    injector = ng.getInjector!(el);
  } catch {
    return null;
  }
  if (!injector) return null;

  let path: unknown[] = [];
  try {
    path = ng.ɵgetInjectorResolutionPath?.(injector) ?? [];
  } catch {
    path = [];
  }

  const providers = toProviders(ng, injector);
  const owners = new Set(
    [component, ...directives]
      .map((owner) => (owner as { constructor?: unknown } | null)?.constructor)
      .filter((ctor): ctor is new () => unknown => typeof ctor === 'function' && ctor !== Object),
  );
  const componentCtor = (component as { constructor?: unknown } | null)?.constructor;
  const info: Omit<InjectorInfo, 'selector'> = {
    id: idFor(el),
    type: 'element',
    name: tree.tag(el),
    providerCount: providers.length,
    directives: [...owners].map(className),
    path: path
      .map((entry) => injectorRef(ng, entry, tree)?.id ?? null)
      .filter((id): id is string => !!id),
  };
  if (typeof componentCtor === 'function') info.component = className(componentCtor);
  const entry: ElementEntry = {
    info,
    providers,
    dependencies: dependenciesOf(ng, injector, owners, false, tree),
    environments: environmentsOf(ng, path),
  };
  elementEntries.set(el, entry);
  return entry;
}

export function collectInjectorTree<H extends object = Element>(
  ng: DebugNg<H> | undefined,
  tree: HostTree<H> = documentTree(),
): InjectorTreeReport & { truncated?: boolean } {
  const empty: InjectorTreeReport = { roots: [], environment: [] };
  if (!ng?.getInjector || !ng.ɵgetInjectorMetadata) return empty;

  const envs = new Map<object, Env>();
  const noteEnvironment = (chain: object[]) => {
    chain.forEach((injector, index) => {
      if (envs.has(injector)) return;
      let meta: { type: string; source: unknown } | null = null;
      try {
        meta = ng.ɵgetInjectorMetadata!(injector);
      } catch {
        meta = null;
      }
      const providers = toProviders(ng, injector);
      envs.set(injector, {
        parent: chain[index + 1] ?? null,
        node: {
          injector: {
            id: idFor(injector),
            type: 'environment',
            name: environmentName(injector, meta?.source),
            providerCount: providers.length,
          },
          providers,
          children: [],
        },
      });
    });
  };

  const roots: InjectorTreeNode[] = [];
  let count = 0;
  let truncated = false;
  // Depth first in render order; each entry carries the list its nearest
  // injector-bearing ancestor collects children into.
  const stack: { el: H; into: InjectorTreeNode[] }[] = tree
    .roots()
    .map((el) => ({ el, into: roots }))
    .reverse();

  while (stack.length) {
    const { el, into } = stack.pop()!;
    let childrenInto = into;
    const entry = readElement(ng, el, tree);
    if (entry) {
      if (count >= MAX_INJECTOR_NODES) {
        truncated = true;
        break;
      }
      count++;
      noteEnvironment(entry.environments);
      const node: InjectorTreeNode = {
        injector: { ...entry.info, selector: tree.selector(el) },
        providers: entry.providers,
        children: [],
        dependencies: entry.dependencies,
      };
      into.push(node);
      childrenInto = node.children;
    }
    const children = tree.children(el);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ el: children[i], into: childrenInto });
    }
  }

  const environment: InjectorTreeNode[] = [];
  for (const env of envs.values()) {
    const parent = env.parent ? envs.get(env.parent) : undefined;
    if (parent) parent.node.children.push(env.node);
    else environment.push(env.node);
  }

  return truncated ? { roots, environment, truncated } : { roots, environment };
}
