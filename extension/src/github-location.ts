// Which GitHub pages hold a Nessa Docs folder. A page qualifies when its URL is
// a tree or blob view whose path passes through a `docs/state` folder; GitHub's
// own answer for that folder then says where the branch name ends (names may
// hold slashes) and which commit it is at. Nothing here fetches.

/** The folder Nessa Docs reads, relative to the project root (server/catalog.ts STATE_DIRECTORY). */
export const STATE_DIRECTORY = 'docs/state';

export interface DocsPage {
  readonly owner: string;
  readonly repo: string;
  /** The URL's ref and path up to and including `docs/state`, as GitHub's tree URL takes it. */
  readonly folderRest: string;
  /** What follows `docs/state` in the URL ('' for the folder itself), e.g. `services/chat.md`. */
  readonly inside: string;
}

/** Owners GitHub reserves for its own pages, never a repository. */
const RESERVED = new Set(['orgs', 'settings', 'marketplace', 'sponsors', 'topics', 'collections', 'explore', 'notifications', 'login', 'apps', 'features', 'enterprise', 'about', 'pricing', 'search', 'codespaces', 'organizations', 'users']);

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The docs folder a github.com path points into, or null when it points at none. */
export function docsPageOf(pathname: string): DocsPage | null {
  const match = /^\/([^/]+)\/([^/]+)\/(?:tree|blob)\/(.+?)\/?$/.exec(pathname);
  if (!match) return null;
  const [, owner, repo, rest] = match as unknown as [string, string, string, string];
  if (RESERVED.has(owner.toLowerCase())) return null;
  const segments = rest.split('/').map(decodeSegment);
  if (segments.some((segment) => segment === null || segment === '' || segment === '.' || segment === '..')) return null;
  const parts = segments as string[];
  // The first docs/state after at least one ref segment; a ref can not be empty.
  for (let at = 1; at + 1 < parts.length; at++) {
    if (parts[at] === 'docs' && parts[at + 1] === 'state') {
      return {
        owner: decodeSegment(owner) ?? owner,
        repo: decodeSegment(repo) ?? repo,
        folderRest: parts.slice(0, at + 2).join('/'),
        inside: parts.slice(at + 2).join('/'),
      };
    }
  }
  return null;
}

/** Joins repository path segments into a URL path, escaping each segment. */
export function urlPath(path: string): string {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

/** A docs folder at a commit: where it is and how to name it back to GitHub. */
export interface DocsRoot {
  readonly owner: string;
  readonly repo: string;
  /** The branch, tag or commit as the person named it. */
  readonly ref: string;
  /** The commit every read is pinned to, so one page never mixes two versions. */
  readonly commit: string;
  /** The folder holding `docs/state`, relative to the repository ('' at the top, else ending in '/'). */
  readonly prefix: string;
}

/** The GitHub URL that shows a repository path (a file or a folder) at the root's ref. */
export function githubUrl(root: DocsRoot, path: string, kind: 'blob' | 'tree', fragment: string | null = null): string {
  const tail = urlPath(path);
  return `https://github.com/${encodeURIComponent(root.owner)}/${encodeURIComponent(root.repo)}/${kind}/${urlPath(root.ref)}${tail ? `/${tail}` : ''}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
}

/** The URL for a docs page file (`docs/state/x.md`): the folder itself for the root README. */
export function pageUrl(root: DocsRoot, file: string): string {
  if (file === `${STATE_DIRECTORY}/README.md`) return githubUrl(root, `${root.prefix}${STATE_DIRECTORY}`, 'tree');
  return githubUrl(root, `${root.prefix}${file}`, 'blob');
}

/** Same root: the same repository, ref and folder. Names compare without case, as GitHub does. */
export function sameRoot(a: Pick<DocsRoot, 'owner' | 'repo'>, b: Pick<DocsRoot, 'owner' | 'repo'>): boolean {
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();
}
