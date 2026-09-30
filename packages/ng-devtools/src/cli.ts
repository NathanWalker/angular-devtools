import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import type { CAC } from 'cac';

/**
 * Throws when `build` would delete something that is not a previous report.
 * devframe empties the output folder before it writes the report.
 */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(canonical(parent), basename(path));
  }
}

export function checkReportOutDir(outDir: string, options: { cwd?: string; force?: boolean } = {}) {
  const cwd = canonical(resolve(options.cwd ?? process.cwd()));
  const target = canonical(resolve(cwd, outDir));
  const up = relative(target, cwd);
  if (up === '' || (!up.startsWith('..') && !isAbsolute(up))) {
    throw new Error(
      `[ng-devtools] Refusing to build into "${outDir}": it is the working directory or one of its parents, and the build empties it first. Pick a new folder, such as --outDir dist-report.`,
    );
  }
  if (options.force || !existsSync(target)) return;
  const isReport = statSync(target).isDirectory()
    ? readdirSync(target).length === 0 || existsSync(join(target, '__connection.json'))
    : false;
  if (!isReport) {
    throw new Error(
      `[ng-devtools] Refusing to build into "${outDir}": it is not empty and is not a previous report, and the build empties it first. Pick a new folder, or pass --force to replace it.`,
    );
  }
}

/** Adds `--force` to `build` and checks `--outDir` before devframe empties it. */
export function guardReportOutDir(cli: CAC) {
  const build = cli.commands.find((command) => command.name === 'build');
  const run = build?.commandAction;
  if (!build || !run) return;
  build.option('--force', 'Empty --out-dir even when it is not a previous report');
  build.action(async (flags: { outDir: string; force?: boolean }) => {
    try {
      checkReportOutDir(flags.outDir, { force: flags.force });
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
      return;
    }
    await run(flags);
  });
}
