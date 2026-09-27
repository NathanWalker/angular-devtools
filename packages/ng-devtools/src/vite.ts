import type { Plugin } from 'vite';
import { initDevframe } from 'devframe/initiate';
import ngDevtools from './devframe.ts';
import { analogMiddleware, setDevOrigin } from './analog-server-log.ts';
import { analogConfig } from './rpc/analog-scan.ts';

export interface NgDevtoolsViteOptions {
  base?: string;
  apiPrefix?: string;
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
  return ip === '::1' || ip.startsWith('127.');
}

export default function ngDevtoolsVite(options: NgDevtoolsViteOptions = {}): Plugin {
  const base = options.base ?? '/__ng-devtools/';
  return {
    name: 'ng-devtools',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      const apiPrefix = options.apiPrefix ?? analogConfig(server.config.root).apiPrefix;
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url.endsWith('/__connection.json') && !url.startsWith(base)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (url.startsWith(base) && !isLoopback(req.socket?.remoteAddress)) {
          res.statusCode = 403;
          res.end('ng-devtools only answers requests from this machine.');
          return;
        }
        next();
      });
      server.middlewares.use(analogMiddleware(apiPrefix));
      const devtools = initDevframe(ngDevtools, {
        base,
        ws: false,
        auth: false,
        allowedOrigins: false,
      });
      server.middlewares.use(devtools.nodeMiddleware);
      server.httpServer?.once('listening', () => {
        setDevOrigin(server.resolvedUrls?.local[0]);
      });
    },
  };
}
