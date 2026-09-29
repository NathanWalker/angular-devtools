import { componentHosts, hostPath, type ComponentDebugNg } from './component-tree.ts';
import { elementById, elementId } from './element-id.ts';
import { documentTree, type HostTree } from './host-tree.ts';
import { className } from './injector-tree.ts';
import { serializeNamed } from './serialize.ts';
import type { SignalGraph, SignalGraphEdge, SignalGraphNode, SignalNodeKind } from './types.ts';

export interface SignalDebugNg<H = Element> extends ComponentDebugNg<H> {
  ɵgetSignalGraph?(injector: unknown): {
    nodes: { id: string; kind?: string; label?: string; epoch?: number; value?: unknown }[];
    edges?: SignalGraphEdge[];
  } | null;
}

export type SignalTarget = { id: string } | { selector: string } | null;

const MAX_NODES = 400;
const MAX_FALLBACK_HOSTS = 50;
const VALUE_LIMITS = { depth: 4, keys: 40, items: 40, text: 500 };

function read<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function isComponentHost<H>(ng: SignalDebugNg<H>, el: H | null): el is H {
  return !!el && !!read(() => ng.getComponent?.(el), null);
}

export function toSignalTarget(request: unknown, pageId: string): SignalTarget | undefined {
  if (request === null || request === undefined) return null;
  if (typeof request === 'string') {
    return request && request.length < 500 ? { selector: request } : null;
  }
  if (typeof request !== 'object') return null;
  const { pageId: forPage, id } = request as { pageId?: unknown; id?: unknown };
  if (typeof forPage === 'string' && forPage && forPage !== pageId) return undefined;
  return typeof id === 'string' && id ? { id } : null;
}

function resolveTarget<H extends object>(target: SignalTarget, tree: HostTree<H>): H | null {
  if (!target) return null;
  if ('id' in target) {
    const host = elementById(target.id, (h) => tree.isHost(h) && tree.connected(h));
    return host && tree.isHost(host) ? host : null;
  }
  return tree.find(target.selector);
}

export function routedComponent<H extends object = Element>(
  ng: SignalDebugNg<H>,
  tree: HostTree<H> = documentTree(),
): H | null {
  return tree.routed?.((host) => isComponentHost(ng, host)) ?? null;
}

function signalNodeOf(value: unknown): { kind?: string; debugName?: string } | null {
  if (typeof value !== 'function') return null;
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    if (symbol.description === 'SIGNAL') {
      return (value as unknown as Record<symbol, { kind?: string; debugName?: string }>)[symbol];
    }
  }
  return null;
}

function linkedSignalReaders<H>(
  ng: SignalDebugNg<H>,
  instance: object,
): Map<string, () => unknown> {
  const readers = new Map<string, () => unknown>();
  for (const key of read(() => Object.keys(instance), [] as string[])) {
    const value = read(() => (instance as Record<string, unknown>)[key], undefined);
    if (typeof value !== 'function') continue;
    if (!read(() => ng.isSignal?.(value) ?? !!signalNodeOf(value), false)) continue;
    const node = signalNodeOf(value);
    if (node && node.kind !== 'linkedSignal') continue;
    const getter = value as () => unknown;
    if (node?.debugName && !readers.has(node.debugName)) readers.set(node.debugName, getter);
    if (!readers.has(key)) readers.set(key, getter);
  }
  return readers;
}

function graphFor<H extends object>(
  ng: SignalDebugNg<H>,
  el: H,
  tree: HostTree<H>,
  source: NonNullable<SignalGraph['source']>,
): SignalGraph | null {
  const instance = read(() => ng.getComponent?.(el), null);
  if (!instance || typeof instance !== 'object') return null;
  const injector = read(() => ng.getInjector?.(el), null);
  if (!injector) return null;
  const raw = read(() => ng.ɵgetSignalGraph?.(injector) ?? null, null);
  if (!raw || !Array.isArray(raw.nodes)) return null;

  let linked: Map<string, () => unknown> | null = null;
  const kept = raw.nodes.slice(0, MAX_NODES);
  const nodes = kept.map((n) => {
    const node: SignalGraphNode = {
      id: String(n.id),
      kind: (n.kind ?? 'unknown') as SignalNodeKind,
      epoch: n.epoch ?? 0,
    };
    if (n.label) node.label = n.label;
    if ('value' in n) {
      node.value = serializeNamed(n.label, n.value, VALUE_LIMITS);
    } else if (n.kind === 'linkedSignal' && n.label) {
      linked ??= linkedSignalReaders(ng, instance);
      const getter = linked.get(n.label);
      if (getter) node.value = serializeNamed(n.label, read(getter, undefined), VALUE_LIMITS);
    }
    return node;
  });
  const edges = (raw.edges ?? []).filter(
    (e) => e.consumer < kept.length && e.producer < kept.length,
  );
  const tag = tree.tag(el);
  return {
    nodes,
    edges,
    componentSelector: tag,
    component: {
      id: elementId(el),
      name: className((instance as { constructor: new () => unknown }).constructor),
      tag,
      path: hostPath(ng, el, tree),
    },
    source,
  };
}

export function collectSignalGraph<H extends object = Element>(
  ng: SignalDebugNg<H> | undefined,
  target: SignalTarget = null,
  tree: HostTree<H> = documentTree(),
): SignalGraph | null {
  if (!ng?.ɵgetSignalGraph || !ng.getInjector || !ng.getComponent) return null;
  const picked = resolveTarget(target, tree);
  if (isComponentHost(ng, picked)) {
    const graph = graphFor(ng, picked, tree, 'selected');
    if (graph) return graph;
  }
  const routed = routedComponent(ng, tree);
  if (routed) {
    const graph = graphFor(ng, routed, tree, 'routed');
    if (graph) return graph;
  }
  let empty: SignalGraph | null = null;
  for (const host of componentHosts(ng, tree, MAX_FALLBACK_HOSTS)) {
    const graph = graphFor(ng, host, tree, 'root');
    if (graph?.nodes.length) return graph;
    empty ??= graph;
  }
  return empty;
}

export function graphKey(graph: SignalGraph): string {
  const nodes = graph.nodes.map((n) => `${n.id}:${n.epoch}`).join(',');
  const edges = graph.edges.map((e) => `${e.consumer}>${e.producer}`).join(',');
  return `${graph.component?.id ?? ''}|${graph.source ?? ''}|${nodes}|${edges}`;
}
