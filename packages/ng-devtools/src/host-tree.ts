/**
 * The tree Angular rendered into, as the collectors walk it. The browser
 * overlay walks the DOM; a platform without one, such as NativeScript,
 * describes its own views instead.
 */
export interface HostTree<H extends object> {
  /** Where a walk of the app starts, in render order. */
  roots(): H[];
  /** Direct children, in render order. */
  children(host: H): H[];
  parent(host: H): H | null;
  /** What the host is called in a component path: a tag name or a view type. */
  tag(host: H): string;
  /** Whether the host is still part of the rendered tree. */
  connected(host: H): boolean;
  /** Whether a value, such as an element injector's source, is a host of this tree. */
  isHost(value: unknown): value is H;
  /** A string that `find()` resolves back to the host. */
  selector(host: H): string;
  /** The host a selector names, or null when it names none or is not valid. */
  find(selector: string): H | null;
  /** The component the router rendered deepest in the primary outlet chain. */
  routed?(isComponentHost: (host: H) => boolean): H | null;
}

export function childElements(el: Element): Element[] {
  const children = Array.from(el.children);
  const shadow = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
  if (shadow) children.push(...Array.from(shadow.children));
  return children;
}

function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.parentNode;
  return root && 'host' in root ? ((root as ShadowRoot).host ?? null) : null;
}

export function angularRoots(doc: Document = document): Element[] {
  const tagged = Array.from(doc.querySelectorAll('[ng-version]'));
  const roots = tagged.filter((root) => !tagged.some((o) => o !== root && o.contains(root)));
  if (!doc.body) return roots;
  if (!roots.length) return [doc.body];
  const outside: Element[] = [];
  const collect = (el: Element) => {
    for (const child of childElements(el)) {
      if (roots.includes(child)) continue;
      if (roots.some((root) => child.contains(root))) collect(child);
      else outside.push(child);
    }
  };
  collect(doc.body);
  return [...roots, ...outside];
}

function isPrimaryOutlet(outlet: Element): boolean {
  const name = outlet.getAttribute('name');
  return !name || name === 'primary';
}

function outletBefore(el: Element): Element | null {
  const prev = el.previousElementSibling;
  return prev && prev.tagName === 'ROUTER-OUTLET' ? prev : null;
}

function routedElement(doc: Document, isComponentHost: (el: Element) => boolean): Element | null {
  let best: Element | null = null;
  let bestDepth = -1;
  for (const outlet of Array.from(doc.querySelectorAll('router-outlet'))) {
    if (!isPrimaryOutlet(outlet)) continue;
    const el = outlet.nextElementSibling;
    if (!el || !isComponentHost(el)) continue;
    let depth = 0;
    let primary = true;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const before = outletBefore(node);
      if (!before || !isComponentHost(node)) continue;
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

/** The DOM of `doc`. Selectors are cached, so take a fresh tree for each collection. */
export function domTree(doc: Document = document): HostTree<Element> {
  const selectors = new Map<Element, string>();
  const positions = new Map<Element, number>();
  const top = doc.documentElement;
  const selector = (el: Element): string => {
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
      const prefix = selector(parent);
      const part = `${tag}:nth-child(${positions.get(el)})`;
      out = prefix ? `${prefix} > ${part}` : part;
    }
    selectors.set(el, out);
    return out;
  };

  return {
    roots: () => angularRoots(doc),
    children: childElements,
    parent: parentOf,
    tag: (el) => el.tagName.toLowerCase(),
    connected: (el) => el.isConnected,
    isHost: (value): value is Element => typeof Element !== 'undefined' && value instanceof Element,
    selector,
    find: (query) => {
      try {
        return doc.querySelector(query);
      } catch {
        return null;
      }
    },
    routed: (isComponentHost) => routedElement(doc, isComponentHost),
  };
}

/** The DOM tree, for a collector whose host type is a parameter that defaults to Element. */
export function documentTree<H extends object>(): HostTree<H> {
  return domTree() as unknown as HostTree<H>;
}
