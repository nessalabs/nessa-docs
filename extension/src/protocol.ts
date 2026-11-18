// The messages between the content script (on github.com, which reads the
// repository) and the reader page (the extension's own page in an iframe, which
// builds and draws the docs). They talk over a MessagePort the content script
// hands the reader once, so the GitHub page itself cannot listen in or answer.

import type { DocsRoot } from './github-location';

export interface ListedEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory' | 'symlink' | 'other';
}

export type ReadAnswer =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'too-large'; readonly size: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly reason: string };

/** What the reader is opened with. */
export interface ReaderInit {
  readonly type: 'init';
  readonly root: DocsRoot;
  /** The page file to open first (`docs/state/…md`), or null for the overview. */
  readonly file: string | null;
}

/** Reader → content script: a question with an id, answered once. */
export type Request =
  | { readonly id: number; readonly op: 'list'; readonly path: string }
  | { readonly id: number; readonly op: 'read'; readonly path: string; readonly maxBytes: number };

export type Answer =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly message: string };

/** Reader → content script, no answer. */
export type ReaderEvent =
  /** The reader shows this page file now (null: a page with no file, like Settings). */
  | { readonly type: 'route'; readonly file: string | null };

/** Content script → reader: the address bar moved to another page of the same docs. */
export interface OpenFile {
  readonly type: 'open';
  readonly file: string | null;
}

export const READY = 'nessa-docs:ready';
