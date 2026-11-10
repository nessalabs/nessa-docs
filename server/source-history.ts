// Whether a page's source files changed after the commit it was reviewed at.
// This is what turns an implemented page `stale`. Git is asked once per
// project and revision, through a command that cannot run the project's own
// code: no external diff, no text conversion, no filesystem monitor hook.

import { execFile } from 'node:child_process';

export type SourceChange = 'changed' | 'unchanged' | 'unknown';

export interface SourceHistory {
  /** Whether any of `paths` (repository-relative files or folders) differs in the checkout from `revision`. */
  changedSince(root: string, revision: string, paths: readonly string[]): Promise<SourceChange>;
}

/** Used where there is no checkout to ask, such as an MCP bundle: nothing is ever called stale. */
export const NO_HISTORY: SourceHistory = { changedSince: async () => 'unknown' };

/** Strips a `#fragment` and a trailing slash, so `src/a.ts#L10` and `src/dir/` compare as paths. */
export function sourcePath(entry: string): string {
  return entry.replace(/#.*$/, '').replace(/\/+$/, '');
}

export function touches(changed: ReadonlySet<string>, paths: readonly string[]): boolean {
  const wanted = paths.map(sourcePath).filter((path) => path !== '');
  for (const file of changed) {
    if (wanted.some((path) => file === path || file.startsWith(`${path}/`))) return true;
  }
  return false;
}

type ChangedFiles = (root: string, revision: string) => Promise<ReadonlySet<string> | null>;

export function gitChangedFiles(): ChangedFiles {
  return (root, revision) =>
    new Promise((resolve) => {
      execFile(
        'git',
        ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', root, 'diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', revision, '--'],
        { timeout: 5_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
        (error, stdout) => {
          if (error) resolve(null);
          else resolve(new Set(stdout.split('\0').filter((file) => file !== '')));
        },
      );
    });
}

/** Asks git, remembering each answer for `ttlMs` so a page load does not start one process per page. */
export function cachedHistory(changedFiles: ChangedFiles = gitChangedFiles(), ttlMs = 5_000, now: () => number = Date.now): SourceHistory {
  const cache = new Map<string, { at: number; files: Promise<ReadonlySet<string> | null> }>();
  return {
    async changedSince(root, revision, paths) {
      const key = `${root}\0${revision}`;
      let entry = cache.get(key);
      if (!entry || now() - entry.at > ttlMs) {
        if (cache.size > 256) cache.clear();
        entry = { at: now(), files: changedFiles(root, revision) };
        cache.set(key, entry);
      }
      const files = await entry.files;
      if (files === null) return 'unknown';
      return touches(files, paths) ? 'changed' : 'unchanged';
    },
  };
}
