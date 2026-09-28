import { Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import type { WsOriginRegistry } from 'devframe/rpc/transports/ws-server';
import { isLoopbackHostname } from 'devframe/utils/origin';
import { NG_DEVTOOLS_HUB_BASE, initNgDevtoolsHub } from './hub.ts';
import { analogMiddleware, setDevOrigin } from './analog-server-log.ts';
import { analogConfig } from './rpc/analog-scan.ts';
import { stopAnalog } from './rpc/analog-register.ts';
import { httpRegistry } from './http-rules.ts';

export interface NgDevtoolsViteOptions {
  base?: string;
  apiPrefix?: string;
  allowedOrigins?: string[];
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
  const path = requestPath(url);
  return path === base.replace(/\/$/, '') || path.startsWith(base);
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

export function guardNewUpgrades(
  server: HttpServer,
  before: readonly Function[],
  base: string,
  policy: HubOriginPolicy = {},
) {
  for (const listener of server.listeners('upgrade') as UpgradeListener[]) {
    if (before.includes(listener)) continue;
    server.off('upgrade', listener);
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!isHubPath(req.url, base) || isAllowedHubRequest(req, policy)) {
        listener(req, socket, head);
      } else socket.destroy();
    });
  }
}

export default function ngDevtoolsVite(options: NgDevtoolsViteOptions = {}): Plugin {
  const base = options.base ?? NG_DEVTOOLS_HUB_BASE;
  return {
    name: 'ng-devtools',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      const apiPrefix = options.apiPrefix ?? analogConfig(server.config.root).apiPrefix;
      const policy: HubOriginPolicy = {
        allowedHosts: server.config.server?.allowedHosts,
        allowedOrigins: options.allowedOrigins,
      };
      server.middlewares.use(hubRequestGate(base, policy));
      server.middlewares.use(analogMiddleware(apiPrefix));
      const shared = server.httpServer instanceof HttpServer ? server.httpServer : null;
      const upgradesBefore = shared?.listeners('upgrade') ?? [];
      const devtools = initNgDevtoolsHub({
        base,
        ...(server.httpServer instanceof HttpServer
          ? { server: server.httpServer }
          : { ws: { sidecar: true } }),
        auth: false,
        allowedOrigins: hubOriginRegistryFor(policy),
      });
      if (shared) guardNewUpgrades(shared, upgradesBefore, base, policy);
      server.middlewares.use(devtools.nodeMiddleware);
      server.httpServer?.once('listening', () => {
        setDevOrigin(server.resolvedUrls?.local[0]);
      });
      server.httpServer?.once('close', () => {
        httpRegistry().dispose?.();
        stopAnalog();
        void devtools.close();
      });
    },
  };
}
