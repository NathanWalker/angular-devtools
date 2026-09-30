import { createHostContext } from 'devframe/node';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENT_INSPECTOR,
  NG_DEVTOOLS_INSPECTORS,
  RPC_INSPECTOR,
  agentAllowed,
  pickNgDevtoolsConfig,
  resolveNgDevtoolsConfig,
  summarizeNgDevtoolsConfig,
  type NgDevtoolsConfig,
} from '../config.ts';
import { createNgDevtools } from '../devframe.ts';
import { initNgDevtoolsHub } from '../hub.ts';
import { makeProject } from './analog-fixture.ts';
import { isSecretKey, setRedaction } from '../forms-privacy.ts';

const SHARED_RPC = ['build-meta'];

async function boot(config?: NgDevtoolsConfig) {
  const host = {
    mountStatic: () => {},
    resolveOrigin: () => 'http://localhost',
    getStorageDir: () => '',
  };
  const ctx = await createHostContext({ cwd: process.cwd(), mode: 'dev', host: host as never });
  await createNgDevtools(config).setup(ctx as never);
  const definitions = (ctx.rpc as unknown as { definitions: Map<string, unknown> }).definitions;
  const rpc = [...definitions.keys()]
    .filter((name) => name.startsWith('ng-devtools:'))
    .map((name) => name.slice('ng-devtools:'.length));
  const manifest = ctx.agent.list();
  const strip = (id: string) => id.replace(/^ng-devtools:/, '');
  return {
    ctx,
    rpc,
    tools: manifest.tools.map((tool) => strip(tool.id)),
    actionTools: manifest.tools.filter((t) => t.safety === 'action').map((t) => strip(t.id)),
    resources: manifest.resources.map((resource) => strip(resource.id)),
    invoke: (name: string, payload: unknown) =>
      ctx.rpc.invokeLocal(`ng-devtools:${name}` as never, ...([payload] as never)),
  };
}

