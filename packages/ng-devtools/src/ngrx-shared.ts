import { isSecretKey, REDACTED } from './forms-privacy.ts';

export interface NgrxSignalStoreInfo {
  id: string;
  kind: 'signal-store' | 'signal-state';
  className: string;
  name?: string;
  declaredIn?: string;
  scope: string;
  stateKeys: string[];
  state: Record<string, unknown>;
  computed: Record<string, unknown>;
  methods: { name: string; calls: number; rx?: boolean }[];
  references: string[];
  writable: boolean;
}

export interface NgrxClassicStoreInfo {
  state: unknown;
  devtools: boolean;
  scope: string;
}

export interface NgrxDiffEntry {
  path: string;
  op: 'add' | 'remove' | 'change';
  before?: unknown;
  after?: unknown;
}

export interface NgrxLogEntry {
  seq: number;
  source: 'signal-store' | 'store';
  storeId: string;
  type: string;
  args?: unknown[];
  action?: unknown;
  timestamp: number;
  diff: NgrxDiffEntry[];
  restorable: boolean;
}

export interface NgrxPageReport {
  pageId: string;
  session: string;
  url: string;
  title: string;
  stores: NgrxSignalStoreInfo[];
  classic: NgrxClassicStoreInfo | null;
  log: NgrxLogEntry[];
}

export interface NgrxPage extends Omit<NgrxPageReport, 'session'> {
  reportedAt: number;
}

export interface NgrxState {
  pages: NgrxPage[];
}

export type NgrxRequest = { type: 'restore'; seq: number };

export interface NgrxRequestResult {
  ok?: boolean;
  message?: string;
  error?: string;
}

export interface SerializeOptions {
  depth?: number;
  maxKeys?: number;
  maxString?: number;
  budget?: number;
}

export const TYPE_KEY = '@type';

export function serialize(value: unknown, options: SerializeOptions = {}): unknown {
  const maxDepth = options.depth ?? 8;
  const maxKeys = options.maxKeys ?? 100;
  const maxString = options.maxString ?? 2000;
  let budget = options.budget ?? 20_000;
  const seen = new WeakSet<object>();

  const walk = (val: unknown, depth: number): unknown => {
    if (--budget < 0) return '[Truncated]';
    if (val === null) return null;
    switch (typeof val) {
      case 'undefined':
        return { [TYPE_KEY]: 'undefined' };
      case 'string':
        return val.length > maxString ? `${val.slice(0, maxString)}…` : val;
      case 'number':
        return Number.isFinite(val) ? val : { [TYPE_KEY]: 'number', value: String(val) };
      case 'boolean':
        return val;
      case 'bigint':
        return { [TYPE_KEY]: 'bigint', value: val.toString() };
      case 'symbol':
        return { [TYPE_KEY]: 'symbol', value: val.description ?? '' };
      case 'function':
        return { [TYPE_KEY]: 'function', name: val.name || 'anonymous' };
    }
    const obj = val as object;
    if (seen.has(obj)) return '[Circular]';
    if (obj instanceof Date) {
      return {
        [TYPE_KEY]: 'Date',
        value: Number.isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString(),
      };
    }
    if (obj instanceof RegExp) return { [TYPE_KEY]: 'RegExp', value: String(obj) };
    if (obj instanceof Error) return { [TYPE_KEY]: 'Error', name: obj.name, message: obj.message };
    if (depth >= maxDepth) {
      if (Array.isArray(obj)) return `[Array(${obj.length})]`;
      if (obj instanceof Map) return `[Map(${obj.size})]`;
      if (obj instanceof Set) return `[Set(${obj.size})]`;
      return '[Object]';
    }
    seen.add(obj);
    try {
      if (Array.isArray(obj)) {
        const out = obj.slice(0, maxKeys).map((item) => walk(item, depth + 1));
        if (obj.length > maxKeys) out.push(`[${obj.length - maxKeys} more]`);
        return out;
      }
      if (obj instanceof Map) {
        const entries = [...obj.entries()]
          .slice(0, maxKeys)
          .map(([k, v]) => [
            walk(k, depth + 1),
            typeof k === 'string' && isSecretKey(k) ? REDACTED : walk(v, depth + 1),
          ]);
        return { [TYPE_KEY]: 'Map', size: obj.size, entries };
      }
      if (obj instanceof Set) {
        const values = [...obj].slice(0, maxKeys).map((v) => walk(v, depth + 1));
        return { [TYPE_KEY]: 'Set', size: obj.size, values };
      }
      if (typeof Element !== 'undefined' && obj instanceof Element) {
        return { [TYPE_KEY]: 'Element', value: obj.tagName.toLowerCase() };
      }
      const out: Record<string, unknown> = {};
      const keys = Object.keys(obj);
      for (const key of keys.slice(0, maxKeys)) {
        if (isSecretKey(key)) {
          out[key] = REDACTED;
          continue;
        }
        let item: unknown;
        try {
          item = (obj as Record<string, unknown>)[key];
        } catch {
          item = '[Unreadable]';
        }
        out[key] = walk(item, depth + 1);
      }
      if (keys.length > maxKeys) out['…'] = `${keys.length - maxKeys} more keys`;
      return out;
    } finally {
      seen.delete(obj);
    }
  };

  return walk(value, 0);
}

