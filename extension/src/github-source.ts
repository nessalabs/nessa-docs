// Reads a repository on GitHub for the reader, from the content script. Two
// ways in, tried in order:
//
// 1. The person's github.com session: the same JSON GitHub's own file view asks
//    for (`Accept: application/json` on a tree URL) and `/raw/` for file text.
//    Same-origin requests, so a private repository works for anyone who can see
//    it on the page, and no token is needed.
// 2. The REST API (api.github.com), with the optional token from the extension
//    options when one is saved. Public repositories work without it.
//
// Every read names one commit, so a page is never built from two versions.

import { type DocsPage, type DocsRoot, STATE_DIRECTORY, urlPath } from './github-location';
import type { ListedEntry, ReadAnswer } from './protocol';

export type Transport = 'session' | 'rest';

export interface RepoReader {
  readonly root: DocsRoot;
  readonly transport: Transport;
  /** The entries of a repository folder (repository-relative, '' at the top), or null when it does not exist. */
  list(directory: string): Promise<readonly ListedEntry[] | null>;
  /** A repository file's text, refused past `maxBytes`. */
  read(path: string, maxBytes: number): Promise<ReadAnswer>;
}

export type Resolution =
  | { readonly kind: 'docs'; readonly reader: RepoReader }
  /** GitHub answered and there is no Nessa Docs folder here (no docs/state/README.md). */
  | { readonly kind: 'not-docs' }
  | { readonly kind: 'failed'; readonly message: string };

/** Folder listings are GitHub page requests; file text comes from its CDN, which takes more at once. */
const LIST_PARALLEL = 8;
const READ_PARALLEL = 24;

/** At most `parallel` requests at once, so a large folder does not flood GitHub. */
function limiter(parallel: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= parallel) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await task();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}

/**
 * Firefox runs content-script fetches as the extension, not the page; its
 * `content.fetch` is the page's own, which carries the github.com session.
 * Chrome's content-script fetch already does.
 */
function pageFetch(): typeof fetch {
  const content = (globalThis as { content?: { fetch?: typeof fetch } }).content;
  return typeof content?.fetch === 'function' ? content.fetch.bind(content) : fetch.bind(globalThis);
}

interface TreeItem {
  readonly name: string;
  readonly contentType: string;
}
interface TreeRoute {
  readonly path: string;
  readonly refInfo: { readonly name: string; readonly currentOid: string };
  readonly tree: { readonly items: readonly TreeItem[] };
}

const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** GitHub's tree JSON, checked at this boundary; null when it is not that shape. */
function treeRoute(body: unknown): TreeRoute | null {
  const route = (body as { payload?: { codeViewTreeRoute?: unknown } } | null)?.payload?.codeViewTreeRoute as Partial<TreeRoute> | undefined;
  if (!route || typeof route.path !== 'string') return null;
  const ref = route.refInfo;
  if (!ref || typeof ref.name !== 'string' || typeof ref.currentOid !== 'string' || !COMMIT.test(ref.currentOid)) return null;
  const items = route.tree?.items;
  if (!Array.isArray(items) || !items.every((item) => typeof item?.name === 'string' && typeof item?.contentType === 'string')) return null;
  return route as TreeRoute;
}

function kindOf(contentType: string): ListedEntry['kind'] {
  if (contentType === 'file') return 'file';
  if (contentType === 'directory') return 'directory';
  if (contentType.startsWith('symlink')) return 'symlink';
  return 'other';
}

async function text(response: Response, maxBytes: number): Promise<ReadAnswer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { kind: 'too-large', size: declared };
  if (!response.body) return { kind: 'text', text: '' };
  // Read in pieces and stop at the limit, so an oversized file without a
  // Content-Length is never downloaded whole.
  const reader = response.body.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      void reader.cancel().catch(() => undefined);
      return { kind: 'too-large', size };
    }
    pieces.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const piece of pieces) { bytes.set(piece, at); at += piece.byteLength; }
  return { kind: 'text', text: new TextDecoder().decode(bytes) };
}

function hasReadme(entries: readonly ListedEntry[] | null): boolean {
  return entries?.some((entry) => entry.name === 'README.md' && entry.kind === 'file') ?? false;
}

