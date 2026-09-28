const ACTIVE_DOCK_STYLE = `
  .devframes-dock-entry button {
    transition: opacity 0.2s, filter 0.2s, background-color 0.2s, transform 0.3s;
  }
  .devframes-dock-entry button:not(.scale-120) {
    opacity: 0.45;
    filter: saturate(0);
  }
  .devframes-dock-entry button:not(.scale-120):hover,
  .devframes-dock-entry button:not(.scale-120):focus-visible {
    opacity: 1;
    filter: none;
  }
  .devframes-dock-entry button:focus-visible {
    outline: 2px solid #f5a524;
    outline-offset: 2px;
  }
  .devframes-dock-entry button.scale-120 {
    transform: none;
    background: rgba(245, 165, 36, 0.16);
    box-shadow: inset 0 0 0 1px rgba(245, 165, 36, 0.6);
  }
  iframe {
    background: #0b0b0e;
    color-scheme: dark;
  }
  @media (prefers-reduced-motion: reduce) {
    .devframes-dock-entry button {
      transition: none;
    }
  }
`;

export function styleHubRail(doc: Document | null | undefined, attempts = 50): void {
  const root = doc?.querySelector('devframes-dock-standalone')?.shadowRoot;
  if (root) {
    if (root.querySelector('style[data-ng-devtools]')) return;
    const style = doc!.createElement('style');
    style.dataset['ngDevtools'] = '';
    style.textContent = ACTIVE_DOCK_STYLE;
    root.append(style);
    return;
  }
  if (attempts > 0) setTimeout(() => styleHubRail(doc, attempts - 1), 100);
}
