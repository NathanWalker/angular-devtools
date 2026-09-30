export const NG_DEVTOOLS_INSPECTORS = [
  'components',
  'injectors',
  'signals',
  'ngrx',
  'forms',
  'router',
  'pipes',
  'http',
  'analog',
] as const;

export type NgDevtoolsInspector = (typeof NG_DEVTOOLS_INSPECTORS)[number];

export const NG_DEVTOOLS_ACTIONS = ['forms', 'router', 'ngrx', 'http', 'analog'] as const;

export type NgDevtoolsAction = (typeof NG_DEVTOOLS_ACTIONS)[number];

/** Default, minimum and maximum of each `limits` option. Values outside are clamped. */
export const NG_DEVTOOLS_LIMITS = {
  refreshMs: { default: 3000, min: 500, max: 8000 },
  navigations: { default: 50, min: 5, max: 500 },
  formTimeline: { default: 200, min: 10, max: 2000 },
  httpCalls: { default: 200, min: 10, max: 2000 },
  changeLog: { default: 200, min: 10, max: 2000 },
} as const;

export type NgDevtoolsLimit = keyof typeof NG_DEVTOOLS_LIMITS;

/**
 * Options shared by `initNgDevtoolsHub()`, the Vite plugin and
 * `createNgDevtools()`. Everything is on when left out.
 */
export interface NgDevtoolsConfig {
  /** Turn an inspector off: no tab or dock, no page collector, no RPC and no agent tools. */
  inspectors?: Partial<Record<NgDevtoolsInspector, boolean>>;
  agent?: {
    /** Drop every agent tool that acts on the page or the server. */
    readOnly?: boolean;
    /** Hide one inspector's agent tools and resources while keeping its tab. */
    tools?: Partial<Record<NgDevtoolsInspector, boolean>>;
  };
  /** Allow or block writes from the panel and the agent. `false` blocks them all. */
  actions?: boolean | Partial<Record<NgDevtoolsAction, boolean>>;
  redaction?: {
    /**
     * Field names to treat as secret on top of the built-in list, matched by
     * words like it: `passport` also covers `passportNumber`.
     */
    secretNames?: string[];
    /** Field names to show even when they look secret, like `window.__NG_DEVTOOLS_FORMS__.unmask`. */
    unmask?: string[];
  };
  limits?: {
    /**
     * How often the page polls for changes, in ms, when it can't follow change
     * detection: before Angular 20, or before the app bootstraps. Also sets the
     * Analog runtime refresh. Default 3000, from 500 to 8000.
     */
    refreshMs?: number;
    /** Navigations kept per page. Default 50. */
    navigations?: number;
    /** Form timeline events kept. Default 200. */
    formTimeline?: number;
    /** HTTP calls kept per page and on the server. Default 200. */
    httpCalls?: number;
    /** NgRx change log entries kept per page. Default 200. */
    changeLog?: number;
  };
}

export interface ResolvedNgDevtoolsConfig {
  inspectors: Record<NgDevtoolsInspector, boolean>;
  agent: { readOnly: boolean; tools: Record<NgDevtoolsInspector, boolean> };
  actions: Record<NgDevtoolsAction, boolean>;
  redaction: { secretNames: string[]; unmask: string[] };
  limits: Record<NgDevtoolsLimit, number>;
}

export const NG_DEVTOOLS_CONFIG_KEY = 'ng-devtools';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const MAX_NAMES = 100;
const MAX_NAME_LENGTH = 100;

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const trimmed = value
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim())
    .filter((name) => name && name.length <= MAX_NAME_LENGTH);
  return [...new Set(trimmed)].slice(0, MAX_NAMES);
}

