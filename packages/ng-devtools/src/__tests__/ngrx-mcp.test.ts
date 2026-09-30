import { createHostContext } from 'devframe/node';
import { describe, expect, it } from 'vitest';
import ngDevtools from '../devframe.ts';
import type { NgrxPageReport } from '../ngrx-shared.ts';

async function boot() {
  const host = {
    mountStatic: () => {},
    resolveOrigin: () => 'http://localhost',
    getStorageDir: () => '',
  };
  const ctx = await createHostContext({ cwd: process.cwd(), mode: 'dev', host: host as never });
  await ngDevtools.setup(ctx as never);
  const push = (name: string, payload: unknown) =>
    ctx.rpc.invokeLocal(`ng-devtools:${name}` as never, ...([payload] as never));
  const read = async (id: string) =>
    ((await ctx.agent.read(`ng-devtools:${id}`)) as { text: string }).text;
  return { ctx, push, read };
}

const entry = (seq: number, type: string, origin: 'dispatch' | 'effect' | 'reactive') => ({
  seq,
  source: 'store' as const,
  storeId: 'store',
  type,
  action: { type },
  origin,
  timestamp: seq,
  diff: [],
  restorable: false,
});

describe('ngrx-store resource', () => {
  it('lists where each classic store action came from', async () => {
    const { push, read, ctx } = await boot();
    expect(ctx.agent.getResource('ng-devtools:ngrx-store')?.description).toMatch(/origin/);
    const report: NgrxPageReport = {
      pageId: 'p1',
      session: 's1',
      url: '/',
      title: 'App',
      stores: [],
      classic: { state: { count: 0 }, devtools: false, scope: 'root' },
      log: [
        entry(1, '[Todos] Load', 'dispatch'),
        entry(2, '[Todos] Loaded', 'effect'),
        entry(3, '[Todos] Filter', 'reactive'),
      ],
    };
    await push('push-ngrx-state', report);
    const state = JSON.parse(await read('ngrx-store'));
    expect(
      state.pages[0].log.map((e: { type: string; origin: string }) => [e.type, e.origin]),
    ).toEqual([
      ['[Todos] Load', 'dispatch'],
      ['[Todos] Loaded', 'effect'],
      ['[Todos] Filter', 'reactive'],
    ]);
  });
});
