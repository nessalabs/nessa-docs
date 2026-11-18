// Keeps what the reader has read from GitHub, so opening the same docs again
// needs no network. Every read is pinned to one commit, and a file at a commit
// never changes, so a kept answer never goes stale: it is only dropped for
// space. Kept in the extension's own IndexedDB (this browser only), next to
// the settings.

import type { RepoPort } from './port-client';
import type { ListedEntry, ReadAnswer } from './protocol';
import type { DocsRoot } from './github-location';

/** A kept answer: a listing, or a read that GitHub answered for good. */
export type Kept =
  | { readonly kind: 'list'; readonly entries: readonly ListedEntry[] | null }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'too-large'; readonly size: number; readonly maxBytes: number }
  | { readonly kind: 'missing' };

export interface KeptStore {
  get(key: string): Promise<Kept | undefined>;
  put(key: string, value: Kept): void;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** The same port, answering from the store first and keeping what GitHub answers. */
export function cachedPort(port: RepoPort, root: DocsRoot, store: KeptStore): RepoPort {
  const prefix = `${root.owner}/${root.repo}@${root.commit}:`.toLowerCase();
  const keyOf = (op: 'list' | 'read', path: string) => `${prefix}${op}:${path}`;
  const kept = async (key: string) => {
    try {
      return await store.get(key);
    } catch {
      return undefined;
    }
  };
  return {
    async list(path) {
      const key = keyOf('list', path);
      const hit = await kept(key);
      if (hit?.kind === 'list') return hit.entries;
      const entries = await port.list(path);
      store.put(key, { kind: 'list', entries });
      return entries;
    },
    async read(path, maxBytes): Promise<ReadAnswer> {
      const key = keyOf('read', path);
      const hit = await kept(key);
      if (hit?.kind === 'text') {
        const size = bytes(hit.text);
        return size > maxBytes ? { kind: 'too-large', size } : { kind: 'text', text: hit.text };
      }
      // Too large under a limit at least this generous is too large under this one too.
      if (hit?.kind === 'too-large' && hit.maxBytes >= maxBytes) return { kind: 'too-large', size: hit.size };
      if (hit?.kind === 'missing') return hit;
      const answer = await port.read(path, maxBytes);
      if (answer.kind === 'text' || answer.kind === 'missing') store.put(key, answer);
      else if (answer.kind === 'too-large') store.put(key, { ...answer, maxBytes });
      // A failed read is not kept: it is asked again next time.
      return answer;
    },
    tell: (event) => port.tell(event),
  };
}

// ---------------------------------------------------------------- IndexedDB

const DATABASE = 'nessa-docs-cache';
const STORE = 'answers';
/** Answers not used for this long are dropped when the reader starts. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

interface Row {
  readonly key: string;
  readonly value: Kept;
  readonly usedAt: number;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function open(): Promise<IDBDatabase> {
  const req = indexedDB.open(DATABASE, 1);
  req.onupgradeneeded = () => {
    const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
    store.createIndex('usedAt', 'usedAt');
  };
  return request(req);
}

/** The browser's store, or one that keeps nothing when IndexedDB is unavailable (a private window). */
export async function indexedDbStore(now = Date.now()): Promise<KeptStore> {
  let db: IDBDatabase;
  try {
    db = await open();
  } catch {
    return { get: async () => undefined, put: () => undefined };
  }
  // Drop what has not been used for a month.
  try {
    const old = db.transaction(STORE, 'readwrite').objectStore(STORE).index('usedAt').openCursor(IDBKeyRange.upperBound(now - KEEP_MS));
    old.onsuccess = () => {
      const cursor = old.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
  } catch {
    // Nothing to drop, or the store refused: keep going.
  }
  const touched = new Set<string>();
  return {
    async get(key) {
      const row = (await request(db.transaction(STORE).objectStore(STORE).get(key))) as Row | undefined;
      if (row && !touched.has(key)) {
        touched.add(key);
        try { db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...row, usedAt: now } satisfies Row); } catch { /* still served */ }
      }
      return row?.value;
    },
    put(key, value) {
      try {
        db.transaction(STORE, 'readwrite').objectStore(STORE).put({ key, value, usedAt: now } satisfies Row);
      } catch {
        // Full or refused: the answer is just not kept.
      }
    },
  };
}
