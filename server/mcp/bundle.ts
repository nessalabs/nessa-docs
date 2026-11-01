// One owner validates complete bundles. Optional persistence commits before
// publication; uncertain disk effects are explicit rather than guessed away.
import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import { loadCatalog } from '../catalog.js';
import { catalogResponse, documentResponse } from '../responses.js';
import type { RepositoryFiles } from '../files.js';
import type { DocumentResponse } from '../../shared/api.js';
import type { BundleSnapshot } from '../../shared/mcp.js';

export const bundlePath = z.string().max(200).regex(/^docs\/state\/(?:[a-zA-Z0-9_-]+\/)*(?:README|[a-zA-Z0-9_-]+)\.md$/);
const authoredMarkdown = z.string().max(65536).refine((text) => Buffer.from(text, 'utf8').toString('utf8') === text, 'Markdown must contain well-formed Unicode that round-trips as UTF-8.');
const authoredFiles = z.array(z.object({ path: bundlePath, markdown: authoredMarkdown }).strict()).min(1).max(16);
export const storedBundleSchema = z.object({ scope: z.uuid(), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), files: authoredFiles }).strict();
export type StoredBundle = z.infer<typeof storedBundleSchema>;
export type CommitOutcome =
  | { readonly kind: 'committed'; readonly durable: boolean; readonly projectPath: string }
  | { readonly kind: 'unchanged'; readonly message: string }
  | { readonly kind: 'unknown'; readonly message: string };
export interface BundlePersistence {
  readonly scope: string;
  load(): Promise<{ readonly state: StoredBundle; readonly projectPath: string } | null>;
  commit(state: StoredBundle, signal?: AbortSignal): Promise<CommitOutcome>;
}

export const bundleInput = z.object({
  expectedRevision: z.number().int().min(0).describe('0 only for an empty bundle; otherwise read_docs returns the current revision, including after a durable-store restart.'),
  files: z.array(z.object({
    path: bundlePath.describe('Bundle-relative path. Include docs/state/README.md as the system root.'),
    markdown: authoredMarkdown.describe('Complete Nessa Docs Markdown including YAML frontmatter: id, title, kind, status, summary, parent, sources, diagramLinks. Use status fixture/proposed for synthetic content; Mermaid fences hold diagrams.'),
  }).strict()).min(1).max(16),
}).strict();

/** A closed virtual repository: only submitted Markdown exists, never laptop paths. */
function bundleFiles(entries: readonly { path: string; markdown: string }[]): RepositoryFiles {
  const texts = new Map(entries.map(({ path, markdown }) => [`/bundle/${path}`, markdown]));
  const directories = new Set(['/bundle']);
  for (const path of texts.keys()) {
    for (let parent = posix.dirname(path); parent !== '/'; parent = posix.dirname(parent)) directories.add(parent);
  }
  return {
    async inspect(path) {
      return texts.has(path) ? { kind: 'file', realPath: path } : directories.has(path) ? { kind: 'directory', realPath: path } : { kind: 'missing' };
    },
    async list(directory) {
      return [...directories, ...texts.keys()].filter((path) => path !== directory && posix.dirname(path) === directory)
        .map((path) => ({ name: posix.basename(path), kind: texts.has(path) ? 'file' as const : 'directory' as const }));
    },
    async readText(path, maxBytes, boundary) {
      const text = texts.get(path);
      if (!path.startsWith(`${boundary}/`) || text === undefined) return { kind: 'unreadable', reason: 'Not part of this bundle' };
      const size = Buffer.byteLength(text);
      return size > maxBytes ? { kind: 'too-large', size } : { kind: 'text', text };
    },
  };
}

export class DocumentBundle {
  private readonly scope: string;
  private revision = 0;
  private validating = false;
  private unavailable: string | null = null;
  private snapshot: BundleSnapshot | null = null;

  constructor(private readonly persistence?: BundlePersistence) { this.scope = persistence?.scope ?? randomUUID(); }