export function serializeSlice(
  key: PropertyKey,
  value: unknown,
  options: SerializeOptions = {},
): unknown {
  return typeof key === 'string' && isSecretKey(key) ? REDACTED : serialize(value, options);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  const safe = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
  if (!path) return safe;
  return safe.startsWith('"') ? `${path}[${safe}]` : `${path}.${safe}`;
}

export function diff(before: unknown, after: unknown, limit = 50, maxDepth = 6): NgrxDiffEntry[] {
  const out: NgrxDiffEntry[] = [];
  const walk = (a: unknown, b: unknown, path: string, depth: number) => {
    if (out.length >= limit || same(a, b)) return;
    const bothArrays = Array.isArray(a) && Array.isArray(b);
    const bothObjects = isPlain(a) && isPlain(b) && !(TYPE_KEY in a) && !(TYPE_KEY in b);
    if (depth >= maxDepth || (!bothArrays && !bothObjects)) {
      out.push({ path: path || '(root)', op: 'change', before: a, after: b });
      return;
    }
    if (bothArrays) {
      const x = a as unknown[];
      const y = b as unknown[];
      for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if (i >= x.length) out.push({ path: join(path, i), op: 'add', after: y[i] });
        else if (i >= y.length) out.push({ path: join(path, i), op: 'remove', before: x[i] });
        else walk(x[i], y[i], join(path, i), depth + 1);
        if (out.length >= limit) return;
      }
      return;
    }
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (!(key in y)) out.push({ path: join(path, key), op: 'remove', before: x[key] });
      else if (!(key in x)) out.push({ path: join(path, key), op: 'add', after: y[key] });
      else walk(x[key], y[key], join(path, key), depth + 1);
      if (out.length >= limit) return;
    }
  };
  walk(before, after, '', 0);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function field(value: Record<string, unknown> | unknown[], key: string | number): unknown {
  try {
    return (value as Record<string | number, unknown>)[key];
  } catch {
    return undefined;
  }
}

export function referenceDiff(
  before: unknown,
  after: unknown,
  path: string,
  options: SerializeOptions,
  limit = 50,
  maxDepth = 12,
): NgrxDiffEntry[] {
  const out: NgrxDiffEntry[] = [];
  const show = (value: unknown) => serialize(value, options);
  const walk = (a: unknown, b: unknown, at: string, depth: number) => {
    if (out.length >= limit || Object.is(a, b)) return;
    const arrays = Array.isArray(a) && Array.isArray(b);
    const records = isRecord(a) && isRecord(b);
    if (depth >= maxDepth || (!arrays && !records)) {
      out.push({ path: at, op: 'change', before: show(a), after: show(b) });
      return;
    }
    const start = out.length;
    if (arrays) {
      const x = a as unknown[];
      const y = b as unknown[];
      for (let i = 0; i < Math.max(x.length, y.length) && out.length < limit; i++) {
        if (i >= x.length) out.push({ path: join(at, i), op: 'add', after: show(field(y, i)) });
        else if (i >= y.length) {
          out.push({ path: join(at, i), op: 'remove', before: show(field(x, i)) });
        } else walk(field(x, i), field(y, i), join(at, i), depth + 1);
      }
    } else {
      const x = a as Record<string, unknown>;
      const y = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (out.length >= limit) break;
        const secret = isSecretKey(key);
        if (!(key in y)) {
          out.push({
            path: join(at, key),
            op: 'remove',
            before: secret ? REDACTED : show(field(x, key)),
          });
        } else if (!(key in x)) {
          out.push({
            path: join(at, key),
            op: 'add',
            after: secret ? REDACTED : show(field(y, key)),
          });
        } else if (secret) {
          if (!Object.is(field(x, key), field(y, key))) {
            out.push({ path: join(at, key), op: 'change', before: REDACTED, after: REDACTED });
          }
        } else walk(field(x, key), field(y, key), join(at, key), depth + 1);
      }
    }
    if (out.length === start) out.push({ path: at, op: 'change', before: show(a), after: show(b) });
  };
  walk(before, after, path, 0);
  return out;
}
