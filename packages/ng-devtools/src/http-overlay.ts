import { appIdOf, scanHydration } from './http-hydration.ts';
import { decodePayload, type PayloadSummary } from './http-payload.ts';
import { httpRegistry, sanitizeRules, storeRules } from './http-rules.ts';
import type { HttpPage, HydrationStats } from './types.ts';

interface RpcScope {
  rpc: {
    call(name: string, ...args: unknown[]): Promise<unknown>;
    register(definition: {
      name: string;
      type: 'event';
      jsonSerializable: boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: (...args: any[]) => unknown;
    }): void;
  };
}

type HydrationScan = ReturnType<typeof scanHydration>;

export function createHydrationScanner(scan: () => HydrationScan = () => scanHydration(document)) {
  let cached: HydrationScan | null = null;
  let key = '';
  let scans = 0;
  return (counters: Record<string, unknown> | undefined): HydrationScan => {
    const next = counters
      ? `${counters['hydratedNodes']}:${counters['componentsSkippedHydration']}:${counters['deferBlocksWithIncrementalHydration']}`
      : '';
    if (cached && scans >= 3 && next === key) return cached;
    cached = scan();
    key = next;
    scans++;
    return cached;
  };
}

function hydrationStats(
  payload: PayloadSummary,
  scanner: ReturnType<typeof createHydrationScanner>,
): HydrationStats {
  const counters = (globalThis as { ngDevMode?: Record<string, unknown> | boolean }).ngDevMode;
  const num = (key: string) =>
    counters && typeof counters === 'object' && typeof counters[key] === 'number'
      ? (counters[key] as number)
      : undefined;
  const hydratedComponents = num('hydratedComponents');
  const scan = scanner(counters && typeof counters === 'object' ? counters : undefined);
  const annotated = payload.entries.some((e) => e.key === '__nghData__');
  const warnings = httpRegistry().warnings;
  return {
    enabled: annotated || (hydratedComponents ?? 0) > 0 || scan.hydrated > 0,
    hydratedComponents,
    hydratedNodes: num('hydratedNodes'),
    componentsSkippedHydration: num('componentsSkippedHydration'),
    deferBlocksWithIncrementalHydration: num('deferBlocksWithIncrementalHydration'),
    nodes: { hydrated: scan.hydrated, skipped: scan.skipped, mismatched: scan.mismatched },
    mismatches: scan.mismatches,
    skipHydrationHosts: [...document.querySelectorAll('[ngskiphydration]')]
      .slice(0, 50)
      .map((el) => el.tagName.toLowerCase()),
    warnings: [...(warnings ?? [])],
    warningsCaptured: Array.isArray(warnings),
  };
}

/** Reports payload, hydration and client calls, and keeps fault rules in sync. */
export function attachHttp(my: RpcScope, pageId: string) {
  const payload = decodePayload(document, appIdOf(document));
  const initialUrl = location.pathname + location.search;
  const scanner = createHydrationScanner();
  let payloadSent = false;
  let lastSent = '';
  let lastSentAt = 0;

  const push = async () => {
    const report: Omit<HttpPage, 'reportedAt' | 'firstSeenAt' | 'payload'> = {
      pageId,
      url: location.pathname + location.search,
      initialUrl,
      title: document.title,
      hydration: hydrationStats(payload, scanner),
      calls: [...(httpRegistry().calls ?? [])],
    };
    const body = JSON.stringify(report);
    if (payloadSent && body === lastSent && Date.now() - lastSentAt < 8000) return;
    lastSent = body;
    lastSentAt = Date.now();
    const withPayload = !payloadSent;
    const answer = (await my.rpc.call(
      'push-http',
      withPayload ? { ...report, payload } : report,
    )) as { needPayload?: boolean } | null | undefined;
    payloadSent = withPayload || payloadSent;
    if (answer?.needPayload) payloadSent = false;
  };

  my.rpc.register({
    name: 'http-rules',
    type: 'event',
    jsonSerializable: true,
    handler: (rules: unknown) => storeRules(sanitizeRules(rules)),
  });
  my.rpc.register({
    name: 'http-clear',
    type: 'event',
    jsonSerializable: true,
    handler: () => {
      httpRegistry().calls = [];
      void push();
    },
  });

  void my.rpc
    .call('get-http-rules')
    .then((rules) => storeRules(sanitizeRules(rules)))
    .catch(() => {});

  return {
    push,
    leave: () => void my.rpc.call('forget-http-page', pageId).catch(() => {}),
  };
}
