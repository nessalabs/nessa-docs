import { MAX_BUNDLE_FILES } from './mcp-limits.js';
// Validate the bridge payload before allowing it into the shared renderer.
import { z } from 'zod';
import { CARD_FAMILIES, DOCUMENT_KINDS, DOCUMENT_STATUSES, PREVIEW_GIST_MAX, PREVIEW_TITLE_MAX } from './api.js';
import { GLOSSARY_RULE, MAX_GLOSSARY_TERMS, MAX_PATTERN_LENGTH, MAX_REFERENCE_RULES } from './references.js';
import { BROKEN_RULE_LIMITS } from './model-check.js';
import { LIFECYCLE_EVENTS, LIFECYCLE_STATES } from './lifecycle.js';
import type { BundleSnapshot } from './mcp.js';
const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const sentence = z.string().min(1).max(BROKEN_RULE_LIMITS.sentence);
const modelLink = z.object({ spec: z.string(), config: z.string(), steps: z.record(z.string(), sentence) }).strict();
const brokenRule = z.object({ rule: z.string(), path: z.array(sentence).min(1).max(BROKEN_RULE_LIMITS.path), states: z.array(z.string()) }).strict();
const modelCheck = z.object({
  sourceRevision: z.string().optional(), checker: z.string(), date: z.string(), config: z.string(), modelDigest: z.string(),
  states: z.number().int().nonnegative(), held: z.array(z.string()), broke: z.array(brokenRule), unchecked: z.array(z.string()),
  stop: z.enum(['states', 'time']).optional(),
}).strict();
const lifecycleState = z.enum(LIFECYCLE_STATES);
const workSummary = z.object({ state: z.enum([...LIFECYCLE_STATES, 'stale']), lastRecordAt: z.string().nullable(), tasks: z.number().int().nonnegative(), open: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(), refused: z.number().int().nonnegative() }).strict();
const summary = z.object({
  id, title: z.string(), kind: z.enum(DOCUMENT_KINDS), status: z.enum(DOCUMENT_STATUSES), summary: z.string(), parent: id.nullable(), children: z.array(id), file: z.string(), sourceRevision: z.string().optional(),
  model: modelLink.optional(), modelCheck: modelCheck.optional(), modelCheckStale: z.boolean().optional(), work: workSummary.optional(),
}).strict();
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
const elementTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), node: z.string() }).strict(),
  z.object({ kind: z.literal('edge'), from: z.string(), to: z.string(), label: z.string(), element: z.string() }).strict(),
]);
const evidence = z.object({ kind: z.enum(['pr', 'commit', 'check', 'diff']), value: z.string().max(300) }).strict();
const workRecord = z.object({
  file: z.string(), task: id.nullable(), event: z.enum(LIFECYCLE_EVENTS), state: lifecycleState, at: z.string(), by: z.string(), model: z.string().optional(), sourceRevision: z.string().optional(),
  evidence: z.array(evidence), body: z.string().max(4000), refused: z.string().nullable(),
}).strict();
const workTask = z.object({ id, title: z.string(), anchor: z.object({ diagram: z.number().int().nonnegative(), target: elementTarget }).strict().nullable(), dependsOn: z.array(id), state: lifecycleState, lastRecordAt: z.string().nullable(), lastBy: z.string().nullable() }).strict();
const pageWork = z.object({ summary: workSummary, recorded: lifecycleState, tasks: z.array(workTask), records: z.array(workRecord), quietAfterMs: z.number().positive() }).strict();
const preview = z.object({ title: z.string().max(PREVIEW_TITLE_MAX), body: z.string().max(65536), truncated: z.boolean(), links: z.record(z.string(), target), file: z.string(), gist: z.string().max(PREVIEW_GIST_MAX) }).strict();
const reference = z.object({ rule: z.string(), label: z.string().max(500), target, preview: preview.nullable() }).strict();
const card = z.object({ name: z.string(), look: z.enum(['lifecycle', 'handoff', 'map', 'plain']), family: z.enum(CARD_FAMILIES), label: z.string().max(60) }).strict();
const rule = z.union([
  z.object({ name: z.string(), match: z.string().max(MAX_PATTERN_LENGTH) }).strict(),
  z.object({ name: z.literal(GLOSSARY_RULE), terms: z.array(z.string().max(32)).max(MAX_GLOSSARY_TERMS) }).strict(),
]);
const response = z.object({ version: z.string(), document: summary, body: z.string().max(65536), links: z.record(z.string(), target), sources: z.array(z.object({ raw: z.string(), target })), diagramLinks: z.record(z.string(), crumb), linkedOverviews: z.record(z.string(), preview), diagramDetails: z.array(detail), breadcrumbs: z.array(crumb), children: z.array(summary), issues: z.array(issue),
  referenceRules: z.array(rule).max(MAX_REFERENCE_RULES + 1), references: z.record(z.string(), reference), cards: z.record(z.string(), card), work: pageWork.nullable() });