// ---------------------------------------------------------------- session

async function sessionTree(owner: string, repo: string, rest: string, signal?: AbortSignal): Promise<TreeRoute | 'missing' | null> {
  let response: Response;
  try {
    response = await pageFetch()(`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${rest}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal,
    });
  } catch {
    return null;
  }
  if (response.status === 404) return 'missing';
  if (!response.ok) return null;
  return treeRoute(await response.json().catch(() => null));
}

/**
 * File text: straight from raw.githubusercontent.com when the repository is
 * public (one request), else through github.com/raw, which checks the session
 * and redirects there with a short-lived token.
 */
function sessionReader(root: DocsRoot, first: readonly ListedEntry[], publicRaw: boolean): RepoReader {
  const listLimit = limiter(LIST_PARALLEL);
  const readLimit = limiter(READ_PARALLEL);
  const repoPath = `${encodeURIComponent(root.owner)}/${encodeURIComponent(root.repo)}`;
  const known = new Map<string, Promise<readonly ListedEntry[] | null>>([[`${root.prefix}${STATE_DIRECTORY}`, Promise.resolve(first)]]);
  const list = (directory: string) => {
    let pending = known.get(directory);
    if (!pending) {
      pending = listLimit(() => sessionTree(root.owner, root.repo, `${root.commit}${directory ? `/${urlPath(directory)}` : ''}`)).then((route) => {
        if (route === null) throw new Error(`GitHub did not list ${directory || 'the repository'}.`);
        return route === 'missing' ? null : route.tree.items.map((item) => ({ name: item.name, kind: kindOf(item.contentType) }));
      });
      known.set(directory, pending);
      pending.catch(() => known.delete(directory)); // asked again next time
    }
    return pending;
  };
  // The reader walks docs/state one folder at a time; list the whole folder at once ahead of it.
  const prefetch = (directory: string) => {
    list(directory).then((entries) => {
      for (const entry of entries ?? []) if (entry.kind === 'directory' && !entry.name.startsWith('.')) prefetch(`${directory}/${entry.name}`);
    }, () => undefined);
  };
  prefetch(`${root.prefix}${STATE_DIRECTORY}`);
  return {
    root,
    transport: 'session',
    list,
    read: (path, maxBytes) => readLimit(async () => {
      const response = publicRaw
        ? await fetch(`https://raw.githubusercontent.com/${repoPath}/${root.commit}/${urlPath(path)}`, { credentials: 'omit' })
        : await pageFetch()(`https://github.com/${repoPath}/raw/${root.commit}/${urlPath(path)}`, { credentials: 'same-origin' });
      if (response.status === 404) return { kind: 'missing' };
      if (!response.ok) return { kind: 'failed', reason: `GitHub answered ${response.status}` };
      return text(response, maxBytes);
    }),
  };
}

