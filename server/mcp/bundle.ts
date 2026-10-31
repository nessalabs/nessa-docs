// One stdio connection owns one transient bundle. Validation builds a candidate
// without filesystem access; compare-and-swap publishes it only if still current.
import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import { loadCatalog } from '../catalog.js';
import { catalogResponse, documentResponse } from '../responses.js';
import type { RepositoryFiles } from '../files.js';
import type { DocumentResponse } from '../../shared/api.js';
import type { BundleSnapshot } from '../../shared/mcp.js';

export const bundleInput = z.object({
  expectedRevision: z.number().int().min(0).describe('0 for a new session; otherwise the revision returned by the last successful replace or read.'),
  files: z.array(z.object({
    path: z.string().max(200).regex(/^docs\/state\/(?:[a-zA-Z0-9_-]+\/)*(?:README|[a-zA-Z0-9_-]+)\.md$/).describe('Bundle-relative path. Include docs/state/README.md as the system root.'),
    markdown: z.string().max(65536).describe('Complete Nessa Docs Markdown including YAML frontmatter: id, title, kind, status, summary, parent, sources, diagramLinks. Use status fixture/proposed for synthetic content; Mermaid fences hold diagrams.'),
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
  private readonly scope = randomUUID();
  private revision = 0;
  private validating = false;
  private snapshot: BundleSnapshot | null = null;

  read(): BundleSnapshot {
    if (!this.snapshot) throw new Error('No documents yet. Call replace_docs with expectedRevision 0 first.');
    return this.snapshot;
  }

  async replace(raw: unknown, signal?: AbortSignal): Promise<BundleSnapshot> {
    signal?.throwIfAborted();
    const input = bundleInput.parse(raw);
    if (input.expectedRevision !== this.revision) throw new Error(`Revision conflict. Current revision is ${this.revision}; read and reconcile before retrying.`);
    if (new Set(input.files.map((file) => file.path)).size !== input.files.length) throw new Error('Duplicate bundle paths are not allowed.');
    if (input.files.reduce((total, file) => total + Buffer.byteLength(file.markdown), 0) > 256 * 1024) throw new Error('Bundle exceeds 256 KiB.');
    if (this.validating) throw new Error('A replacement is already being validated. Read and retry after it finishes.');
    this.validating = true;
    try {
      const files = bundleFiles(input.files);
      const catalog = await loadCatalog(files, '/bundle');
      if (!catalog.rootId || catalog.issues.some((issue) => issue.severity === 'error')) {
        throw new Error(`Invalid document bundle: ${catalog.issues.map((issue) => `${issue.file}: ${issue.message}`).join('; ').slice(0, 4000)}`);
      }
      const documents = await Promise.all([...catalog.documents.keys()].map((id) => documentResponse(catalog, id, files)));
      if (input.expectedRevision !== this.revision) throw new Error(`Revision conflict. Current revision is ${this.revision}; read and reconcile before retrying.`);
      signal?.throwIfAborted();
      const accepted = documents.filter((document): document is DocumentResponse => !('error' in document));
      const snapshot: BundleSnapshot = { files: input.files, scope: this.scope, revision: this.revision + 1, catalog: catalogResponse(catalog), documents: accepted };
      this.snapshot = snapshot;
      this.revision = snapshot.revision;
      return snapshot;
    } finally { this.validating = false; }
  }
}
