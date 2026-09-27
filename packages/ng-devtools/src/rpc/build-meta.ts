import { defineRpcFunction } from 'devframe';
import * as v from 'valibot';
import { describable } from './agent-schema.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analogConfig, analogVersion } from './analog-scan.ts';

const BuildMetaSchema = v.object({
  angularVersion: v.string(),
  projectName: v.string(),
  typescript: v.string(),
  ssr: v.boolean(),
  analog: v.optional(v.string()),
  builtAt: v.number(),
});

export const getBuildMeta = defineRpcFunction({
  name: 'build-meta',
  type: 'static',
  jsonSerializable: true,
  snapshot: true,
  args: [],
  returns: describable(BuildMetaSchema),
  agent: {
    description:
      'Angular project metadata: framework version, TypeScript version, SSR status. Baked into static builds. Call this before suggesting dependency or config changes.',
    title: 'Angular build metadata',
  },
  setup: (ctx) => ({
    handler: async () => {
      const pkg = readJson(join(ctx.cwd, 'package.json'));
      const angularJson = readJson(join(ctx.cwd, 'angular.json'));

      const deps = { ...pkg['dependencies'], ...pkg['devDependencies'] };
      const angularVersion = (deps['@angular/core'] ?? 'unknown').replace(/^\^|~/, '');
      const typescript = (deps['typescript'] ?? 'unknown').replace(/^\^|~/, '');

      const defaultProject =
        angularJson?.['defaultProject'] ??
        Object.keys(angularJson?.['projects'] ?? {})[0] ??
        pkg['name'] ??
        'unknown';

      const projectConfig = angularJson?.['projects']?.[defaultProject];
      const hasSsr = !!(
        projectConfig?.architect?.build?.options?.ssr ||
        projectConfig?.architect?.build?.options?.server
      );

      const analog = analogVersion(ctx.cwd);
      return {
        angularVersion,
        projectName: defaultProject,
        typescript,
        ssr: analog ? analogConfig(ctx.cwd).ssr !== false : hasSsr,
        ...(analog ? { analog: analog.replace(/^\^|~/, '') } : {}),
        builtAt: Date.now(),
      };
    },
  }),
});

function readJson(path: string): Record<string, any> {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}
