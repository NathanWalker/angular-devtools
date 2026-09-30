import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import { normalizeHubBase } from '@devframes/hub/constants';
import type { WsOriginRegistry } from 'devframe/rpc/transports/ws-server';
import { isLoopbackHostname } from 'devframe/utils/origin';
import { NG_DEVTOOLS_HUB_BASE, initNgDevtoolsHub } from './hub.ts';
import { analogMiddleware, setDevOrigin } from './analog-server-log.ts';
import { analogConfig, setAnalogRoot } from './rpc/analog-scan.ts';
import { stopAnalog } from './rpc/analog-register.ts';
import { httpRegistry } from './http-rules.ts';
import { pickNgDevtoolsConfig, resolveNgDevtoolsConfig, type NgDevtoolsConfig } from './config.ts';

export type { NgDevtoolsConfig } from './config.ts';

export interface NgDevtoolsViteOptions extends NgDevtoolsConfig {
  base?: string;
  apiPrefix?: string;
  allowedOrigins?: string[];
  auth?: boolean;
}

export interface HubOriginPolicy {
  allowedHosts?: readonly string[] | true;
  allowedOrigins?: readonly string[];
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
  return ip === '::1' || ip.startsWith('127.');
}

function hostAllowed(hostname: string, allowedHosts: HubOriginPolicy['allowedHosts']): boolean {
  if (allowedHosts === true) return true;
  const host = hostname.toLowerCase();
  return (allowedHosts ?? []).some((entry) => {
    const rule = entry.toLowerCase();
    return rule.startsWith('.') ? host === rule.slice(1) || host.endsWith(rule) : host === rule;
  });
}

export function isAllowedHubOrigin(
  origin: string | undefined,
  policy: HubOriginPolicy = {},
): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    if (url.protocol === 'chrome-extension:') return url.hostname !== '';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (policy.allowedOrigins?.includes(url.origin)) return true;
    return isLoopbackHostname(url.hostname) || hostAllowed(url.hostname, policy.allowedHosts);
  } catch {
    return false;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

export function allowsRemoteOrigins(policy: HubOriginPolicy = {}): boolean {
  if (policy.allowedHosts === true) return true;
  const hosts = policy.allowedHosts ?? [];
  if (hosts.some((entry) => !isLoopbackHostname(entry.replace(/^\./, '').toLowerCase()))) {
    return true;
  }
  return (policy.allowedOrigins ?? []).some((origin) => !isLoopbackOrigin(origin));
}

export function hubAuthFor(policy: HubOriginPolicy, auth?: boolean): boolean {
  return auth ?? allowsRemoteOrigins(policy);
}

export function hubOriginRegistryFor(policy: HubOriginPolicy = {}): WsOriginRegistry {
  return {
    token: '',
    registerFromUrl: () => undefined,
    isAllowed: (origin: string | undefined) => isAllowedHubOrigin(origin, policy),
  };
}

export const hubOriginRegistry: WsOriginRegistry = hubOriginRegistryFor();

function requestPath(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return url ?? '/';
  }
}

export function isHubPath(url: string | undefined, base: string): boolean {
  const hubBase = normalizeHubBase(base);
  const path = requestPath(url);
  return path === hubBase.slice(0, -1) || path.startsWith(hubBase);
}

export function isAllowedHubRequest(req: IncomingMessage, policy: HubOriginPolicy = {}): boolean {
  return isLoopback(req.socket?.remoteAddress) && isAllowedHubOrigin(req.headers?.origin, policy);
}

export function hubRequestGate(base: string, policy: HubOriginPolicy = {}) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const forHub = isHubPath(req.url, base);
    if (requestPath(req.url).endsWith('/__connection.json') && !forHub) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (forHub && !isAllowedHubRequest(req, policy)) {
      res.statusCode = 403;
      res.end('ng-devtools only answers requests from this machine.');
      return;
    }
    next();
  };
}

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

export function hubUpgradeListener(
  base: string,
  policy: HubOriginPolicy,
  handleUpgrade: UpgradeListener,
): UpgradeListener {
  return (req, socket, head) => {
    if (!isHubPath(req.url, base)) return;
    if (isAllowedHubRequest(req, policy)) handleUpgrade(req, socket, head);
    else socket.destroy();
  };
}

export function releaseServerState(owner: unknown) {
  const registry = httpRegistry();
  if (registry.owner === owner) registry.dispose?.();
  stopAnalog(owner);
}

export default function ngDevtoolsVite(options: NgDevtoolsViteOptions = {}): Plugin {
  const base = normalizeHubBase(options.base ?? NG_DEVTOOLS_HUB_BASE);
  const { config } = pickNgDevtoolsConfig(options);
  const analog = resolveNgDevtoolsConfig(config).inspectors.analog;
  return {
    name: 'ng-devtools',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      const policy: HubOriginPolicy = {
        allowedHosts: server.config.server?.allowedHosts,
        allowedOrigins: options.allowedOrigins,
      };
      server.middlewares.use(hubRequestGate(base, policy));
      if (analog) {
        setAnalogRoot(server.config.root);
        const apiPrefix = options.apiPrefix ?? analogConfig(server.config.root).apiPrefix;
        server.middlewares.use(analogMiddleware(apiPrefix));
      }
      const httpServer = server.httpServer;
      const devtools = initNgDevtoolsHub({
        ...config,
        base,
        ...(httpServer ? {} : { ws: { sidecar: true } }),
        auth: hubAuthFor(policy, options.auth),
        allowedOrigins: hubOriginRegistryFor(policy),
      });
      httpServer?.on('upgrade', hubUpgradeListener(base, policy, devtools.handleUpgrade));
      server.middlewares.use(devtools.nodeMiddleware);
      httpServer?.once('listening', () => {
        setDevOrigin(server.resolvedUrls?.local[0]);
      });
      httpServer?.once('close', () => {
        void devtools.context
          .then(releaseServerState, () => undefined)
          .finally(() => devtools.close());
      });
    },
  };
}
