import { afterEach, describe, expect, it } from 'vitest';
import { initNgDevtoolsHub } from '../hub.ts';
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

afterEach(async () => {
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
