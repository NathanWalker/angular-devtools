// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The module auto-creates on import and keeps a single instance, so each test
 * needs it loaded afresh. */
const json = () => new Response('{}', { headers: { 'content-type': 'application/json' } });
const notFound = () => new Response('', { status: 404 });
const spaFallback = () =>
  new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });

async function loadPopup(hub: boolean | ((url: string) => Response) = false) {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.resetModules();
  const respond = typeof hub === 'function' ? hub : hub ? json : notFound;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => respond(url)),
  );
  const popup = await import('../popup.ts');
  await popup.showDevtools();
  return popup;
}

function frame() {
  return document
    .getElementById('ng-devtools-popup-root')!
    .shadowRoot!.querySelector('iframe') as HTMLIFrameElement;
}

async function openedSrc() {
  parts().fab.click();
  await vi.waitFor(() => expect(frame().src).not.toBe(''));
  return frame().src;
}

function parts() {
  const host = document.getElementById('ng-devtools-popup-root')!;
  const shadow = host.shadowRoot!;
  return {
    fab: shadow.querySelector('.fab') as HTMLButtonElement,
    panel: shadow.querySelector('.panel') as HTMLElement,
  };
}

// One document and one localStorage, so these share state by nature.
describe.sequential('devtools popup', () => {
  beforeEach(() => localStorage.clear());

  it('opens the whole hub from the launcher when a hub is mounted', async () => {
    await loadPopup(true);
    expect(await openedSrc()).toBe(`${location.origin}/__devframes/`);
    expect(document.head.querySelector('script[src="/__devframes/embedded.js"]')).toBeNull();
  });

  it('closes on Escape pressed inside a dock frame nested in the hub', async () => {
    await loadPopup(true);
    const { panel } = parts();
    await openedSrc();
    const frame = document
      .getElementById('ng-devtools-popup-root')!
      .shadowRoot!.querySelector('iframe') as HTMLIFrameElement;
    const viewerFrame = document.createElement('iframe');
    document.body.appendChild(viewerFrame);
    const viewer = viewerFrame.contentDocument!;
    Object.defineProperty(frame, 'contentDocument', { get: () => viewer });
    frame.dispatchEvent(new Event('load'));
    const dock = viewer.createElement('iframe');
    viewer.body.appendChild(dock);
    await new Promise((resolve) => setTimeout(resolve));
    dock.contentDocument!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(panel.classList.contains('open')).toBe(false);
  });

  it('mounts even when the stored state is unusable', async () => {
    for (const stored of ['null', '123', '"float"', '[]', '{not json', '{"launcher":{}}']) {
      localStorage.setItem('ng-devtools-popup', stored);
      await loadPopup();
      const { fab } = parts();
      expect(fab, `stored: ${stored}`).toBeTruthy();
      expect(fab.style.inset).not.toContain('NaN');
    }
  });

  it('opens and closes on click, which is what a keyboard sends', async () => {
    await loadPopup();
    const { fab, panel } = parts();
    fab.click();
    expect(panel.classList.contains('open')).toBe(true);
    expect(fab.getAttribute('aria-expanded')).toBe('true');
    fab.click();
    expect(panel.classList.contains('open')).toBe(false);
  });

  it('moves the launcher with the arrow keys and remembers where it went', async () => {
    await loadPopup();
    const { fab } = parts();
    fab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const saved = JSON.parse(localStorage.getItem('ng-devtools-popup')!);
    expect(Number.isFinite(saved.launcher.x)).toBe(true);
    expect(Number.isFinite(saved.launcher.y)).toBe(true);
  });

  it('keeps the launcher on screen', async () => {
    localStorage.setItem(
      'ng-devtools-popup',
      JSON.stringify({ launcher: { x: 99999, y: 99999 }, docked: 'float' }),
    );
    await loadPopup();
    const { fab } = parts();
    const [top, , , left] = fab.style.inset.split(' ');
    expect(parseInt(left, 10)).toBeLessThan(window.innerWidth);
    expect(parseInt(top, 10)).toBeLessThan(window.innerHeight);
  });

  it('labels the panel and its controls', async () => {
    await loadPopup();
    const shadow = document.getElementById('ng-devtools-popup-root')!.shadowRoot!;
    expect(shadow.querySelector('.panel')!.getAttribute('aria-label')).toBeTruthy();
    expect(shadow.querySelector('.frame')!.getAttribute('title')).toBeTruthy();
    expect(shadow.querySelector('.dock-btn')!.getAttribute('aria-label')).toBeTruthy();
    expect(shadow.querySelector('.close-btn')!.getAttribute('aria-label')).toBeTruthy();
  });

  it('opens the hub on the custom base the overlay connected to', async () => {
    const popup = await loadPopup((url) =>
      url === `${location.origin}/__tools/__connection.json` ? json() : notFound(),
    );
    popup.useDevtoolsBase('/__tools/ng-devtools/');
    expect(await openedSrc()).toBe(`${location.origin}/__tools/`);
  });

  it('opens the panel alone on a custom base without a hub', async () => {
    const popup = await loadPopup();
    popup.useDevtoolsBase('/__my-devtools/');
    const src = new URL(await openedSrc());
    expect(src.pathname).toBe('/__my-devtools/');
    expect(src.searchParams.get('baseURL')).toBe(`${location.origin}/__my-devtools/`);
  });

  it('follows a base that arrives after the panel opened', async () => {
    const popup = await loadPopup((url) => (url.includes('/__tools/') ? json() : notFound()));
    parts().fab.click();
    const shadow = document.getElementById('ng-devtools-popup-root')!.shadowRoot!;
    await vi.waitFor(() =>
      expect(shadow.querySelector<HTMLElement>('.missing')!.hidden).toBe(false),
    );
    popup.useDevtoolsBase('/__tools/ng-devtools/');
    await vi.waitFor(() => expect(frame().src).toBe(`${location.origin}/__tools/`));
    expect(shadow.querySelector<HTMLElement>('.missing')!.hidden).toBe(true);
  });

  it('still finds the hub when createDevtoolsPopup runs first', async () => {
    document.body.innerHTML = '';
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return json();
      }),
    );
    const popup = await import('../popup.ts');
    const handle = popup.createDevtoolsPopup();
    await popup.showDevtools();
    expect(popup.createDevtoolsPopup()).toBe(handle);
    expect(await openedSrc()).toBe(`${location.origin}/__devframes/`);
  });

  it('applies a src passed to a later createDevtoolsPopup call', async () => {
    const popup = await loadPopup(true);
    popup.createDevtoolsPopup({ src: '/__custom-hub/' });
    expect(await openedSrc()).toBe(`${location.origin}/__custom-hub/`);
  });

  it('says no server was found instead of loading the app in the panel', async () => {
    await loadPopup(spaFallback);
    parts().fab.click();
    const shadow = document.getElementById('ng-devtools-popup-root')!.shadowRoot!;
    const missing = shadow.querySelector<HTMLElement>('.missing')!;
    await vi.waitFor(() => expect(missing.hidden).toBe(false));
    expect(missing.textContent).toContain('No devtools server found');
    expect(missing.querySelector('a')!.getAttribute('href')).toMatch(/^https:/);
    expect(missing.querySelector('h2')!.id).toBe(missing.getAttribute('aria-labelledby'));
    expect(missing.querySelector('a')!.textContent).toContain('opens in a new tab');
    expect(shadow.querySelector('[role="status"]')!.textContent).toBe('No devtools server found');
    expect(frame().hidden).toBe(true);
    expect(frame().getAttribute('src')).toBeNull();
  });

  it('keeps the floating panel inside a narrow window', async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    window.innerWidth = 360;
    window.innerHeight = 640;
    localStorage.setItem(
      'ng-devtools-popup',
      JSON.stringify({ x: 600, y: 500, width: 720, height: 480, docked: 'float' }),
    );
    try {
      await loadPopup(true);
      parts().fab.click();
      const panel = parts().panel;
      expect(parseInt(panel.style.left, 10)).toBe(16);
      expect(parseInt(panel.style.top, 10)).toBe(160);
    } finally {
      window.innerWidth = width;
      window.innerHeight = height;
    }
  });
});
