// Resolves the reference pills a page contains. The config names each pattern
// and its targets (server/project-config.ts); this file decides where a match
// points and what its peek shows. The browser never builds a target itself:
// it looks each pill up by referenceKey in the table returned here.

import { posix } from 'node:path';
import { type Token, walkTokens } from 'marked';
import type { CatalogIssue, LinkTarget, ReferencePreview, ResolvedReference } from '../shared/api.js';
import { forEachReferenceText, headingSlugs, lexMarkdown, markdownSections, plainText } from '../shared/markdown.js';
import { fillTemplate, findReferences, referenceKey, type ReferenceMatch } from '../shared/references.js';
import { type Catalog, STATE_DIRECTORY } from './catalog.js';
import type { RepositoryFiles } from './files.js';
import { isInside } from './path-containment.js';
import type { OpenTarget, ReferenceConfig } from './project-config.js';

/** At most this many distinct references are resolved per page; the rest show as unresolved. */
export const MAX_REFERENCES_PER_PAGE = 500;
/** At most this many previews per page; later references still link. */
export const MAX_PREVIEWS_PER_PAGE = 100;
/** A preview's body is cut at a block boundary past this many characters. */
export const PREVIEW_MAX_CHARS = 12_000;
const NOTE_MAX_BYTES = 256 * 1024;
/** One path segment filled from a match: no slashes, no `..`. */
const SAFE_SEGMENT = /^[\p{L}\p{N}._ -]+$/u;

export interface ReferenceResolution {
  readonly references: Record<string, ResolvedReference>;
  readonly issues: readonly CatalogIssue[];
}

type Resolve = (href: string, file: string) => Promise<LinkTarget>;

/** Per-request memory: listings and note reads are shared by every reference on the page. */
interface Scratch {
  readonly listings: Map<string, Promise<readonly string[] | null>>;
  readonly notes: Map<string, Promise<string | null>>;
  previews: number;
}

export async function resolvePageReferences(
  catalog: Catalog,
  file: string,
  documentId: string,
  tokens: readonly Token[],
  files: RepositoryFiles,
  resolveLink: Resolve,
): Promise<ReferenceResolution> {
  const configured = catalog.config.references;
  if (configured.length === 0) return { references: {}, issues: [] };
  const rules = configured.map((reference) => reference.rule);
  const byName = new Map(configured.map((reference) => [reference.rule.name, reference]));

  // One pass over the page's text runs collects each distinct (rule, text) once.
  const unique = new Map<string, ReferenceMatch>();
  forEachReferenceText(tokens, (text) => {
    for (const match of findReferences(text, rules)) {
      const key = referenceKey(match.rule, match.text);
      if (!unique.has(key)) unique.set(key, match);
    }
  });

  const scratch: Scratch = { listings: new Map(), notes: new Map(), previews: 0 };
  const references: Record<string, ResolvedReference> = {};
  const issues: CatalogIssue[] = [];
  let count = 0;
  for (const [key, match] of unique) {
    const reference = byName.get(match.rule) as ReferenceConfig;
    const label = fillTemplate(reference.label, match) ?? match.text;
    count += 1;
    const resolved: Omit<ResolvedReference, 'rule' | 'label'> = count > MAX_REFERENCES_PER_PAGE
      ? { target: { kind: 'unresolved', reason: `more than ${MAX_REFERENCES_PER_PAGE} different references on one page` }, preview: null }
      : await resolveOne(reference, match, catalog, files, resolveLink, scratch);
    references[key] = { rule: match.rule, label, ...resolved };
    if (resolved.target.kind === 'unresolved') {
      issues.push({
        file,
        code: 'unresolved-reference',
        severity: 'warning',
        message: `${match.text} (${match.rule}): ${resolved.target.reason}`,
        documentId,
      });
    }
  }
  return { references, issues };
}

async function resolveOne(
  reference: ReferenceConfig,
  match: ReferenceMatch,
  catalog: Catalog,
  files: RepositoryFiles,
  resolveLink: Resolve,
  scratch: Scratch,
): Promise<Omit<ResolvedReference, 'rule' | 'label'>> {
  const reasons: string[] = [];
  for (const target of reference.open) {
    const outcome = await tryTarget(target, match, catalog, files, resolveLink, scratch);
    if (outcome.kind === 'resolved') return { target: outcome.target, preview: outcome.preview };
    if (outcome.kind === 'final') return { target: { kind: 'unresolved', reason: outcome.reason }, preview: null };
    reasons.push(outcome.reason);
  }
  return { target: { kind: 'unresolved', reason: reasons.join('; ') || 'no target' }, preview: null };
}

