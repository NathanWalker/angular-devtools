// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The module auto-creates on import and keeps a single instance, so each test
 * needs it loaded afresh. */
async function loadPopup(hub = false) {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      hub
        ? new Response('{}', { headers: { 'content-type': 'application/json' } })
        : new Response('', { status: 404 }),
    ),
  );
  const popup = await import('../popup.ts');
  await popup.showDevtools();
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
    const { fab } = parts();
    fab.click();
    const frame = document
      .getElementById('ng-devtools-popup-root')!
      .shadowRoot!.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.src).toBe(`${location.origin}/__devframes/`);
    expect(document.head.querySelector('script[src="/__devframes/embedded.js"]')).toBeNull();
  });

  it('closes on Escape pressed inside a dock frame nested in the hub', async () => {
    await loadPopup(true);
    const { fab, panel } = parts();
    fab.click();
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
});
