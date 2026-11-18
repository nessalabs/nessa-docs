// The catalog's RepositoryFiles port (server/files.ts), backed by GitHub through
// the content script. The repository appears at REPO_ROOT; every path below it
// maps to the same path under the docs folder's prefix on GitHub. GitHub has no
// write, and neither does this.

import { posix } from 'node:path';
import type { DirectoryEntry, PathInspection, ReadOutcome, RepositoryFiles } from '../../server/files';
import type { RepoPort } from './port-client';
import type { ListedEntry } from './protocol';

export const REPO_ROOT = '/repo';

export function repoFiles(port: RepoPort, prefix: string): RepositoryFiles {
  const listings = new Map<string, Promise<readonly ListedEntry[] | null>>();
  const githubPath = (absolute: string): string | null => {
    if (absolute === REPO_ROOT) return prefix.replace(/\/$/, '');
    if (!absolute.startsWith(`${REPO_ROOT}/`)) return null;
    const relative = posix.normalize(absolute.slice(REPO_ROOT.length + 1));
    if (relative === '..' || relative.startsWith('../')) return null;
    return `${prefix}${relative}`;
  };
  const listing = (path: string) => {
    let pending = listings.get(path);
    if (!pending) {
      pending = port.list(path);
      listings.set(path, pending);
      pending.catch(() => listings.delete(path)); // a failed listing is asked again next time
    }
    return pending;
  };
  return {
    async list(directory): Promise<readonly DirectoryEntry[]> {
      const path = githubPath(directory);
      const entries = path === null ? null : await listing(path);
      if (entries === null) throw new Error(`${directory} is not a folder on GitHub`);
      return entries;
    },
    async inspect(absolute): Promise<PathInspection> {
      const path = githubPath(absolute);
      if (path === null) return { kind: 'missing' };
      if (absolute === REPO_ROOT) return { kind: 'directory', realPath: REPO_ROOT };
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const name = path.slice(path.lastIndexOf('/') + 1);
      // A failed listing throws: the catalog load fails and is tried again,
      // instead of reading GitHub's refusal as a missing folder.
      const entries = await listing(parent);
      const entry = entries?.find((candidate) => candidate.name === name);
      if (!entry) return { kind: 'missing' };
      // A symlink's target is not followed on GitHub; it counts as neither file nor folder.
      return { kind: entry.kind === 'file' || entry.kind === 'directory' ? entry.kind : 'other', realPath: posix.normalize(absolute) };
    },
    async readText(absolute, maxBytes, boundary): Promise<ReadOutcome> {
      const path = githubPath(absolute);
      if (path === null || !posix.normalize(absolute).startsWith(`${boundary}/`)) return { kind: 'unreadable', reason: 'outside the accepted folder' };
      try {
        const answer = await port.read(path, maxBytes);
        if (answer.kind === 'text' || answer.kind === 'too-large') return answer;
        return { kind: 'unreadable', reason: answer.kind === 'missing' ? 'not on GitHub at this commit' : answer.reason };
      } catch (error) {
        return { kind: 'unreadable', reason: error instanceof Error ? error.message : 'GitHub did not answer' };
      }
    },
  };
}
