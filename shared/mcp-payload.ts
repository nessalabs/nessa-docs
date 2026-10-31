// Validate the bridge payload before allowing it into the shared renderer.
import { z } from 'zod';
import { DOCUMENT_KINDS, DOCUMENT_STATUSES } from './api.js';
import type { BundleSnapshot } from './mcp.js';
const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const summary = z.object({ id, title: z.string(), kind: z.enum(DOCUMENT_KINDS), status: z.enum(DOCUMENT_STATUSES), summary: z.string(), parent: id.nullable(), children: z.array(id), file: z.string(), sourceRevision: z.string().optional() });
const crumb = z.object({ id, title: z.string() });
const fragment = z.string().nullable();
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('document'), id, fragment }),
  z.object({ kind: z.literal('anchor'), fragment: z.string() }),
  z.object({ kind: z.literal('repo-file'), path: z.string(), fragment, exists: z.boolean() }),
  z.object({ kind: z.literal('outside-repo'), path: z.string(), fragment }),
  z.object({ kind: z.literal('external'), url: z.url().refine((url) => ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)) }),
  z.object({ kind: z.literal('unresolved'), reason: z.string() }),
]);
const issue = z.object({ file: z.string(), code: z.string(), severity: z.enum(['error', 'warning']), message: z.string(), documentId: id.nullable() });
const detail = z.object({ diagram: z.number().int().nonnegative(), family: z.enum(['state', 'flowchart']), section: z.object({ title: z.string(), index: z.number().int().nonnegative() }), target: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), node: z.string() }),
  z.object({ kind: z.literal('edge'), from: z.string(), to: z.string(), label: z.string(), element: z.string() }),
]) });
const response = z.object({ version: z.string(), document: summary, body: z.string().max(65536), links: z.record(z.string(), target), sources: z.array(z.object({ raw: z.string(), target })), diagramLinks: z.record(z.string(), crumb), diagramDetails: z.array(detail), breadcrumbs: z.array(crumb), children: z.array(summary), issues: z.array(issue) });
export const snapshotSchema = z.object({ files: z.array(z.object({ path: z.string(), markdown: z.string().max(65536) })).min(1).max(16), scope: z.uuid(), revision: z.number().int().positive(), catalog: z.object({ version: z.string(), rootId: id, documents: z.array(summary).min(1).max(16), issues: z.array(issue) }), documents: z.array(response).min(1).max(16) });

// Zod intentionally omits __proto__ in parsed records. Authored map keys are
// data here, so validate each value and rebuild with own data properties.
function authoredRecord<S extends z.ZodType>(raw: unknown, schema: S): Record<string, z.infer<S>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid authored map.');
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, schema.parse(value)]));
}

export function readSnapshot(value: unknown): BundleSnapshot {
  const shape = snapshotSchema.parse(value);
  const raw = z.object({ documents: z.array(z.object({ links: z.unknown(), diagramLinks: z.unknown() })) }).parse(value);
  const parsed = { ...shape, documents: shape.documents.map((doc, index) => ({ ...doc,
    links: authoredRecord(raw.documents[index]!.links, target),
    diagramLinks: authoredRecord(raw.documents[index]!.diagramLinks, crumb),
  })) };
  const ids = new Set(parsed.documents.map((doc) => doc.document.id));
  if (ids.size !== parsed.documents.length || !ids.has(parsed.catalog.rootId) || parsed.catalog.documents.some((doc) => !ids.has(doc.id))) throw new Error('Inconsistent document bundle.');
  for (const doc of parsed.documents) {
    if (doc.version !== parsed.catalog.version || Object.values(doc.diagramLinks).some((link) => !ids.has(link.id)) || Object.values(doc.links).some((link) => link.kind === 'document' && !ids.has(link.id))) throw new Error('Document reference is outside this bundle.');
  }
  // The server owns the finite issue-code vocabulary; the UI only displays it.
  return parsed as unknown as BundleSnapshot;
}

export function snapshotFromResult(value: unknown): BundleSnapshot {
  return readSnapshot(z.object({ snapshot: z.unknown() }).parse(value).snapshot);
}
