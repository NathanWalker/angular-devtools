const PAGE_ID_KEY = 'ng-devtools-page-id';

export function hostPageId(): string | null {
  try {
    const fromQuery = new URLSearchParams(location.search).get('pageId');
    if (fromQuery) return fromQuery;
    if (window.top === window) return null;
    return sessionStorage.getItem(PAGE_ID_KEY) || null;
  } catch {
    return null;
  }
}
