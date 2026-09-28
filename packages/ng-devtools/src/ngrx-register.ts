export type PatchState = (store: object, ...updaters: unknown[]) => void;

const SIGNALS_KEY = '__NG_DEVTOOLS_NGRX_SIGNALS__';

export function registerNgrxSignals(api: { patchState: (...args: never[]) => unknown }): void {
  (globalThis as Record<string, unknown>)[SIGNALS_KEY] = { patchState: api.patchState };
}

export function registeredPatchState(): PatchState | null {
  const api = (globalThis as Record<string, unknown>)[SIGNALS_KEY] as
    { patchState?: unknown } | undefined;
  return typeof api?.patchState === 'function' ? (api.patchState as PatchState) : null;
}
