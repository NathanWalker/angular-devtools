import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getBuildMeta, installedVersion, versionFromRange } from '../build-meta.ts';
import { fixtureDir } from './fixture-dir.ts';
import { scan } from './scan.ts';

function install(dir: string, name: string, version: string) {
  const at = join(dir, 'node_modules', name);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, 'package.json'), JSON.stringify({ name, version }));
}

describe('build-meta', () => {
  it('reports installed versions, not package.json ranges', async () => {
    const dir = fixtureDir('ng-devtools-meta-');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'shop',
        dependencies: { '@angular/core': '^21.0.0' },
        devDependencies: { typescript: '~5.9.0' },
      }),
    );
    install(dir, '@angular/core', '21.2.3');
    install(dir, 'typescript', '5.9.2');
    const meta = await scan(getBuildMeta, dir);
    expect(meta).toMatchObject({ angularVersion: '21.2.3', typescript: '5.9.2' });
    expect(installedVersion(dir, 'missing-package')).toBeUndefined();
  });

  it('falls back to a cleaned range when nothing is installed', () => {
    expect(versionFromRange('^21.0.0')).toBe('21.0.0');
    expect(versionFromRange('>=5.4.0 <6')).toBe('5.4.0');
    expect(versionFromRange('~5.9.x')).toBe('5.9.x');
    expect(versionFromRange('npm:typescript@5.8.3')).toBe('5.8.3');
    expect(versionFromRange('workspace:*')).toBe('workspace:*');
    expect(versionFromRange('catalog:')).toBe('catalog:');
    expect(versionFromRange(undefined)).toBe('unknown');
  });
});
