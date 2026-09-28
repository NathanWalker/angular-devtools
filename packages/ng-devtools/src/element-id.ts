const ids = new WeakMap<Element, string>();
const byId = new Map<string, WeakRef<Element>>();
const load = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
let nextId = 0;

export function elementId(el: Element): string {
  let id = ids.get(el);
  if (!id) {
    id = `c${load}-${++nextId}`;
    ids.set(el, id);
  }
  if (!byId.has(id)) byId.set(id, new WeakRef(el));
  return id;
}

export function elementById(id: string): Element | null {
  const el = byId.get(id)?.deref();
  if (!el) {
    byId.delete(id);
    return null;
  }
  return el.isConnected ? el : null;
}

export function pruneElementIds() {
  for (const [id, ref] of byId) {
    const el = ref.deref();
    if (!el || !el.isConnected) byId.delete(id);
  }
}
