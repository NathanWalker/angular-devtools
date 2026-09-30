import type { IncomingMessage, ServerResponse } from 'node:http';
import { isCustomSecretKey } from './forms-privacy.ts';

const SECRET_WORDS =
  /^(password|passwd|passphrase|passcode|pass|pwd|secret|token|otp|pin|cvv|cvc|ssn|iban|card|credential|cookie|session|authorization|auth|apikey|jwt)s?$/;
const JWT = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g;
const BEARER = /\bBearer\s+[\w.~+/=-]+/gi;
const SECRET_QUERY = /([?&][^=&#]*(?:token|secret|password|key|code|session)[^=&#]*=)[^&#]*/gi;

export function isSecretKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((word) => SECRET_WORDS.test(word)) || SECRET_WORDS.test(words.join(''));
}

export function redactMessage(text: string): string {
  return text
    .replace(JWT, '[redacted]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(SECRET_QUERY, '$1[redacted]');
}

export type AnalogCallKind = 'load' | 'fn' | 'api' | 'page';

export interface AnalogCall {
  id: number;
  at: number;
  kind: AnalogCallKind;
  method: string;
  url: string;
  route?: string;
  status: number;
  ms: number;
  bytes?: number;
  from: 'ssr' | 'browser' | 'devtools';
  render?: 'ssr' | 'client';
  preview?: string;
}

const MAX_CALLS = 200;
const MAX_PREVIEW = 1000;
const MAX_CAPTURE = 16_000;

let seq = 0;
const calls: AnalogCall[] = [];
const listeners = new Set<(calls: AnalogCall[]) => void>();
let origin: string | undefined;

export function recentCalls(): AnalogCall[] {
  return calls.slice();
}

export function onCalls(listener: (calls: AnalogCall[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recordCall(call: Omit<AnalogCall, 'id'>): AnalogCall {
  const full = { ...call, id: ++seq };
  calls.push(full);
  if (calls.length > MAX_CALLS) calls.splice(0, calls.length - MAX_CALLS);
  for (const listener of listeners) {
    try {
      listener(recentCalls());
    } catch {
      // a broken listener must not break the dev server
    }
  }
  return full;
}

export function clearCalls() {
  calls.length = 0;
  for (const listener of listeners) {
    try {
      listener([]);
    } catch {
      // a broken listener must not break the dev server
    }
  }
}

export function setDevOrigin(value: string | undefined) {
  origin = value?.replace(/\/$/, '');
}

export function devOrigin(): string | undefined {
  return origin;
}

function isSecretJsonKey(key: string): boolean {
  return isSecretKey(key) || isCustomSecretKey(key);
}

function redactJson(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return '[Truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactJson(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
    out[key] = isSecretJsonKey(key) ? '[redacted]' : redactJson(item, depth + 1);
  }
  return out;
}

function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') return i + 1;
  }
  return text.length;
}

function valueEnd(text: string, start: number): number {
  const first = text[start];
  if (first === '"') return stringEnd(text, start);
  if (first !== '{' && first !== '[') {
    const stop = text.slice(start).search(/[,}\]]/);
    return stop < 0 ? text.length : start + stop;
  }
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') i = stringEnd(text, i) - 1;
    else if (ch === '{' || ch === '[') depth++;
    else if ((ch === '}' || ch === ']') && --depth === 0) return i + 1;
  }
  return text.length;
}

function redactJsonText(text: string): string {
  const colon = /\s*:\s*/y;
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '"') {
      out += text[i++];
      continue;
    }
    const end = stringEnd(text, i);
    const token = text.slice(i, end);
    out += token;
    i = end;
    colon.lastIndex = i;
    const sep = colon.exec(text);
    if (!sep) continue;
    let key: string;
    try {
      key = String(JSON.parse(token));
    } catch {
      key = token.slice(1, -1);
    }
    if (!isSecretJsonKey(key)) continue;
    out += `${sep[0]}"[redacted]"`;
    i = valueEnd(text, i + sep[0].length);
  }
  return out;
}