describe('resolveNgDevtoolsConfig', () => {
  it('turns everything on by default', () => {
    const config = resolveNgDevtoolsConfig();
    expect(Object.values(config.inspectors).every(Boolean)).toBe(true);
    expect(Object.keys(config.inspectors)).toEqual([...NG_DEVTOOLS_INSPECTORS]);
    expect(Object.values(config.agent.tools).every(Boolean)).toBe(true);
    expect(config.agent.readOnly).toBe(false);
    expect(config.actions).toEqual({
      forms: true,
      router: true,
      ngrx: true,
      http: true,
      analog: true,
    });
  });

  it('carries a disabled inspector into its agent tools and panel actions', () => {
    const config = resolveNgDevtoolsConfig({
      inspectors: { forms: false, ngrx: false },
      agent: { tools: { pipes: false } },
    });
    expect(config.inspectors.forms).toBe(false);
    expect(config.inspectors.pipes).toBe(true);
    expect(config.agent.tools).toMatchObject({ forms: false, ngrx: false, pipes: false });
    expect(config.agent.tools.router).toBe(true);
    expect(config.actions).toEqual({
      forms: false,
      router: true,
      ngrx: false,
      http: true,
      analog: true,
    });
  });

  it('reads actions as a switch or per action', () => {
    expect(resolveNgDevtoolsConfig({ actions: false }).actions).toEqual({
      forms: false,
      router: false,
      ngrx: false,
      http: false,
      analog: false,
    });
    expect(resolveNgDevtoolsConfig({ actions: { router: false } }).actions).toEqual({
      forms: true,
      router: false,
      ngrx: true,
      http: true,
      analog: true,
    });
  });

  it('ignores values that are not booleans and keys it does not know', () => {
    const config = resolveNgDevtoolsConfig({
      inspectors: { forms: 'no', router: 0, unknown: false },
      agent: 'read-only',
      actions: ['forms'],
    });
    expect(config).toEqual(resolveNgDevtoolsConfig());
    expect(resolveNgDevtoolsConfig(null)).toEqual(resolveNgDevtoolsConfig());
  });

  it('returns its own output unchanged', () => {
    const config = resolveNgDevtoolsConfig({
      inspectors: { signals: false },
      agent: { readOnly: true, tools: { router: false } },
      actions: { ngrx: false },
    });
    expect(resolveNgDevtoolsConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
  });

  it('splits the config out of hub and plugin options', () => {
    const { config, rest } = pickNgDevtoolsConfig({
      base: '/x/',
      auth: false,
      allowedOrigins: ['https://app.example'],
      mcp: { authorization: 'token' },
      inspectors: { http: false },
      agent: { readOnly: true },
    });
    expect(rest).toEqual({
      base: '/x/',
      auth: false,
      allowedOrigins: ['https://app.example'],
      mcp: { authorization: 'token' },
    });
    expect(config).toEqual({
      inspectors: { http: false },
      agent: { readOnly: true },
      actions: undefined,
      redaction: undefined,
      limits: undefined,
    });
  });

  it('fills in and clamps the limits', () => {
    expect(resolveNgDevtoolsConfig().limits).toEqual({
      refreshMs: 3000,
      navigations: 50,
      formTimeline: 200,
      httpCalls: 200,
      changeLog: 200,
    });
    expect(
      resolveNgDevtoolsConfig({
        limits: {
          refreshMs: 100,
          navigations: 10_000,
          formTimeline: 99.6,
          httpCalls: Number.NaN,
          changeLog: '500',
        },
      }).limits,
    ).toEqual({
      refreshMs: 500,
      navigations: 500,
      formTimeline: 100,
      httpCalls: 200,
      changeLog: 200,
    });
    expect(resolveNgDevtoolsConfig({ limits: { refreshMs: 60_000 } }).limits.refreshMs).toBe(8000);
  });

  it('keeps redaction names as trimmed, unique strings', () => {
    expect(resolveNgDevtoolsConfig().redaction).toEqual({ secretNames: [], unmask: [] });
    const config = resolveNgDevtoolsConfig({
      redaction: { secretNames: [' passport ', 'passport', '', 7, 'x'.repeat(101)], unmask: 'pin' },
    });
    expect(config.redaction).toEqual({ secretNames: ['passport'], unmask: [] });
  });
});

describe('summarizeNgDevtoolsConfig', () => {
  it('is empty for the defaults', () => {
    expect(summarizeNgDevtoolsConfig(resolveNgDevtoolsConfig())).toEqual([]);
    expect(
      summarizeNgDevtoolsConfig(resolveNgDevtoolsConfig({ limits: { refreshMs: 3000 } })),
    ).toEqual([]);
  });

  it('lists only what differs from the defaults', () => {
    const config = resolveNgDevtoolsConfig({
      inspectors: { ngrx: false, pipes: false },
      agent: { readOnly: true, tools: { router: false, pipes: false } },
      actions: { forms: false, http: false, ngrx: false },
      redaction: { secretNames: ['passport'], unmask: ['pin'] },
      limits: { refreshMs: 1000, httpCalls: 50 },
    });
    expect(summarizeNgDevtoolsConfig(config)).toEqual([
      { label: 'Inspectors off', value: 'NgRx, Pipes' },
      { label: 'Agent', value: 'Read-only' },
      { label: 'Hidden from the agent', value: 'Router' },
      { label: 'Blocked actions', value: 'Form writes, HTTP mocking' },
      { label: 'Extra secret names', value: 'passport' },
      { label: 'Unmasked names', value: 'pin' },
      { label: 'Limits', value: 'poll every 1000 ms, 50 HTTP calls' },
    ]);
  });
});

describe('agent tool and RPC registration', () => {
  it('assigns every tool, resource and RPC function to an inspector or keeps it shared', async () => {
    const { rpc, tools, resources } = await boot();
    const unassigned = rpc.filter((name) => !RPC_INSPECTOR[name] && !SHARED_RPC.includes(name));
    expect(unassigned.filter((name) => !name.includes('analog'))).toEqual([]);
    for (const id of [...tools, ...resources].filter((id) => !SHARED_RPC.includes(id))) {
      expect(agentAllowed({ id }, resolveNgDevtoolsConfig({ agent: { tools: offAll() } }))).toBe(
        false,
      );
    }
    expect(Object.keys(AGENT_INSPECTOR).every((id) => [...tools, ...resources].includes(id))).toBe(
      true,
    );
  });

  it('registers everything by default', async () => {
    const { tools, actionTools } = await boot();
    expect(actionTools.sort()).toEqual(
      ['analog-call-api', 'fill-form', 'form-action', 'highlight', 'navigate'].sort(),
    );
    expect(tools).toContain('inspect-forms');
  });

  it('drops every action tool in read-only mode', async () => {
    const { tools, actionTools } = await boot({ agent: { readOnly: true } });
    expect(actionTools).toEqual([]);
    expect(tools).toEqual(expect.arrayContaining(['inspect-forms', 'list-routes', 'analog-lint']));
  });

  it('drops the agent tools of a blocked action and keeps the rest', async () => {
    const forms = await boot({ actions: { forms: false } });
    expect(forms.actionTools.sort()).toEqual(['analog-call-api', 'highlight', 'navigate'].sort());
    expect(forms.tools).toEqual(expect.arrayContaining(['inspect-forms', 'form-history']));
    const router = await boot({ actions: { router: false } });
    expect(router.actionTools).not.toContain('navigate');
    expect(router.actionTools).toEqual(expect.arrayContaining(['form-action', 'fill-form']));
    expect(router.tools).toContain('list-routes');
    const analog = await boot({ actions: { analog: false } });
    expect(analog.actionTools).not.toContain('analog-call-api');
    expect(analog.tools).toContain('analog-lint');
  });

  it('leaves out the RPC functions, tools and resources of a disabled inspector', async () => {
    const { rpc, tools, resources } = await boot({ inspectors: { forms: false, analog: false } });
    expect(rpc.filter((name) => RPC_INSPECTOR[name] === 'forms')).toEqual([]);
    expect(rpc.some((name) => name.includes('analog'))).toBe(false);
    expect(tools.some((id) => AGENT_INSPECTOR[id] === 'forms' || id.startsWith('analog-'))).toBe(
      false,
    );
    expect(resources).not.toContain('forms');
    expect(rpc).toContain('push-router');
    expect(tools).toContain('list-routes');
  });

  it('hides one inspector from the agent while its panel keeps working', async () => {
    const { rpc, tools, resources } = await boot({ agent: { tools: { router: false } } });
    expect(tools.some((id) => AGENT_INSPECTOR[id] === 'router')).toBe(false);
    expect(tools).not.toContain('get-routes');
    expect(rpc).toContain('get-routes');
    expect(resources).not.toContain('router');
    expect(rpc).toContain('push-router');
  });
});

describe('redaction', () => {
  afterEach(() => setRedaction());

  it('applies the configured secret names on the server', async () => {
    await boot({ redaction: { secretNames: ['voucher'] } });
    expect(isSecretKey('voucherCode')).toBe(true);
    await boot();
    expect(isSecretKey('voucherCode')).toBe(false);
  });
});

describe('panel actions', () => {
  it('refuses blocked writes on the server and lets reads through', async () => {
    const { invoke } = await boot({ actions: false });
    expect(await invoke('request-form-action', { action: 'submit', formId: 'F.form@p1' })).toEqual({
      ok: false,
      error: expect.stringContaining('actions.forms'),
    });
    expect(await invoke('request-router-action', { request: { action: 'navigate' } })).toEqual({
      error: expect.stringContaining('actions.router'),
    });
    expect(await invoke('request-ngrx-action', { request: { type: 'restore', seq: 1 } })).toEqual({
      error: expect.stringContaining('actions.ngrx'),
    });
    expect(await invoke('request-form-action', { action: 'fill', formId: 'F.form@p1' })).toEqual({
      ok: false,
      error: expect.stringContaining('actions.forms'),
    });
    expect(await invoke('request-form-action', null)).toEqual({
      ok: false,
      error: 'Bad request.',
    });
    await expect(invoke('set-http-rules', [])).rejects.toThrow('actions.http');
    await expect(invoke('clear-http-calls', undefined)).rejects.toThrow('actions.http');
    expect(await invoke('analog-call-api', { path: '/api/x' })).toEqual({
      error: expect.stringContaining('actions.analog'),
    });
    expect(await invoke('get-http-rules', undefined)).toEqual([]);
  });

  it('lets HTTP and Analog writes through when only other actions are blocked', async () => {
    const { invoke } = await boot({ actions: { forms: false } });
    expect(await invoke('set-http-rules', [])).toEqual([]);
    expect(await invoke('analog-call-api', { path: 'nope' })).not.toEqual({
      error: expect.stringContaining('actions.analog'),
    });
  });
});

describe('hub', () => {
  const hubs: { close: () => Promise<void> }[] = [];
  afterEach(async () => {
    for (const hub of hubs.splice(0)) await hub.close();
  });

  it('skips the docks of disabled inspectors and publishes the config to pages', async () => {
    const hub = initNgDevtoolsHub({
      cwd: makeProject({ 'package.json': '{}' }),
      ws: false,
      auth: false,
      allowedOrigins: false,
      inspectors: { ngrx: false },
      agent: { readOnly: true },
    });
    hubs.push(hub);
    await hub.ready;
    const ctx = await hub.context;
    const docks = [...ctx.docks.views.keys()].filter((id) => id.startsWith('ng-devtools:'));
    expect(docks).not.toContain('ng-devtools:ngrx');
    expect(docks).toContain('ng-devtools:analog');
    const meta = await (
      await hub.handler(new Request('http://localhost/__devframes/ng-devtools/__connection.json'))
    ).json();
    expect(meta.configs['ng-devtools']).toEqual(
      resolveNgDevtoolsConfig({ inspectors: { ngrx: false }, agent: { readOnly: true } }),
    );
  });
});

function offAll() {
  return Object.fromEntries(NG_DEVTOOLS_INSPECTORS.map((key) => [key, false]));
}
