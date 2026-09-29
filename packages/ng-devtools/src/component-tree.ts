import { elementById, elementId, pruneElementIds } from './element-id.ts';
import { documentTree, type HostTree } from './host-tree.ts';
import { className, dependenciesOf, type DebugNg } from './injector-tree.ts';
import { isSecretName, serializeNamed } from './serialize.ts';
import type {
  ComponentDetail,
  ComponentProp,
  ComponentTreeReport,
  LiveComponentNode,
} from './types.ts';

export interface ComponentDebugNg<H = Element> extends DebugNg<H> {
  getComponent?(el: H): unknown;
  getDirectives?(el: H): unknown[];
  getDirectiveMetadata?(instance: unknown): {
    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    changeDetection?: number;
    encapsulation?: number;
  } | null;
  getListeners?(el: H): { name: string; type?: string }[];
  isSignal?(value: unknown): boolean;
}

const MAX_COMPONENTS = 2000;
const MAX_DEPTH = 256;
const MAX_PROPS = 60;
const VALUE_LIMITS = { depth: 3, keys: 30, items: 30, text: 300 };

const CHANGE_DETECTION: Record<number, string> = { 0: 'OnPush', 1: 'Default' };
const ENCAPSULATION: Record<number, string> = {
  0: 'Emulated',
  2: 'None',
  3: 'ShadowDom',
  4: 'IsolatedShadowDom',
};

function read<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function nameOf(instance: unknown): string {
  const ctor = (instance as { constructor?: unknown } | null)?.constructor;
  return typeof ctor === 'function' ? className(ctor) : 'Anonymous';
}

function componentAt<H>(ng: ComponentDebugNg<H>, el: H): object | null {
  const found = read(() => ng.getComponent?.(el) ?? null, null);
  return found && typeof found === 'object' ? found : null;
}

function directivesAt<H>(ng: ComponentDebugNg<H>, el: H): object[] {
  const found = read(() => ng.getDirectives?.(el) ?? [], [] as unknown[]);
  return found.filter((d): d is object => !!d && typeof d === 'object');
}

export function componentHosts<H extends object = Element>(
  ng: ComponentDebugNg<H>,
  tree: HostTree<H> = documentTree(),
  limit = MAX_COMPONENTS,
): H[] {
  const out: H[] = [];
  const visit = (el: H, depth: number) => {
    if (out.length >= limit || depth > MAX_DEPTH) return;
    if (componentAt(ng, el)) out.push(el);
    for (const child of tree.children(el)) visit(child, depth + 1);
  };
  for (const root of tree.roots()) visit(root, 0);
  return out;
}

export function hostPath<H extends object = Element>(
  ng: ComponentDebugNg<H>,
  el: H,
  tree: HostTree<H> = documentTree(),
): string {
  const parts: string[] = [];
  for (let node: H | null = el; node; node = tree.parent(node)) {
    if (!componentAt(ng, node)) continue;
    const tag = tree.tag(node);
    const parent = tree.parent(node);
    const twins = parent ? tree.children(parent).filter((c) => tree.tag(c) === tag) : [];
    parts.unshift(twins.length > 1 ? `${tag}[${twins.indexOf(node) + 1}]` : tag);
  }
  return parts.join(' > ');
}

function unwrap<H>(ng: ComponentDebugNg<H>, value: unknown): unknown {
  if (typeof value !== 'function') return value;
  const signal = read(() => !!ng.isSignal?.(value), false);
  return signal ? read(() => (value as () => unknown)(), undefined) : value;
}

function propName(entry: unknown, fallback: string): string {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry) && typeof entry[0] === 'string') return entry[0];
  return fallback;
}

function readInputs<H>(
  ng: ComponentDebugNg<H>,
  instance: object,
  inputs: Record<string, unknown> | undefined,
): ComponentProp[] {
  return Object.entries(inputs ?? {})
    .slice(0, MAX_PROPS)
    .map(([name, entry]) => {
      const prop = propName(entry, name);
      const raw = read(() => (instance as Record<string, unknown>)[prop], undefined);
      const key = isSecretName(prop) ? prop : name;
      return { name, prop, value: serializeNamed(key, unwrap(ng, raw), VALUE_LIMITS) };
    });
}