type Attempt =
  | { readonly kind: 'resolved'; readonly target: LinkTarget; readonly preview: ReferencePreview | null }
  /** Not here; try the next target. */
  | { readonly kind: 'next'; readonly reason: string }
  /** Stop: guessing between several would be wrong. */
  | { readonly kind: 'final'; readonly reason: string };

async function tryTarget(
  target: OpenTarget,
  match: ReferenceMatch,
  catalog: Catalog,
  files: RepositoryFiles,
  resolveLink: Resolve,
  scratch: Scratch,
): Promise<Attempt> {
  const heading = target.kind === 'url' || target.heading === null ? null : fillTemplate(target.heading, match);
  if (target.kind === 'url') {
    const url = fillTemplate(target.url, match, encodeURIComponent);
    if (url === null) return { kind: 'next', reason: 'the url template names a group the pattern did not match' };
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { kind: 'next', reason: `${parsed.protocol} links are not followed` };
      return { kind: 'resolved', target: { kind: 'external', url: parsed.href }, preview: null };
    } catch {
      return { kind: 'next', reason: `"${url}" is not a valid URL` };
    }
  }
  if (target.kind === 'document') {
    const id = fillTemplate(target.id, match);
    const document = id === null ? undefined : catalog.documents.get(id);
    if (id === null || document === undefined) return { kind: 'next', reason: `no page with id "${id ?? target.id}"` };
    return previewed(document.summary.file, document.summary.title, document.body, heading, { kind: 'document', id, fragment: null }, resolveLink, scratch);
  }

  // A file, with * allowed in its last part.
  const path = fillTemplate(target.file, match, (value) => (SAFE_SEGMENT.test(value) && value !== '..' && value !== '.' ? value : null));
  if (path === null) return { kind: 'next', reason: 'the file template could not be filled safely from the match' };
  const root = catalog.repoRoot;
  if (root === null) return { kind: 'next', reason: 'the repository could not be read' };
  const directory = posix.dirname(path);
  const name = posix.basename(path);
  let found: string;
  if (name.includes('*')) {
    const listing = await list(files, root, directory, scratch);
    if (listing === null) return { kind: 'next', reason: `no folder ${directory}` };
    const pattern = globRegex(name);
    const hits = listing.filter((entry) => pattern.test(entry));
    if (hits.length === 0) return { kind: 'next', reason: `no file matches ${path}` };
    if (hits.length > 1) return { kind: 'final', reason: `${path} matches ${hits.length} files (${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ', …' : ''}); make the pattern narrower` };
    found = posix.join(directory, hits[0] as string);
  } else {
    found = path;
  }

  // A page in docs/state previews like a document target.
  const documentId = catalog.documentByFile.get(found);
  if (documentId !== undefined) {
    const document = catalog.documents.get(documentId);
    if (document) return previewed(found, document.summary.title, document.body, heading, { kind: 'document', id: documentId, fragment: null }, resolveLink, scratch);
  }
  const absolute = posix.join(root, found);
  const inspection = await files.inspect(absolute);
  if (inspection.kind === 'missing') return { kind: 'next', reason: `no file at ${found}` };
  if (!isInside(inspection.realPath, root)) return { kind: 'final', reason: `${found} resolves outside the repository` };
  const evidence: LinkTarget = { kind: 'repo-file', path: found, fragment: null, exists: true };
  const inNotes = catalog.config.notes.some((note) => found === note || found.startsWith(`${note}/`));
  if (!inNotes || !found.toLowerCase().endsWith('.md') || found.startsWith(`${STATE_DIRECTORY}/`)) {
    if (heading !== null) return { kind: 'next', reason: `${found} is not in a notes folder, so its headings are not read` };
    return { kind: 'resolved', target: evidence, preview: null };
  }
  const text = await readNote(files, root, absolute, scratch);
  if (text === null) return { kind: 'next', reason: `${found} could not be read` };
  return previewed(found, null, stripFrontmatter(text), heading, evidence, resolveLink, scratch);
}