export function previewOf(body: string, type: string | undefined): string | undefined {
  if (!body) return undefined;
  if (type && !/json|text\/plain/.test(type)) return undefined;
  let text = body;
  try {
    text = JSON.stringify(redactJson(JSON.parse(body)));
  } catch {
    text = redactJsonText(body);
  }
  text = redactMessage(text);
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…` : text;
}

/** Maps an Analog load endpoint path back to the page URL it serves. */
export function loadRoute(endpoint: string): string {
  return (
    endpoint
      .replace(/\/\([^/]*\)(?=\/|$)/g, '')
      .replace(/\/-[^/]+-$/, '')
      .replace(/\/index$/, '') || '/'
  );
}

export function classify(
  url: string,
  method: string,
  accept: string,
  apiPrefix = 'api',
): { kind: AnalogCallKind; route?: string } | null {
  const path = url.split('?')[0];
  const prefix = apiPrefix ? `/${apiPrefix}` : '';
  for (const base of [`${prefix}/_analog/pages`, '/_analog/pages']) {
    if (path.startsWith(`${base}/`) || path === base) {
      return { kind: 'load', route: loadRoute(path.slice(base.length)) };
    }
  }
  for (const base of [`${prefix}/_analog/fn`, '/_analog/fn']) {
    if (path.startsWith(`${base}/`)) return { kind: 'fn', route: path.slice(base.length + 1) };
  }
  if (prefix && (path === prefix || path.startsWith(`${prefix}/`)))
    return { kind: 'api', route: path };
  if (
    method === 'GET' &&
    accept.includes('text/html') &&
    !path.startsWith('/@') &&
    !path.startsWith('/__') &&
    !/\.\w{1,5}$/.test(path)
  ) {
    return { kind: 'page', route: path };
  }
  return null;
}

export const DEVTOOLS_HEADER = 'x-ng-devtools';

function fromOf(req: IncomingMessage): AnalogCall['from'] {
  if (req.headers[DEVTOOLS_HEADER]) return 'devtools';
  const agent = String(req.headers['user-agent'] ?? '');
  return !agent || /node|undici/i.test(agent) ? 'ssr' : 'browser';
}

export function analogMiddleware(apiPrefix = 'api') {
  return (
    req: IncomingMessage & { originalUrl?: string },
    res: ServerResponse,
    next: () => void,
  ) => {
    const url = req.originalUrl ?? req.url ?? '';
    const match = classify(url, req.method ?? 'GET', String(req.headers.accept ?? ''), apiPrefix);
    if (!match) return next();
    const start = performance.now();
    const chunks: Buffer[] = [];
    let captured = 0;
    let bytes = 0;
    let serverRendered = false;
    const capture = match.kind !== 'page';
    const keep = (chunk: unknown, encoding?: unknown) => {
      if (chunk === undefined || chunk === null || typeof chunk === 'function') return;
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(
            String(chunk),
            typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8',
          );
      bytes += buffer.length;
      if (!capture && !serverRendered && buffer.includes('ng-server-context'))
        serverRendered = true;
      if (capture && captured < MAX_CAPTURE) {
        chunks.push(buffer.subarray(0, MAX_CAPTURE - captured));
        captured += Math.min(buffer.length, MAX_CAPTURE - captured);
      }
    };
    const write = res.write.bind(res);
    const end = res.end.bind(res);
    res.write = ((chunk: unknown, ...rest: unknown[]) => {
      keep(chunk, rest[0]);
      return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof res.write;
    res.end = ((chunk?: unknown, ...rest: unknown[]) => {
      keep(chunk, rest[0]);
      return (end as (...args: unknown[]) => ServerResponse)(chunk, ...rest);
    }) as typeof res.end;
    res.on('finish', () => {
      const call: Omit<AnalogCall, 'id'> = {
        at: Date.now(),
        kind: match.kind,
        method: req.method ?? 'GET',
        url: redactMessage(url),
        route: match.route,
        status: res.statusCode,
        ms: Math.round(performance.now() - start),
        bytes,
        from: fromOf(req),
      };
      if (match.kind === 'page') {
        call.render =
          serverRendered && res.getHeader('x-analog-no-ssr') !== 'true' ? 'ssr' : 'client';
      } else {
        const preview = previewOf(
          Buffer.concat(chunks).toString('utf8'),
          String(res.getHeader('content-type') ?? ''),
        );
        if (preview) call.preview = preview;
      }
      recordCall(call);
    });
    next();
  };
}

export interface DuplicateLoad {
  route: string;
  ssrAt: number;
  browserAt: number;
}

/**
 * Pairs the SSR load() of a server rendered page with the first browser load()
 * of the same route that follows the render. Any other navigation resets it.
 */
function rendersRoute(loadRoute: string, pageRoute: string): boolean {
  const load = loadRoute.replace(/\/+$/, '') || '/';
  const page = pageRoute.replace(/\/+$/, '') || '/';
  return load === page || load === '/' || page.startsWith(`${load}/`);
}

export function duplicateLoads(list: AnalogCall[], windowMs = 10_000): DuplicateLoad[] {
  const out: DuplicateLoad[] = [];
  let ssrLoads = new Map<string, number>();
  let armed = new Map<string, number>();
  let armedAt = 0;
  for (const call of list) {
    if (call.from === 'devtools' || !call.route) continue;
    if (call.kind === 'page') {
      const page = call.route;
      armed =
        call.from === 'browser' && call.render === 'ssr'
          ? new Map([...ssrLoads].filter(([route]) => rendersRoute(route, page)))
          : new Map();
      armedAt = call.at;
      ssrLoads = new Map();
    } else if (call.kind === 'load') {
      if (call.from === 'ssr') {
        ssrLoads.set(call.route, call.at);
      } else if (armed.has(call.route) && call.at - armedAt <= windowMs) {
        out.push({ route: call.route, ssrAt: armed.get(call.route)!, browserAt: call.at });
        armed.delete(call.route);
      } else {
        armed = new Map();
      }
    }
  }
  return out;
}