/** Whether GitHub's CDN serves this commit without a session: true for a public repository. */
async function rawIsPublic(root: DocsRoot): Promise<boolean> {
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(root.owner)}/${encodeURIComponent(root.repo)}/${root.commit}/${urlPath(`${root.prefix}${STATE_DIRECTORY}/README.md`)}`, { method: 'HEAD', credentials: 'omit' });
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveSession(page: DocsPage): Promise<Resolution | null> {
  const route = await sessionTree(page.owner, page.repo, urlPath(page.folderRest));
  if (route === 'missing') return { kind: 'not-docs' };
  if (route === null) return null;
  if (route.path !== STATE_DIRECTORY && !route.path.endsWith(`/${STATE_DIRECTORY}`)) return { kind: 'not-docs' };
  const entries = route.tree.items.map((item) => ({ name: item.name, kind: kindOf(item.contentType) }));
  if (!hasReadme(entries)) return { kind: 'not-docs' };
  const root: DocsRoot = {
    owner: page.owner,
    repo: page.repo,
    ref: route.refInfo.name,
    commit: route.refInfo.currentOid,
    prefix: route.path.slice(0, route.path.length - STATE_DIRECTORY.length),
  };
  return { kind: 'docs', reader: sessionReader(root, entries, await rawIsPublic(root)) };
}

// ---------------------------------------------------------------- REST

function restHeaders(token: string | null, accept: string): HeadersInit {
  return token ? { Accept: accept, Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } : { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
}

function restReader(root: DocsRoot, token: string | null): RepoReader {
  const limit = limiter(LIST_PARALLEL);
  const contents = (path: string) => `https://api.github.com/repos/${encodeURIComponent(root.owner)}/${encodeURIComponent(root.repo)}/contents/${urlPath(path)}?ref=${root.commit}`;
  const known = new Map<string, readonly ListedEntry[] | null>();
  return {
    root,
    transport: 'rest',
    async list(directory) {
      if (known.has(directory)) return known.get(directory) ?? null;
      const response = await limit(() => fetch(contents(directory), { headers: restHeaders(token, 'application/vnd.github+json'), credentials: 'omit' }));
      if (response.status === 404) { known.set(directory, null); return null; }
      if (!response.ok) throw new Error(`GitHub answered ${response.status} listing ${directory || 'the repository'}.`);
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body)) { known.set(directory, null); return null; }
      const entries = body.flatMap((item: { name?: unknown; type?: unknown }) =>
        typeof item.name === 'string' && typeof item.type === 'string'
          ? [{ name: item.name, kind: item.type === 'dir' ? 'directory' as const : item.type === 'file' ? 'file' as const : item.type === 'symlink' ? 'symlink' as const : 'other' as const }]
          : []);
      known.set(directory, entries);
      return entries;
    },
    read: (path, maxBytes) => limit(async () => {
      const response = await fetch(contents(path), { headers: restHeaders(token, 'application/vnd.github.raw+json'), credentials: 'omit' });
      if (response.status === 404) return { kind: 'missing' };
      if (!response.ok) return { kind: 'failed', reason: `GitHub answered ${response.status}` };
      return text(response, maxBytes);
    }),
  };
}

/** The REST API names refs on its own; try each split of the URL's ref and path until one is a commit. */
async function resolveRest(page: DocsPage, token: string | null): Promise<Resolution> {
  const segments = page.folderRest.split('/');
  const before = segments.length - 2; // segments before docs/state: the ref, then the folder prefix
  let refused: number | null = null;
  for (let refLength = 1; refLength <= before; refLength++) {
    const ref = segments.slice(0, refLength).join('/');
    let response: Response;
    try {
      response = await fetch(`https://api.github.com/repos/${encodeURIComponent(page.owner)}/${encodeURIComponent(page.repo)}/commits/${urlPath(ref)}`, {
        headers: restHeaders(token, 'application/vnd.github.sha'),
        credentials: 'omit',
      });
    } catch {
      return { kind: 'failed', message: 'GitHub did not answer.' };
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) { refused = response.status; break; }
    if (!response.ok) continue;
    const commit = (await response.text()).trim();
    if (!COMMIT.test(commit)) continue;
    const prefixSegments = segments.slice(refLength, before);
    const root: DocsRoot = { owner: page.owner, repo: page.repo, ref, commit, prefix: prefixSegments.length ? `${prefixSegments.join('/')}/` : '' };
    const reader = restReader(root, token);
    let entries: readonly ListedEntry[] | null;
    try {
      entries = await reader.list(`${root.prefix}${STATE_DIRECTORY}`);
    } catch (error) {
      return { kind: 'failed', message: error instanceof Error ? error.message : 'GitHub did not list the docs folder.' };
    }
    return hasReadme(entries) ? { kind: 'docs', reader } : { kind: 'not-docs' };
  }
  if (refused !== null) {
    return {
      kind: 'failed',
      message: token
        ? `GitHub refused the saved token (${refused}). Check it in the extension options.`
        : `GitHub refused the request (${refused}). Sign in to github.com, or save a read-only token in the extension options.`,
    };
  }
  return { kind: 'not-docs' };
}

/**
 * Where the page's docs folder is and how to read it: the session first, then
 * the REST API (with the token when there is one).
 */
export async function resolveDocs(page: DocsPage, token: string | null): Promise<Resolution> {
  const session = await resolveSession(page);
  if (session?.kind === 'docs') return session;
  // A 404 to the session can be a private repository the session does not reach; a token may.
  if (session?.kind === 'not-docs' && !token) return session;
  return resolveRest(page, token);
}
