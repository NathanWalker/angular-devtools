import type {
  DependencyInfo,
  InjectorInfo,
  InjectorTreeNode,
  InjectorTreeReport,
  ProviderInfo,
} from './types.ts';

interface ProviderRecord {
  token: unknown;
  provider: unknown;
  isViewProvider?: boolean;
  importPath?: unknown[];
}

export interface DebugNg {
  getInjector?(el: Element): unknown;
  getComponent?(el: Element): unknown;
  getDirectives?(el: Element): unknown[];
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

function toProviders(ng: DebugNg, injector: unknown): ProviderInfo[] {
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

function selectorCache(doc: Document) {
  const selectors = new Map<Element, string>();
  const positions = new Map<Element, number>();
  const top = doc.documentElement;
  const selectorOf = (el: Element): string => {
    if (el === top) return '';
    const known = selectors.get(el);
    if (known !== undefined) return known;
    const parent = el.parentElement;
    const tag = el.tagName.toLowerCase();
    let out = tag;
    if (parent) {
      if (!positions.has(el)) {
        let index = 0;
        for (const child of Array.from(parent.children)) positions.set(child, ++index);
      }
      const prefix = selectorOf(parent);
      const part = `${tag}:nth-child(${positions.get(el)})`;
      out = prefix ? `${prefix} > ${part}` : part;
    }
    selectors.set(el, out);
    return out;
  };
  return selectorOf;
}

function environmentName(injector: unknown, source: unknown): string {
  const scopes = (injector as { scopes?: Set<string> } | null)?.scopes;
  if (scopes?.has('platform')) return 'Platform';
  if (scopes?.has('root')) return 'Root';
  if (typeof source === 'string' && source) return source;
  return 'Environment';
}

export const NULL_INJECTOR_ID = 'inj-null';

export function injectorRef(ng: DebugNg, injector: unknown): { id: string; name: string } | null {
  if (!injector || typeof injector !== 'object') return null;
  let meta: { type: string; source: unknown } | null = null;
  try {
    meta = ng.ɵgetInjectorMetadata?.(injector) ?? null;
  } catch {
    return null;
  }
  if (meta?.type === 'element') {
    return meta.source instanceof Element
      ? { id: idFor(meta.source), name: `<${meta.source.tagName.toLowerCase()}>` }
      : null;
  }
  if (meta?.type === 'null') return { id: NULL_INJECTOR_ID, name: 'Null injector' };
  return { id: idFor(injector), name: environmentName(injector, meta?.source) };
}

export function dependenciesOf(
  ng: DebugNg,
  injector: unknown,
  owners: Iterable<unknown>,
  withNames = false,
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
        const by = dep.providedIn ? injectorRef(ng, dep.providedIn) : null;
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

const elementEntries = new WeakMap<Element, ElementEntry>();

function environmentsOf(ng: DebugNg, path: unknown[]): object[] {
  return path.filter((injector) => {
    try {
      return ng.ɵgetInjectorMetadata!(injector)?.type === 'environment';
    } catch {
      return false;
    }
  }) as object[];
}

function readElement(ng: DebugNg, el: Element): ElementEntry | null {
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
    name: el.tagName.toLowerCase(),
    providerCount: providers.length,
    directives: [...owners].map(className),
    path: path
      .map((entry) => injectorRef(ng, entry)?.id ?? null)
      .filter((id): id is string => !!id),
  };
  if (typeof componentCtor === 'function') info.component = className(componentCtor);
  const entry: ElementEntry = {
    info,
    providers,
    dependencies: dependenciesOf(ng, injector, owners),
    environments: environmentsOf(ng, path),
  };
  elementEntries.set(el, entry);
  return entry;
}

export function collectInjectorTree(
  ng: DebugNg | undefined,
  doc: Document = document,
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

  const selectorOf = selectorCache(doc);
  const elementNodes = new Map<Element, InjectorTreeNode>();
  const roots: InjectorTreeNode[] = [];
  let truncated = false;
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, 1);

  for (
    let el = walker.currentNode as Element | null;
    el;
    el = walker.nextNode() as Element | null
  ) {
    const entry = readElement(ng, el);
    if (!entry) continue;
    if (elementNodes.size >= MAX_INJECTOR_NODES) {
      truncated = true;
      break;
    }
    noteEnvironment(entry.environments);

    const node: InjectorTreeNode = {
      injector: { ...entry.info, selector: selectorOf(el) },
      providers: entry.providers,
      children: [],
      dependencies: entry.dependencies,
    };
    elementNodes.set(el, node);

    let parent: Element | null = el.parentElement;
    while (parent && !elementNodes.has(parent)) parent = parent.parentElement;
    if (parent) elementNodes.get(parent)!.children.push(node);
    else roots.push(node);
  }

  const environment: InjectorTreeNode[] = [];
  for (const env of envs.values()) {
    const parent = env.parent ? envs.get(env.parent) : undefined;
    if (parent) parent.node.children.push(env.node);
    else environment.push(env.node);
  }

  return truncated ? { roots, environment, truncated } : { roots, environment };
}
