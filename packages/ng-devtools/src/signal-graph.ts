import { componentHosts, hostPath, type ComponentDebugNg } from './component-tree.ts';
import { elementById, elementId } from './element-id.ts';
import { className } from './injector-tree.ts';
import { serializeNamed } from './serialize.ts';
import type { SignalGraph, SignalGraphEdge, SignalGraphNode, SignalNodeKind } from './types.ts';

export interface SignalDebugNg extends ComponentDebugNg {
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

function isComponentHost(ng: SignalDebugNg, el: Element | null): el is Element {
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

function resolveTarget(target: SignalTarget, doc: Document): Element | null {
  if (!target) return null;
  if ('id' in target) return elementById(target.id);
  try {
    return doc.querySelector(target.selector);
  } catch {
    return null;
  }
}

function isPrimaryOutlet(outlet: Element): boolean {
  const name = outlet.getAttribute('name');
  return !name || name === 'primary';
}

function outletBefore(el: Element): Element | null {
  const prev = el.previousElementSibling;
  return prev && prev.tagName === 'ROUTER-OUTLET' ? prev : null;
}

export function routedComponent(ng: SignalDebugNg, doc: Document = document): Element | null {
  let best: Element | null = null;
  let bestDepth = -1;
  for (const outlet of Array.from(doc.querySelectorAll('router-outlet'))) {
    if (!isPrimaryOutlet(outlet)) continue;
    const el = outlet.nextElementSibling;
    if (!isComponentHost(ng, el)) continue;
    let depth = 0;
    let primary = true;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const before = outletBefore(node);
      if (!before || !isComponentHost(ng, node)) continue;
      if (!isPrimaryOutlet(before)) {
        primary = false;
        break;
      }
      depth++;
    }
    if (primary && depth > bestDepth) {
      best = el;
      bestDepth = depth;
    }
  }
  return best;
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

function linkedSignalReaders(ng: SignalDebugNg, instance: object): Map<string, () => unknown> {
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

function graphFor(
  ng: SignalDebugNg,
  el: Element,
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
  const tag = el.tagName.toLowerCase();
  return {
    nodes,
    edges,
    componentSelector: tag,
    component: {
      id: elementId(el),
      name: className((instance as { constructor: new () => unknown }).constructor),
      tag,
      path: hostPath(ng, el),
    },
    source,
  };
}

export function collectSignalGraph(
  ng: SignalDebugNg | undefined,
  target: SignalTarget = null,
  doc: Document = document,
): SignalGraph | null {
  if (!ng?.ɵgetSignalGraph || !ng.getInjector || !ng.getComponent) return null;
  const picked = resolveTarget(target, doc);
  if (isComponentHost(ng, picked)) {
    const graph = graphFor(ng, picked, 'selected');
    if (graph) return graph;
  }
  const routed = routedComponent(ng, doc);
  if (routed) {
    const graph = graphFor(ng, routed, 'routed');
    if (graph) return graph;
  }
  let empty: SignalGraph | null = null;
  for (const host of componentHosts(ng, doc, MAX_FALLBACK_HOSTS)) {
    const graph = graphFor(ng, host, 'root');
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
