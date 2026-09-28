import type { HttpCall, HttpRule } from './http-rules.ts';
import type { PayloadSummary } from './http-payload.ts';
import type { HydrationMismatch } from './http-hydration.ts';

export interface ComponentNode {
  id: string;
  selector: string;
  file: string;
  inputs: string[];
  outputs: string[];
  children: ComponentNode[];
}

export interface RouteInfo {
  path: string;
  component?: string;
  redirectTo?: string;
  title?: string;
  hasChildren: boolean;
  guards?: string[];
}

export type SignalNodeKind =
  | 'signal'
  | 'computed'
  | 'linkedSignal'
  | 'effect'
  | 'template'
  | 'afterRenderEffectPhase'
  | 'childSignalProp'
  | 'unknown';

export interface SignalGraphNode {
  id: string;
  kind: SignalNodeKind;
  label?: string;
  epoch: number;
  value?: unknown;
}

export interface SignalGraphEdge {
  consumer: number;
  producer: number;
}

export interface SignalChange {
  epoch: number;
  value: unknown;
  /** Page clock, ms since epoch. */
  at: number;
  /** `write` is captured on set; `sample`/`initial` come from polling and may skip values. */
  source: 'write' | 'sample' | 'initial';
  /** Changes between this sample and the previous entry whose values weren't seen. */
  missed?: number;
}

export interface SignalGraphComponent {
  id: string;
  name: string;
  tag: string;
  path: string;
}

export interface SignalGraph {
  nodes: SignalGraphNode[];
  edges: SignalGraphEdge[];
  componentSelector?: string;
  component?: SignalGraphComponent;
  source?: 'selected' | 'routed' | 'root';
  pageId?: string;
  /** Recent value changes, keyed by node id, oldest first. */
  history?: Record<string, SignalChange[]>;
}

export interface LiveComponentNode {
  id: string;
  name: string;
  tag: string;
  directives?: string[];
  children: LiveComponentNode[];
}

export interface ComponentProp {
  name: string;
  prop: string;
  value?: unknown;
  listened?: boolean;
}

export interface ComponentDetail {
  id: string;
  name: string;
  tag: string;
  path: string;
  changeDetection?: string;
  encapsulation?: string;
  inputs: ComponentProp[];
  outputs: ComponentProp[];
  listeners: string[];
  directives: { name: string; inputs: ComponentProp[]; outputs: ComponentProp[] }[];
  dependencies: DependencyInfo[];
}

export interface ComponentTreeReport {
  pageId: string;
  roots: LiveComponentNode[];
  count: number;
  truncated?: boolean;
  detail: ComponentDetail | null;
}

export interface ComponentPage extends ComponentTreeReport {
  reportedAt: number;
}

export interface InjectorInfo {
  id: string;
  type: 'element' | 'environment' | 'null';
  name: string;
  providerCount: number;
  component?: string;
  directives?: string[];
  selector?: string;
  path?: string[];
}

export interface ProviderInfo {
  token: string;
  type: 'class' | 'value' | 'factory' | 'existing' | 'unknown';
  isViewProvider: boolean;
  multi?: boolean;
  importPath?: string[];
}

export interface DependencyInfo {
  from: string;
  token: string;
  flags: string[];
  providedBy: string | null;
  providedByName?: string;
}

export interface InjectorTreeNode {
  injector: InjectorInfo;
  providers: ProviderInfo[];
  children: InjectorTreeNode[];
  dependencies?: DependencyInfo[];
}

export interface InjectorTreeReport {
  roots: InjectorTreeNode[];
  environment: InjectorTreeNode[];
}

export interface InjectorPage extends InjectorTreeReport {
  pageId: string;
  reportedAt: number;
}

// --- NgRx Store types ---

export interface NgrxActionInfo {
  name: string;
  source: string;
  file: string;
  line: number;
}

export interface NgrxReducerInfo {
  name: string;
  featureKey?: string;
  actions: string[];
  file: string;
  line: number;
}

export interface NgrxEffectInfo {
  name: string;
  actions: string[];
  file: string;
  line: number;
}

export interface NgrxSelectorInfo {
  name: string;
  file: string;
  line: number;
}

export interface NgrxFeatureInfo {
  name: string;
  featureKey: string;
  file: string;
  line: number;
}

export interface NgrxStoreEntry {
  name: string;
  kind:
    | 'action'
    | 'reducer'
    | 'effect'
    | 'selector'
    | 'feature'
    | 'store-setup'
    | 'signal-store'
    | 'signal-state'
    | 'signal-method';
  file: string;
  line: number;
  detail?: string;
}

export interface NgrxRuntimeAction {
  type: string;
  payload?: unknown;
  timestamp: number;
}

export interface NgrxRuntimeState {
  state: unknown;
  actions: NgrxRuntimeAction[];
}

export interface HydrationStats {
  enabled: boolean;
  hydratedComponents?: number;
  hydratedNodes?: number;
  componentsSkippedHydration?: number;
  deferBlocksWithIncrementalHydration?: number;
  nodes?: { hydrated: number; skipped: number; mismatched: number };
  mismatches: HydrationMismatch[];
  skipHydrationHosts: string[];
  warnings: string[];
  warningsCaptured: boolean;
}

export interface HttpPage {
  pageId: string;
  url: string;
  initialUrl: string;
  title: string;
  payload: PayloadSummary;
  hydration: HydrationStats | null;
  calls: HttpCall[];
  firstSeenAt: number;
  reportedAt: number;
}

export interface HttpState {
  serverCalls: HttpCall[];
  pages: HttpPage[];
  rules: HttpRule[];
}

declare module 'devframe' {
  interface DevframeRpcSharedStates {
    'ng-devtools:component-tree': {
      nodes: LiveComponentNode[];
      pages: Record<string, ComponentPage>;
      selectedId: string | null;
      highlightedId: string | null;
    };
    'ng-devtools:routes': {
      routes: RouteInfo[];
      activeRoute: string | null;
    };
    'ng-devtools:signal-graph': {
      graph: SignalGraph | null;
      pages: Record<string, SignalGraph>;
      selectedNodeId: string | null;
    };
    'ng-devtools:injector-tree': {
      roots: InjectorTreeNode[];
      environment: InjectorTreeNode[];
      pages: Record<string, InjectorPage>;
      selectedInjectorId: string | null;
    };
    'ng-devtools:ngrx-store': import('./ngrx-shared.ts').NgrxState;
    'ng-devtools:http': HttpState;
  }
}
