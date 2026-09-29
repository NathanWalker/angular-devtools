import type { DevframeHubContext } from '@devframes/hub/node';
import type { DevframeViewIframe } from '@devframes/hub/types';

export const HUB_VIEWS = ['angular', 'ngrx', 'analog', 'nativescript', 'capacitor'] as const;
export type HubView = (typeof HUB_VIEWS)[number];

const NGRX_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="#BA2BD2" d="M12.024.017V0L12 .008L11.976 0v.017L.812 3.892l1.605 14.875l9.559 5.207V24l.024-.013l.024.013v-.026l9.559-5.207l1.605-14.875zm6.868 14.244q-1.64 3.948-6.031 4.166c-2.829 0-4.661-1.7-4.66-1.7q-1.745-1.359-2.398-3.417c-.695-.76-.702-.841-.774-1.145c-.072-.303.045-.388.249-.685q.204-.298.098-.85q-.26-.36-.3-1.128q0-.37.496-.783q.495-.413.607-.632q.083-.119.065-1.031q-.006-.897.995-.975c1-.08 1.565-.832 1.879-1.174c.21-.228.52-.339.91-.341c.551-.026 1.052.185 1.484.62c1.075-.055 2.176.235 3.292.863q2.379 1.414 2.596 3.055q-.257 2.158-5.788-.113q-2.895.819-2.846 3.552q0 2.508 2.422 3.643c-.787-.772-1.122-1.422-1.01-1.959q2.456 2.906 5.588 2.173c-.92.032-1.65-.264-2.198-.893q2.116-.05 3.998-1.972c-.724.576-1.482.794-2.284.657q3.26-2.563 2.307-5.98l-.002-.006a3.02 3.02 0 0 1 .788 2.03q.023 1.175-.795 2.477q.613-.478 1.413-2.047c.23 2.117-.625 3.724-2.574 4.825q.934-.085 2.473-1.23m-5.567-6.63a.319.319 0 1 1 .638 0a.319.319 0 0 1-.638 0"/></svg>',
)}`;

const DOCKS: { view: HubView; title: string; icon: string; soon?: boolean }[] = [
  { view: 'angular', title: 'Angular', icon: 'logos:angular-icon' },
  { view: 'ngrx', title: 'NgRx', icon: NGRX_ICON },
  { view: 'analog', title: 'Analog', icon: 'logos:analog' },
  { view: 'nativescript', title: 'NativeScript', icon: 'logos:nativescript' },
  { view: 'capacitor', title: 'Capacitor', icon: 'logos:capacitorjs-icon', soon: true },
];

export function dockId(view: HubView): string {
  return `ng-devtools:${view}`;
}

function isHub(ctx: unknown): ctx is DevframeHubContext {
  return !!ctx && typeof ctx === 'object' && 'docks' in ctx && 'frames' in ctx;
}

export function registerHubDocks(ctx: unknown, id: string): string[] {
  if (!isHub(ctx)) return [];
  const base = ctx.frames.find((frame) => frame.id === id)?.base;
  if (!base) return [];
  const registered: string[] = [];
  DOCKS.forEach((dock, index) => {
    const entry: DevframeViewIframe = {
      type: 'iframe',
      id: dockId(dock.view),
      title: dock.soon ? `${dock.title} · Coming Soon` : dock.title,
      icon: dock.icon,
      category: 'framework',
      defaultOrder: index,
      url: `${base}?view=${dock.view}`,
      frameId: 'ng-devtools',
    };
    ctx.docks.register(entry);
    registered.push(entry.id);
  });
  return registered;
}
