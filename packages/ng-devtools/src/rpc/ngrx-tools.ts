import type {
  NgrxLogEntry,
  NgrxPage,
  NgrxPageReport,
  NgrxSignalStoreInfo,
  NgrxState,
} from '../ngrx-shared.ts';
import type { SignalStoreMembers } from './get-ngrx-store.ts';

export const NGRX_PAGE_EXPIRES_MS = 15_000;
const MAX_LOG = 200;

export interface NgrxDeclaration {
  name: string;
  kind: string;
  file: string;
  members?: SignalStoreMembers;
}

export interface NgrxPageRecord extends NgrxPage {
  session: string;
}

export type NgrxPages = Map<string, NgrxPageRecord>;

export function isNgrxReport(value: unknown): value is NgrxPageReport {
  const r = value as Partial<NgrxPageReport> | null;
  return (
    !!r &&
    typeof r.pageId === 'string' &&
    typeof r.session === 'string' &&
    Array.isArray(r.stores) &&
    Array.isArray(r.log)
  );
}

export function nameStore(
  store: NgrxSignalStoreInfo,
  declarations: NgrxDeclaration[],
): Pick<NgrxSignalStoreInfo, 'name' | 'declaredIn'> {
  const keys = new Set(store.stateKeys);
  let best: { decl: NgrxDeclaration; score: number } | null = null;
  for (const decl of declarations) {
    if (decl.kind !== store.kind) continue;
    const state = decl.members?.state ?? [];
    if (!state.length || !state.every((key) => keys.has(key))) continue;
    const methods = new Set(store.methods.map((m) => m.name));
    const extra = (decl.members?.methods ?? []).filter((m) => methods.has(m)).length;
    const score = (state.length === keys.size ? 1000 : 0) + state.length * 10 + extra;
    if (!best || score > best.score) best = { decl, score };
  }
  return best ? { name: best.decl.name, declaredIn: best.decl.file } : {};
}

export function mergeNgrxReport(
  pages: NgrxPages,
  report: NgrxPageReport,
  declarations: NgrxDeclaration[],
  now = Date.now(),
): number {
  const previous = pages.get(report.pageId);
  const keep = previous && previous.session === report.session ? previous.log : [];
  const lastSeq = keep.at(-1)?.seq ?? 0;
  const fresh = report.log.filter((entry: NgrxLogEntry) => entry.seq > lastSeq);
  const log = [...keep, ...fresh].slice(-MAX_LOG);
  pages.set(report.pageId, {
    pageId: report.pageId,
    session: report.session,
    url: String(report.url ?? '').slice(0, 2000),
    title: String(report.title ?? '').slice(0, 200),
    stores: report.stores.map((store) => ({ ...store, ...nameStore(store, declarations) })),
    classic: report.classic ?? null,
    log,
    reportedAt: now,
  });
  return log.at(-1)?.seq ?? 0;
}

export function expireNgrxPages(pages: NgrxPages, now = Date.now()): boolean {
  let expired = false;
  for (const [id, page] of pages) {
    if (now - page.reportedAt > NGRX_PAGE_EXPIRES_MS) {
      pages.delete(id);
      expired = true;
    }
  }
  return expired;
}

export function ngrxStateOf(pages: NgrxPages): NgrxState {
  return {
    pages: [...pages.values()]
      .sort((a, b) => b.reportedAt - a.reportedAt)
      .map(({ session: _session, ...page }) => page),
  };
}
