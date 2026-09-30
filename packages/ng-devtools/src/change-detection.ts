type Profiler = (event: number, instance?: unknown, hook?: unknown) => void;

interface ProfilerApi {
  ɵsetProfiler?: (profiler: Profiler | null) => unknown;
}

interface ZoneLike {
  root?: { run<T>(fn: () => T): T };
}

/** Angular's `ProfilerEvent.TemplateCreateStart` and `TemplateUpdateStart`. */
const TEMPLATE_CREATE_START = 0;
const TEMPLATE_UPDATE_START = 2;

export const REFRESH_DEBOUNCE_MS = 250;
export const POLL_MS = 3000;
export const HEARTBEAT_MS = 4000;

export interface RefreshOptions {
  getNg: () => unknown;
  refresh: () => void;
  doc?: Document;
  debounceMs?: number;
  pollMs?: number;
  heartbeatMs?: number;
}

export interface RefreshScheduler {
  readonly mode: 'change-detection' | 'poll';
  stop(): void;
}

/**
 * Runs `fn` in the root zone when zone.js is loaded, so timers created there do
 * not make the app run change detection, which would call the profiler again.
 */
export function outsideAngular<T>(fn: () => T): T {
  const root = (globalThis as { Zone?: ZoneLike }).Zone?.root;
  return root ? root.run(fn) : fn();
}

/** The major version from the `ng-version` attribute, or 0 when there is none. */
export function angularMajor(doc: Document = document): number {
  const version = doc.querySelector('[ng-version]')?.getAttribute('ng-version') ?? '';
  const major = Number.parseInt(version, 10);
  return Number.isFinite(major) ? major : 0;
}

/**
 * Calls `refresh` shortly after Angular updates a template, with a slow
 * heartbeat on top. Where the profiler hook is missing, it polls instead.
 */
export function watchChangeDetection(options: RefreshOptions): RefreshScheduler {
  const doc = options.doc ?? document;
  const debounceMs = options.debounceMs ?? REFRESH_DEBOUNCE_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;

  let pending: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let removeProfiler: (() => void) | null = null;
  let stopped = false;

  const run = () => {
    if (stopped) return;
    try {
      options.refresh();
    } catch {
      return;
    }
  };

  const fire = () => {
    pending = undefined;
    run();
  };

  const profiler: Profiler = (event) => {
    if (pending !== undefined || stopped) return;
    if (event !== TEMPLATE_UPDATE_START && event !== TEMPLATE_CREATE_START) return;
    pending = outsideAngular(() => setTimeout(fire, debounceMs));
  };

  const attach = () => {
    const ng = options.getNg() as ProfilerApi | undefined;
    const setProfiler = ng?.ɵsetProfiler;
    // Before v20 there is a single profiler slot: taking it would evict the
    // Angular DevTools extension, and there is no remover to give it back.
    if (typeof setProfiler !== 'function' || angularMajor(doc) < 20) return false;
    let remove: unknown;
    try {
      remove = setProfiler(profiler);
    } catch {
      return false;
    }
    if (typeof remove !== 'function') return false;
    removeProfiler = remove as () => void;
    return true;
  };

  const every = (ms: number, fn: () => void) => {
    clearInterval(interval);
    interval = outsideAngular(() => setInterval(fn, ms));
  };

  const scheduler = {
    mode: 'poll' as RefreshScheduler['mode'],
    stop() {
      stopped = true;
      clearTimeout(pending);
      clearInterval(interval);
      pending = undefined;
      // Never `setProfiler(null)`: that clears every registered profiler.
      removeProfiler?.();
      removeProfiler = null;
    },
  };

  const hooked = () => {
    scheduler.mode = 'change-detection';
    every(heartbeatMs, run);
  };

  if (attach()) hooked();
  else
    every(pollMs, () => {
      // The page may not have bootstrapped yet, so keep trying to hook in.
      if (attach()) hooked();
      run();
    });
  return scheduler;
}
