// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NgDevtoolsConfig } from '../config.ts';
import { isSecretKey, setRedaction } from '../forms-privacy.ts';
import { httpRegistry } from '../http-rules.ts';
import { noteFailedCall, setNavigationLimit, type NavigationRecord } from '../router.ts';

const calls: string[] = [];
let configs: Record<string, unknown> | undefined;

vi.mock('devframe/client', () => ({
  connectDevframe: async () => ({
    connectionMeta: { backend: 'websocket', configs },
    scope: () => ({
      rpc: {
        call: async (name: string) => {
          calls.push(name);
          return undefined;
        },
        register: () => {},
      },
    }),
  }),
}));

const stops: (() => void)[] = [];

async function start(config?: NgDevtoolsConfig) {
  calls.length = 0;
  configs = config ? { 'ng-devtools': config } : undefined;
  const { initOverlay } = await import('../overlay.ts');
  stops.push(await initOverlay());
  await new Promise((resolve) => setTimeout(resolve, 100));
  return new Set(calls);
}

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  sessionStorage.clear();
  setRedaction();
  setNavigationLimit(50);
  delete httpRegistry().maxCalls;
  vi.restoreAllMocks();
});

describe('overlay collectors', () => {
  it('run every collector when the server sends no config', async () => {
    const called = await start();
    expect(called).toContain('push-component-tree');
    expect(called).toContain('push-injector-tree');
    expect(called).toContain('push-router');
  });

  it('skip the collectors of disabled inspectors', async () => {
    const called = await start({ inspectors: { components: false, router: false } });
    expect(called).not.toContain('push-component-tree');
    expect(called).not.toContain('push-router');
    expect(called).toContain('push-injector-tree');
  });

  it('install the Elements-panel lookup only with the components inspector', async () => {
    await start();
    expect(window.__ngDevtoolsComponentOf).toBeTypeOf('function');
    stops.splice(0).forEach((stop) => stop());
    expect(window.__ngDevtoolsComponentOf).toBeUndefined();

    await start({ inspectors: { components: false } });
    expect(window.__ngDevtoolsComponentOf).toBeUndefined();
  });

  it('only tell the server to forget pages for enabled inspectors', async () => {
    await start({ inspectors: { forms: false } });
    calls.length = 0;
    dispatchEvent(new Event('pagehide'));
    expect(calls).not.toContain('forget-forms-page');
    expect(calls).toContain('forget-router-page');
  });

  it('poll on the default fallback interval without a config', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    await start();
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 3000);
    expect(httpRegistry().maxCalls).toBe(200);
  });

  it('use the configured limits, with refreshMs as the fallback poll interval', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    await start({ limits: { refreshMs: 1000, navigations: 10, httpCalls: 20 } });
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(interval).not.toHaveBeenCalledWith(expect.any(Function), 3000);
    expect(httpRegistry().maxCalls).toBe(20);
    const list: NavigationRecord[] = [];
    for (let i = 0; i < 15; i++) noteFailedCall(list, `/x/${i}`, new Error('nope'), i);
    expect(list).toHaveLength(10);
  });

  it('apply the redaction config from the server before collecting', async () => {
    await start({ redaction: { secretNames: ['voucher'] } });
    expect(isSecretKey('voucherCode')).toBe(true);
  });
});
