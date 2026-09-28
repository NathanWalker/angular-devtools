import type { ComponentPage, LiveComponentNode } from '../types.ts';

export const COMPONENT_PAGE_TTL = 15_000;

export function isComponentReport(value: unknown): value is Omit<ComponentPage, 'reportedAt'> {
  const report = value as Partial<ComponentPage> | null;
  return (
    !!report &&
    typeof report === 'object' &&
    typeof report.pageId === 'string' &&
    report.pageId.length > 0 &&
    report.pageId.length < 50 &&
    Array.isArray(report.roots)
  );
}

export function toComponentPage(report: Omit<ComponentPage, 'reportedAt'>, now = Date.now()) {
  const page: ComponentPage = {
    pageId: report.pageId,
    roots: report.roots,
    count: typeof report.count === 'number' ? report.count : 0,
    detail: report.detail ?? null,
    reportedAt: now,
  };
  if (report.truncated) page.truncated = true;
  return page;
}

export function latestComponentPage(pages: Iterable<ComponentPage>): ComponentPage | undefined {
  let latest: ComponentPage | undefined;
  for (const page of pages) {
    if (!latest || page.reportedAt > latest.reportedAt) latest = page;
  }
  return latest;
}

export function expireComponentPages(pages: Map<string, ComponentPage>, now = Date.now()) {
  let changed = false;
  for (const [id, page] of pages) {
    if (now - page.reportedAt > COMPONENT_PAGE_TTL) {
      pages.delete(id);
      changed = true;
    }
  }
  return changed;
}

export function findComponents(pages: Iterable<ComponentPage>, query: string) {
  const needle = query.trim().toLowerCase();
  const hits: { pageId: string; node: LiveComponentNode }[] = [];
  const visit = (pageId: string, nodes: LiveComponentNode[]) => {
    for (const node of nodes) {
      if (
        node.id === query ||
        node.name.toLowerCase() === needle ||
        node.tag.toLowerCase() === needle
      ) {
        hits.push({ pageId, node });
      }
      visit(pageId, node.children);
    }
  };
  for (const page of pages) visit(page.pageId, page.roots);
  return hits;
}