function readOutputs(
  outputs: Record<string, unknown> | undefined,
  listened: Set<string>,
): ComponentProp[] {
  return Object.entries(outputs ?? {})
    .slice(0, MAX_PROPS)
    .map(([name, entry]) => ({ name, prop: propName(entry, name), listened: listened.has(name) }));
}

export function componentDetail<H extends object = Element>(
  ng: ComponentDebugNg<H>,
  el: H,
  tree: HostTree<H> = documentTree(),
): ComponentDetail | null {
  const instance = componentAt(ng, el);
  if (!instance) return null;
  const meta = read(() => ng.getDirectiveMetadata?.(instance) ?? null, null);
  const listeners = read(
    () => ng.getListeners?.(el) ?? [],
    [] as { name: string; type?: string }[],
  );
  const listened = new Set(listeners.filter((l) => l.type === 'output').map((l) => l.name));
  const dom = [...new Set(listeners.filter((l) => l.type !== 'output').map((l) => l.name))];
  const directives = directivesAt(ng, el).filter((d) => d !== instance);

  const detail: ComponentDetail = {
    id: elementId(el),
    name: nameOf(instance),
    tag: tree.tag(el),
    path: hostPath(ng, el, tree),
    inputs: readInputs(ng, instance, meta?.inputs),
    outputs: readOutputs(meta?.outputs, listened),
    listeners: dom.slice(0, MAX_PROPS),
    directives: directives.map((directive) => {
      const dirMeta = read(() => ng.getDirectiveMetadata?.(directive) ?? null, null);
      return {
        name: nameOf(directive),
        inputs: readInputs(ng, directive, dirMeta?.inputs),
        outputs: readOutputs(dirMeta?.outputs, listened),
      };
    }),
    dependencies: [],
  };
  const cd = meta?.changeDetection;
  if (typeof cd === 'number' && CHANGE_DETECTION[cd]) detail.changeDetection = CHANGE_DETECTION[cd];
  const enc = meta?.encapsulation;
  if (typeof enc === 'number' && ENCAPSULATION[enc]) detail.encapsulation = ENCAPSULATION[enc];

  const injector = read(() => ng.getInjector?.(el) ?? null, null);
  if (injector) {
    detail.dependencies = dependenciesOf(ng, injector, [instance.constructor], true, tree);
  }
  return detail;
}

export function collectComponentTree<H extends object = Element>(
  ng: ComponentDebugNg<H> | undefined,
  options: { tree?: HostTree<H>; selectedId?: string | null } = {},
): Omit<ComponentTreeReport, 'pageId'> {
  const tree = options.tree ?? documentTree<H>();
  const report: Omit<ComponentTreeReport, 'pageId'> = { roots: [], count: 0, detail: null };
  if (!ng?.getComponent) return report;

  const visit = (el: H, out: LiveComponentNode[], depth: number) => {
    if (depth > MAX_DEPTH) {
      report.truncated = true;
      return;
    }
    const instance = componentAt(ng, el);
    let target = out;
    if (instance) {
      if (report.count >= MAX_COMPONENTS) {
        report.truncated = true;
        return;
      }
      report.count++;
      const node: LiveComponentNode = {
        id: elementId(el),
        name: nameOf(instance),
        tag: tree.tag(el),
        children: [],
      };
      const directives = directivesAt(ng, el)
        .filter((d) => d !== instance)
        .map(nameOf);
      if (directives.length) node.directives = directives;
      out.push(node);
      target = node.children;
    }
    for (const child of tree.children(el)) visit(child, target, depth + 1);
  };
  for (const root of tree.roots()) visit(root, report.roots, 0);

  const connected = (host: object) => tree.isHost(host) && tree.connected(host);
  pruneElementIds(connected);
  const selected = options.selectedId ? elementById(options.selectedId, connected) : null;
  if (selected && tree.isHost(selected)) report.detail = componentDetail(ng, selected, tree);
  return report;
}