const bundleFile = z.union([z.object({ path: z.string(), markdown: z.string().max(65536) }).strict(), z.object({ path: z.string(), text: z.string().max(65536) }).strict()]);
export const snapshotSchema = z.object({ storage: z.discriminatedUnion('kind', [z.object({kind:z.literal('memory')}), z.object({kind:z.literal('durable'),status:z.enum(['synced','unconfirmed']),projectPath:z.string()})]), files: z.array(bundleFile).min(1).max(MAX_BUNDLE_FILES), scope: z.uuid(), revision: z.number().int().positive(), catalog: z.object({ version: z.string(), rootId: id, documents: z.array(summary).min(1).max(MAX_BUNDLE_FILES), issues: z.array(issue) }), documents: z.array(response).min(1).max(MAX_BUNDLE_FILES) });

// Zod intentionally omits __proto__ in parsed records. Authored map keys are
// data here, so validate each value and rebuild with own data properties.
function authoredRecord<S extends z.ZodType>(raw: unknown, schema: S): Record<string, z.infer<S>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid authored map.');
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, schema.parse(value)]));
}

export function readSnapshot(value: unknown): BundleSnapshot {
  const shape = snapshotSchema.parse(value);
  const raw = z.object({ documents: z.array(z.object({ links: z.unknown(), diagramLinks: z.unknown(), linkedOverviews: z.unknown(), references: z.unknown(), cards: z.unknown() })) }).parse(value);
  const parsed = { ...shape, documents: shape.documents.map((doc, index) => ({ ...doc,
    links: authoredRecord(raw.documents[index]!.links, target),
    diagramLinks: authoredRecord(raw.documents[index]!.diagramLinks, crumb),
    linkedOverviews: Object.fromEntries(Object.entries(authoredRecord(raw.documents[index]!.linkedOverviews, preview)).map(([key, value]) => [key, { ...value, links: authoredRecord((value as { links: unknown }).links, target) }])),
    references: Object.fromEntries(Object.entries(authoredRecord(raw.documents[index]!.references, reference)).map(([key, value]) => [key, value.preview ? { ...value, preview: { ...value.preview, links: authoredRecord((value.preview as { links: unknown }).links, target) } } : value])),
    cards: authoredRecord(raw.documents[index]!.cards, card),
  })) };
  const ids = new Set(parsed.documents.map((doc) => doc.document.id));
  if (ids.size !== parsed.documents.length || !ids.has(parsed.catalog.rootId) || parsed.catalog.documents.some((doc) => !ids.has(doc.id))) throw new Error('Inconsistent document bundle.');
  for (const doc of parsed.documents) {
    if (doc.version !== parsed.catalog.version || Object.values(doc.diagramLinks).some((link) => !ids.has(link.id)) || Object.values(doc.links).some((link) => link.kind === 'document' && !ids.has(link.id))
      || Object.values(doc.references).some((ref) => ref.target.kind === 'document' && !ids.has(ref.target.id))) throw new Error('Document reference is outside this bundle.');
  }
  // The server owns the finite issue-code vocabulary; the UI only displays it.
  return parsed as unknown as BundleSnapshot;
}

export function snapshotFromResult(value: unknown): BundleSnapshot {
  return readSnapshot(z.object({ snapshot: z.unknown() }).parse(value).snapshot);
}
