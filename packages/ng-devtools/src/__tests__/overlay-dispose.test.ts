// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeClient {
  close: ReturnType<typeof vi.fn>;
  calls: string[];
}

const clients: FakeClient[] = [];
let connectGate: Promise<void> = Promise.resolve();

vi.mock('devframe/client', () => ({
  connectDevframe: vi.fn(async () => {
    const client: FakeClient = { close: vi.fn(), calls: [] };
    clients.push(client);
    await connectGate;
    return {
      close: client.close,
      scope: () => ({
        rpc: {
          call: vi.fn(async (name: string) => {
            client.calls.push(name);
            return undefined;
          }),
          register: vi.fn(),
        },
      }),
    };
  }),
}));

async function loadOverlay() {
  vi.resetModules();
  return import('../overlay.ts');
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe.sequential('overlay dispose', () => {
  beforeEach(() => {
    clients.length = 0;
    connectGate = Promise.resolve();
    document.body.innerHTML = '';
    delete window.__ngDevtoolsComponentOf;
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('clears every timer, listener and observer and closes the connection', async () => {
    const { initOverlay } = await loadOverlay();
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const docAdded = vi.spyOn(document, 'addEventListener');
    const docRemoved = vi.spyOn(document, 'removeEventListener');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');

    const dispose = await initOverlay();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    dispose();

    expect(vi.getTimerCount()).toBe(0);
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
    const key = ([type, listener]: unknown[]) => `${type}:${String(listener)}`;
    expect(removed.mock.calls.map(key).sort()).toEqual(added.mock.calls.map(key).sort());
    expect(docRemoved.mock.calls.map(key).sort()).toEqual(docAdded.mock.calls.map(key).sort());
    expect(clients[0].calls).toContain('forget-component-page');
    expect(window.__ngDevtoolsComponentOf).toBeUndefined();

    const pushes = clients[0].calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(clients[0].calls.length).toBe(pushes);
  });

  it('is safe to dispose twice', async () => {
    const { initOverlay } = await loadOverlay();
    const dispose = await initOverlay();
    dispose();
    dispose();
    expect(clients[0].close).toHaveBeenCalledTimes(1);
  });

  it('removes the Elements-panel lookup it installed', async () => {
    const { initOverlay } = await loadOverlay();
    const dispose = await initOverlay();
    expect(window.__ngDevtoolsComponentOf).toBeTypeOf('function');

    dispose();
    expect(window.__ngDevtoolsComponentOf).toBeUndefined();
  });

  it('leaves an Elements-panel lookup that is not its own', async () => {
    const { initOverlay } = await loadOverlay();
    const dispose = await initOverlay();
    const other = () => null;
    window.__ngDevtoolsComponentOf = other;

    dispose();
    expect(window.__ngDevtoolsComponentOf).toBe(other);
  });

  it('keeps the lookup of the overlay that replaced it', async () => {
    const { initOverlay } = await loadOverlay();
    const first = await initOverlay();
    const firstLookup = window.__ngDevtoolsComponentOf;
    const second = await initOverlay();
    const secondLookup = window.__ngDevtoolsComponentOf;

    expect(secondLookup).toBeTypeOf('function');
    expect(secondLookup).not.toBe(firstLookup);
    first();
    expect(window.__ngDevtoolsComponentOf).toBe(secondLookup);
    second();
    expect(window.__ngDevtoolsComponentOf).toBeUndefined();
  });

  it('stops the running overlay when another one starts', async () => {
    const { initOverlay } = await loadOverlay();
    const first = await initOverlay();
    const intervals = vi.getTimerCount();
    await initOverlay({ baseURL: '/__elsewhere/' });

    expect(clients).toHaveLength(2);
    expect(clients[0].close).toHaveBeenCalledTimes(1);
    expect(clients[1].close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(intervals);

    first();
    expect(clients[1].close).not.toHaveBeenCalled();
  });

  it('stops an overlay that is still connecting', async () => {
    const { initOverlay, disposeOverlay } = await loadOverlay();
    let open = () => {};
    connectGate = new Promise((resolve) => (open = resolve));
    const started = initOverlay();
    await flush();
    await disposeOverlay();
    open();
    const dispose = await started;

    expect(clients[0].close).toHaveBeenCalledTimes(1);
    expect(clients[0].calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(window.__ngDevtoolsComponentOf).toBeUndefined();
    dispose();
  });

  it('stops the auto-started overlay and removes the floating button', async () => {
    vi.stubEnv('VITEST', '');
    const { disposeOverlay } = await loadOverlay();
    await vi.waitFor(() => {
      expect(clients).toHaveLength(1);
      expect(document.getElementById('ng-devtools-popup-root')).not.toBeNull();
    });
    await flush();

    await disposeOverlay();

    expect(clients[0].close).toHaveBeenCalledTimes(1);
    expect(document.getElementById('ng-devtools-popup-root')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(window.__ngDevtoolsComponentOf).toBeUndefined();
  });
});

describe.sequential('popup hide', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('removes the popup and lets it be shown again', async () => {
    vi.resetModules();
    const popup = await import('../popup.ts');
    await popup.showDevtools();
    expect(document.getElementById('ng-devtools-popup-root')).not.toBeNull();

    await popup.hideDevtools();
    expect(document.getElementById('ng-devtools-popup-root')).toBeNull();

    await popup.showDevtools();
    expect(document.getElementById('ng-devtools-popup-root')).not.toBeNull();
  });
});