function limit(value: unknown, key: NgDevtoolsLimit): number {
  const { default: fallback, min, max } = NG_DEVTOOLS_LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function flags<K extends string>(
  keys: readonly K[],
  value: (key: K) => boolean,
): Record<K, boolean> {
  return Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<K, boolean>;
}

/** Fills in the defaults. Accepts untrusted input, and its own output unchanged. */
export function resolveNgDevtoolsConfig(config?: unknown): ResolvedNgDevtoolsConfig {
  const input = record(config);
  const agent = record(input['agent']);
  const inspectorInput = record(input['inspectors']);
  const toolInput = record(agent['tools']);
  const actionInput = record(input['actions']);
  const allActions = flag(input['actions'], true);
  const redaction = record(input['redaction']);
  const limits = record(input['limits']);
  const inspectors = flags(NG_DEVTOOLS_INSPECTORS, (key) => flag(inspectorInput[key], true));
  return {
    inspectors,
    agent: {
      readOnly: flag(agent['readOnly'], false),
      tools: flags(NG_DEVTOOLS_INSPECTORS, (key) => inspectors[key] && flag(toolInput[key], true)),
    },
    actions: flags(
      NG_DEVTOOLS_ACTIONS,
      (key) => inspectors[key] && flag(actionInput[key], allActions),
    ),
    redaction: {
      secretNames: names(redaction['secretNames']),
      unmask: names(redaction['unmask']),
    },
    limits: Object.fromEntries(
      (Object.keys(NG_DEVTOOLS_LIMITS) as NgDevtoolsLimit[]).map((key) => [
        key,
        limit(limits[key], key),
      ]),
    ) as Record<NgDevtoolsLimit, number>,
  };
}

/** Reads the config a server published in its connection info (`connectionMeta.configs`). */
export function configFromConnection(
  meta: { configs?: object } | undefined,
): ResolvedNgDevtoolsConfig {
  const configs = meta?.configs as Record<string, unknown> | undefined;
  return resolveNgDevtoolsConfig(configs?.[NG_DEVTOOLS_CONFIG_KEY]);
}

/** Splits the devtools config out of a larger options object. */
export function pickNgDevtoolsConfig<T extends NgDevtoolsConfig>(
  options: T,
): { config: NgDevtoolsConfig; rest: Omit<T, keyof NgDevtoolsConfig> } {
  const { inspectors, agent, actions, redaction, limits, ...rest } = options;
  return { config: { inspectors, agent, actions, redaction, limits }, rest };
}

/** Form actions that change the form or its validity, as opposed to reading or focusing it. */
export const FORM_WRITE_ACTIONS: readonly string[] = [
  'set-value',
  'fill',
  'mark-touched',
  'mark-untouched',
  'mark-dirty',
  'mark-pristine',
  'touch-all',
  'revalidate',
  'reset',
  'enable',
  'disable',
  'submit',
  'restore',
];

/** Router actions that start, stop or repeat a navigation. */
export const ROUTER_WRITE_ACTIONS: readonly string[] = ['navigate', 'abort', 'replay'];

/** Agent tools that perform an action's writes; blocking the action drops them. */
export const ACTION_TOOLS: Record<NgDevtoolsAction, readonly string[]> = {
  forms: ['form-action', 'fill-form'],
  router: ['navigate'],
  ngrx: [],
  http: [],
  analog: ['analog-call-api'],
};

export function actionBlockedMessage(action: NgDevtoolsAction): string {
  const what = {
    forms: 'Writing to forms',
    router: 'Navigating',
    ngrx: 'Restoring NgRx state',
    http: 'Changing HTTP mock rules and clearing HTTP calls',
    analog: 'Calling API routes',
  }[action];
  return `${what} is turned off in the devtools config (actions.${action}).`;
}

/**
 * The inspector each server RPC function belongs to. A function missing here
 * is shared and always registered.
 */
export const RPC_INSPECTOR: Record<string, NgDevtoolsInspector> = {
  'get-components': 'components',
  'push-component-tree': 'components',
  'forget-component-page': 'components',
  'select-component': 'components',
  'request-page-highlight': 'components',
  'get-signals': 'signals',
  'push-signal-graph': 'signals',
  'select-signal-target': 'signals',
  'get-providers': 'injectors',
  'push-injector-tree': 'injectors',
  'forget-injector-page': 'injectors',
  'get-ngrx-store': 'ngrx',
  'push-ngrx-state': 'ngrx',
  'forget-ngrx-page': 'ngrx',
  'ngrx-action-result': 'ngrx',
  'request-ngrx-action': 'ngrx',
  'push-forms': 'forms',
  'forget-forms-page': 'forms',
  'request-form-highlight': 'forms',
  'form-action-result': 'forms',
  'request-form-action': 'forms',
  'forms-lint': 'forms',
  'forms-owners': 'forms',
  'forms-explain': 'forms',
  'get-routes': 'router',
  'push-router': 'router',
  'ping-router': 'router',
  'router-action-result': 'router',
  'request-router-action': 'router',
  'router-lint': 'router',
  'router-match': 'router',
  'router-export': 'router',
  'forget-router-page': 'router',
  'get-pipes': 'pipes',
  'push-pipes': 'pipes',
  'forget-pipes-page': 'pipes',
  'request-instrument-pipes': 'pipes',
  'pipe-lint': 'pipes',
  'push-http': 'http',
  'forget-http-page': 'http',
  'get-http-rules': 'http',
  'set-http-rules': 'http',
  'clear-http-calls': 'http',
};

/**
 * The inspector each agent tool and resource belongs to, without the
 * `ng-devtools:` prefix. RPC functions exposed as tools use `RPC_INSPECTOR`.
 */
export const AGENT_INSPECTOR: Record<string, NgDevtoolsInspector> = {
  'component-tree': 'components',
  highlight: 'components',
  'signal-graph': 'signals',
  'inspect-signals': 'signals',
  'injector-tree': 'injectors',
  'inspect-providers': 'injectors',
  'ngrx-store': 'ngrx',
  forms: 'forms',
  'inspect-forms': 'forms',
  'explain-form-invalid': 'forms',
  'explain-field': 'forms',
  'explain-submit': 'forms',
  'form-payload': 'forms',
  'form-history': 'forms',
  'form-diff': 'forms',
  'lint-forms': 'forms',
  'explain-custom-control': 'forms',
  'export-form': 'forms',
  'wait-for-form': 'forms',
  'form-action': 'forms',
  'fill-form': 'forms',
  router: 'router',
  'inspect-route': 'router',
  'explain-navigation': 'router',
  'list-routes': 'router',
  'lint-routes': 'router',
  'router-config': 'router',
  'export-navigation': 'router',
  'explain-render-mode': 'router',
  navigate: 'router',
  'lint-pipes': 'pipes',
  'explain-pipe': 'pipes',
};

function agentName(id: string): string {
  return id.replace(/^ng-devtools:/, '');
}

function agentInspector(id: string): NgDevtoolsInspector | undefined {
  const name = agentName(id);
  return (
    AGENT_INSPECTOR[name] ??
    RPC_INSPECTOR[name] ??
    (name.startsWith('analog-') ? 'analog' : undefined)
  );
}

export function rpcAllowed(name: string, config: ResolvedNgDevtoolsConfig): boolean {
  const inspector = RPC_INSPECTOR[name];
  return !inspector || config.inspectors[inspector];
}

export function agentAllowed(
  entry: { id: string; safety?: string },
  config: ResolvedNgDevtoolsConfig,
): boolean {
  if (config.agent.readOnly && entry.safety === 'action') return false;
  const name = agentName(entry.id);
  if (NG_DEVTOOLS_ACTIONS.some((key) => !config.actions[key] && ACTION_TOOLS[key].includes(name))) {
    return false;
  }
  const inspector = agentInspector(entry.id);
  return !inspector || config.agent.tools[inspector];
}

const INSPECTOR_LABEL: Record<NgDevtoolsInspector, string> = {
  components: 'Components',
  injectors: 'Injectors',
  signals: 'Signals',
  ngrx: 'NgRx',
  forms: 'Forms',
  router: 'Router',
  pipes: 'Pipes',
  http: 'HTTP',
  analog: 'Analog',
};

const ACTION_LABEL: Record<NgDevtoolsAction, string> = {
  forms: 'Form writes',
  router: 'Navigation',
  ngrx: 'NgRx restore',
  http: 'HTTP mocking',
  analog: 'Analog API calls',
};

const LIMIT_LABEL: Record<NgDevtoolsLimit, (value: number) => string> = {
  refreshMs: (value) => `poll every ${value} ms`,
  navigations: (value) => `${value} navigations`,
  formTimeline: (value) => `${value} form events`,
  httpCalls: (value) => `${value} HTTP calls`,
  changeLog: (value) => `${value} NgRx changes`,
};

/** The options that differ from the defaults, as label and value pairs. Empty when nothing is changed. */
export function summarizeNgDevtoolsConfig(
  config: ResolvedNgDevtoolsConfig,
): { label: string; value: string }[] {
  const items: { label: string; value: string }[] = [];
  const add = (label: string, values: string[]) => {
    if (values.length) items.push({ label, value: values.join(', ') });
  };
  const inspectors = NG_DEVTOOLS_INSPECTORS.filter((key) => config.inspectors[key]);
  add(
    'Inspectors off',
    NG_DEVTOOLS_INSPECTORS.filter((key) => !config.inspectors[key]).map(
      (key) => INSPECTOR_LABEL[key],
    ),
  );
  add('Agent', config.agent.readOnly ? ['Read-only'] : []);
  add(
    'Hidden from the agent',
    inspectors.filter((key) => !config.agent.tools[key]).map((key) => INSPECTOR_LABEL[key]),
  );
  add(
    'Blocked actions',
    NG_DEVTOOLS_ACTIONS.filter((key) => config.inspectors[key] && !config.actions[key]).map(
      (key) => ACTION_LABEL[key],
    ),
  );
  add('Extra secret names', config.redaction.secretNames);
  add('Unmasked names', config.redaction.unmask);
  add(
    'Limits',
    (Object.keys(NG_DEVTOOLS_LIMITS) as NgDevtoolsLimit[])
      .filter((key) => config.limits[key] !== NG_DEVTOOLS_LIMITS[key].default)
      .map((key) => LIMIT_LABEL[key](config.limits[key])),
  );
  return items;
}