  static async open(persistence: BundlePersistence): Promise<DocumentBundle> {
    const owner = new DocumentBundle(persistence);
    const restored = await persistence.load();
    if (restored) {
      const state = storedBundleSchema.parse(restored.state);
      if (state.scope !== owner.scope) throw new Error('Stored bundle belongs to a different store.');
      owner.snapshot = await owner.build(state.files, state.revision, { kind: 'durable', status: 'synced', projectPath: restored.projectPath });
      owner.revision = state.revision;
    }
    return owner;
  }

  read(): BundleSnapshot {
    const snapshot = this.readOptional();
    if (!snapshot) throw new Error('No documents yet. Call replace_docs with expectedRevision 0 first.');
    return snapshot;
  }

  readOptional(): BundleSnapshot | null {
    if (this.unavailable) throw new Error(this.unavailable);
    return this.snapshot;
  }

  private async build(entries: StoredBundle['files'], revision: number, storage: BundleSnapshot['storage']): Promise<BundleSnapshot> {
    const paths = new Set<string>();
    const directories = new Map<string, string>();
    for (const { path } of entries) {
      const folded = path.toLowerCase();
      if (paths.has(folded)) throw new Error('Duplicate bundle paths are not allowed, including letter-case variants.');
      paths.add(folded);
      for (let parent = posix.dirname(path); parent !== 'docs/state'; parent = posix.dirname(parent)) {
        const existing = directories.get(parent.toLowerCase());
        if (existing && existing !== parent) throw new Error('Duplicate bundle paths are not allowed, including letter-case variants.');
        directories.set(parent.toLowerCase(), parent);
      }
    }
    if (entries.reduce((total, file) => total + Buffer.byteLength(file.markdown), 0) > 256 * 1024) throw new Error('Bundle exceeds 256 KiB.');
    const files = bundleFiles(entries);
    const catalog = await loadCatalog(files, '/bundle');
    if (!catalog.rootId || catalog.issues.some((issue) => issue.severity === 'error')) {
      throw new Error(`Invalid document bundle: ${catalog.issues.map((issue) => `${issue.file}: ${issue.message}`).join('; ').slice(0, 4000)}`);
    }
    const documents = await Promise.all([...catalog.documents.keys()].map((id) => documentResponse(catalog, id, files)));
    const accepted = documents.filter((document): document is DocumentResponse => !('error' in document));
    return { files: entries, scope: this.scope, revision, storage, catalog: catalogResponse(catalog), documents: accepted };
  }

  async replace(raw: unknown, signal?: AbortSignal): Promise<BundleSnapshot> {
    signal?.throwIfAborted();
    if (this.unavailable) throw new Error(this.unavailable);
    const input = bundleInput.parse(raw);
    if (input.expectedRevision !== this.revision) throw new Error(`Revision conflict. Current revision is ${this.revision}; read and reconcile before retrying.`);
    if (this.revision === Number.MAX_SAFE_INTEGER) throw new Error('Revision limit reached. Start a new document store.');
    if (this.validating) throw new Error('A replacement is already being validated. Read and retry after it finishes.');
    this.validating = true;
    try {
      let snapshot = await this.build(input.files, this.revision + 1, { kind: 'memory' });
      signal?.throwIfAborted();
      let unconfirmed = false;
      if (this.persistence) {
        const outcome = await this.persistence.commit({ files: input.files, scope: this.scope, revision: snapshot.revision }, signal);
        if (outcome.kind === 'unchanged') throw new Error(outcome.message);
        if (outcome.kind === 'unknown') {
          this.unavailable = 'Durable commit outcome is unknown. Stop and reopen the store before reading or writing again.';
          throw new Error(this.unavailable);
        }
        unconfirmed = !outcome.durable;
        snapshot = { ...snapshot, storage: { kind: 'durable', status: outcome.durable ? 'synced' : 'unconfirmed', projectPath: outcome.projectPath } };
      }
      // After a manifest is published, cancellation cannot turn it into rollback.
      this.snapshot = snapshot;
      this.revision = snapshot.revision;
      if (unconfirmed) throw new Error(`Revision ${snapshot.revision} is visible, but durable sync was not confirmed. Read and reconcile before retrying.`);
      return snapshot;
    } finally { this.validating = false; }
  }
}
