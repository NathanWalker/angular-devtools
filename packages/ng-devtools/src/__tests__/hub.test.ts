import { afterEach, describe, expect, it, vi } from 'vitest';
import { initNgDevtoolsHub, type NgDevtoolsHubOptions } from '../hub.ts';
import { makeProject } from './analog-fixture.ts';

const hubs: { close: () => Promise<void> }[] = [];

async function boot(cwd: string) {
  const hub = initNgDevtoolsHub({ cwd, ws: false, auth: false, allowedOrigins: false });
  hubs.push(hub);
  await hub.ready;
  const ctx = await hub.context;
  const docks = [...ctx.docks.views.values()].map((dock) => ({
    id: dock.id,
    title: dock.title,
    url: 'url' in dock ? dock.url : undefined,
    frameId: 'frameId' in dock ? dock.frameId : undefined,
    badge: dock.badge,
    groupId: dock.groupId,
    visibility: dock.visibility,
  }));
  return { hub, ctx, docks };
}

async function bootMcp(options: NgDevtoolsHubOptions) {
  const cwd = makeProject({ 'package.json': '{}' });
  const hub = initNgDevtoolsHub({ cwd, ws: false, allowedOrigins: false, ...options });
  hubs.push(hub);
  await hub.ready;
  return (token?: string) =>
    hub.handler(
      new Request('http://localhost/__devframes/__mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          origin: 'http://localhost:4000',
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    );
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const hub of hubs.splice(0)) await hub.close();
});

describe('ng-devtools hub', () => {
  it('adds a dock per tool, Analog included even outside Analog apps', async () => {
    const { docks } = await boot(makeProject({ 'package.json': '{}' }));
    const ours = docks.filter((d) => d.id.startsWith('ng-devtools:'));
    expect(ours.map((d) => [d.id, d.url])).toEqual([
      ['ng-devtools:angular', '/__devframes/ng-devtools/?view=angular'],
      ['ng-devtools:ngrx', '/__devframes/ng-devtools/?view=ngrx'],
      ['ng-devtools:analog', '/__devframes/ng-devtools/?view=analog'],
      ['ng-devtools:nativescript', '/__devframes/ng-devtools/?view=nativescript'],
      ['ng-devtools:capacitor', '/__devframes/ng-devtools/?view=capacitor'],
    ]);
    expect(ours.filter((d) => d.title.endsWith('Coming Soon')).map((d) => d.id)).toEqual([
      'ng-devtools:nativescript',
      'ng-devtools:capacitor',
    ]);
    expect(ours.some((d) => d.badge || d.groupId)).toBe(false);
    expect(new Set(ours.map((d) => d.frameId))).toEqual(new Set(['ng-devtools']));
    expect(docks.find((d) => d.id === 'ng-devtools')?.visibility).toBe('false');
  });

  it('serves the dock script, the viewer and the MCP tools', async () => {
    const { hub, ctx } = await boot(makeProject({ 'package.json': '{}' }));
    const get = (path: string) => hub.handler(new Request(`http://localhost${path}`));
    expect((await get('/__devframes/embedded.js')).status).toBe(200);
    expect((await get('/__devframes/')).status).toBe(200);
    const meta = await (await get('/__devframes/ng-devtools/__connection.json')).json();
    expect(meta.configs.ui.branding.primaryColor).toBe('#f5a524');
    const forms = (await ctx.agent.invoke('ng-devtools:inspect-forms', {})) as { markdown: string };
    expect(forms.markdown).toContain('No forms');
  });
});

describe('ng-devtools hub MCP route', () => {
  it('stays open when the hub runs without auth', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mcp = await bootMcp({ auth: false });
    expect((await mcp()).status).toBe(200);
    expect(log.mock.calls.flat().join('\n')).not.toContain('MCP token');
  });

  it('requires the token from NG_DEVTOOLS_MCP_TOKEN when auth is on', async () => {
    vi.stubEnv('NG_DEVTOOLS_MCP_TOKEN', 'env-secret');
    const mcp = await bootMcp({});
    expect((await mcp()).status).toBe(401);
    expect((await mcp('wrong')).status).toBe(401);
    const allowed = await mcp('env-secret');
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain('ng-devtools_get-routes');
  });

  it('prints a generated token when none is configured', async () => {
    vi.stubEnv('NG_DEVTOOLS_MCP_TOKEN', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mcp = await bootMcp({ auth: true });
    const token = /MCP token: (\S+)/.exec(log.mock.calls.flat().join('\n'))?.[1];
    expect(token).toMatch(/^[\w-]{32}$/);
    expect((await mcp()).status).toBe(401);
    expect((await mcp(token)).status).toBe(200);
  });

  it('keeps an explicit mcp setting', async () => {
    const mcp = await bootMcp({ auth: true, mcp: { authorization: 'own-secret' } });
    expect((await mcp()).status).toBe(401);
    expect((await mcp('own-secret')).status).toBe(200);
  });
});