async function previewed(
  file: string,
  title: string | null,
  body: string,
  heading: string | null,
  target: LinkTarget,
  resolveLink: Resolve,
  scratch: Scratch,
): Promise<Attempt> {
  let tokens = lexMarkdown(body);
  let previewTitle = title;
  let fragmentTitle: string | null = null;
  let fragment: string | null = null;
  if (heading !== null) {
    const pattern = globRegex(heading, 'i');
    const sections = markdownSections(tokens).filter((section) => pattern.test(section.title));
    if (sections.length === 0) return { kind: 'next', reason: `no heading matches "${heading}" in ${file}` };
    // Nested headings are part of their section; only count the outermost matches.
    const outer = sections.filter((section) => !sections.some((other) => other !== section && other.start < section.start && section.end <= other.end));
    if (outer.length > 1) return { kind: 'final', reason: `"${heading}" matches ${outer.length} headings in ${file}` };
    const section = outer[0] as (typeof outer)[number];
    fragment = headingSlugs(tokens).get(section.heading) ?? null;
    tokens = tokens.slice(section.start, section.end);
    fragmentTitle = section.title;
  }
  if (previewTitle === null || fragmentTitle !== null) {
    const first = tokens.find((token) => token.type === 'heading');
    previewTitle = fragmentTitle ?? (first && 'tokens' in first ? plainText(first.tokens) : null) ?? posix.basename(file);
  }
  const located: LinkTarget = target.kind === 'document' || target.kind === 'repo-file' ? { ...target, fragment } : target;
  if (scratch.previews >= MAX_PREVIEWS_PER_PAGE) return { kind: 'resolved', target: located, preview: null };
  scratch.previews += 1;
  let text = '';
  let truncated = false;
  for (const token of tokens) {
    if (text.length + token.raw.length > PREVIEW_MAX_CHARS && text.length > 0) {
      truncated = true;
      break;
    }
    text += token.raw;
  }
  if (text.length > PREVIEW_MAX_CHARS) {
    text = text.slice(0, PREVIEW_MAX_CHARS);
    truncated = true;
  }
  const links: Record<string, LinkTarget> = {};
  for (const href of hrefs(lexMarkdown(text))) links[href] = await resolveLink(href, file);
  return { kind: 'resolved', target: located, preview: { title: previewTitle, body: text, truncated, links, file } };
}

function hrefs(tokens: Token[]): string[] {
  const found = new Set<string>();
  walkTokens(tokens, (token) => {
    if ((token.type === 'link' || token.type === 'image') && typeof token.href === 'string') found.add(token.href);
  });
  return [...found];
}

function list(files: RepositoryFiles, root: string, directory: string, scratch: Scratch): Promise<readonly string[] | null> {
  let pending = scratch.listings.get(directory);
  if (!pending) {
    pending = (async () => {
      const absolute = posix.join(root, directory);
      const inspection = await files.inspect(absolute);
      if (inspection.kind !== 'directory' || !isInside(inspection.realPath, root)) return null;
      const entries = await files.list(inspection.realPath);
      return entries.filter((entry) => entry.kind === 'file' && !entry.name.startsWith('.')).map((entry) => entry.name).sort();
    })();
    scratch.listings.set(directory, pending);
  }
  return pending;
}

function readNote(files: RepositoryFiles, root: string, absolute: string, scratch: Scratch): Promise<string | null> {
  let pending = scratch.notes.get(absolute);
  if (!pending) {
    pending = (async () => {
      // The file's own folder is the read boundary: the caller already checked the path is inside a notes entry.
      const boundary = await files.inspect(posix.dirname(absolute));
      if (boundary.kind !== 'directory' || !isInside(boundary.realPath, root)) return null;
      const read = await files.readText(absolute, NOTE_MAX_BYTES, boundary.realPath);
      return read.kind === 'text' ? read.text : null;
    })();
    scratch.notes.set(absolute, pending);
  }
  return pending;
}

function stripFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return match ? text.slice(match[0].length) : text;
}

/** `*` matches any run of characters except `/`; everything else is literal. */
function globRegex(glob: string, flags = ''): RegExp {
  const source = glob.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${source}$`, flags);
}
