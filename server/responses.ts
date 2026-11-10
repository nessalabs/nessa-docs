// Builds the API's JSON bodies from a loaded catalog.

import { type Token, walkTokens } from 'marked';
import type {
  CatalogResponse,
  Crumb,
  DocumentResponse,
  LinkTarget,
  SearchResponse,
  SearchResult,
  UnknownDocumentResponse,
} from '../shared/api.js';
import { lexMarkdown } from '../shared/markdown.js';
import type { Catalog } from './catalog.js';
import type { RepositoryFiles } from './files.js';
import { resolveReference } from './links.js';
import { referenceRules } from './project-config.js';
import { resolvePageReferences } from './references.js';

export const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 25;

export function catalogResponse(catalog: Catalog): CatalogResponse {
  return {
    version: catalog.version,
    rootId: catalog.rootId,
    documents: [...catalog.documents.values()].map((document) => document.summary),
    issues: catalog.issues,
  };
}

/** Every href in the body, found with the same lexer and options the browser renders with. */
export function markdownHrefs(body: string): string[] {
  return hrefsOf(lexMarkdown(body));
}

function hrefsOf(tokens: Token[]): string[] {
  const hrefs = new Set<string>();
  walkTokens(tokens, (token) => {
    if ((token.type === 'link' || token.type === 'image') && typeof token.href === 'string') hrefs.add(token.href);
  });
  return [...hrefs];
}

export async function documentResponse(
  catalog: Catalog,
  id: string,
  files: RepositoryFiles,
): Promise<DocumentResponse | UnknownDocumentResponse> {
  const document = catalog.documents.get(id);
  if (document === undefined) {
    return {
      error: 'unknown-document',
      id,
      rejected: catalog.issues.filter((issue) => issue.documentId === id && issue.severity === 'error'),
    };
  }
  const file = { kind: 'file', file: document.summary.file } as const;
  const tokens = lexMarkdown(document.body);
  const linkEntries: [string, LinkTarget][] = [];
  for (const href of hrefsOf(tokens)) {
    linkEntries.push([href, await resolveReference(href, file, catalog, files)]);
  }
  const links = Object.fromEntries(linkEntries);
  const pills = await resolvePageReferences(catalog, document.summary.file, id, tokens, files, (href, from) =>
    resolveReference(href, { kind: 'file', file: from }, catalog, files));
  const sources = [];
  for (const raw of document.sources) {
    sources.push({ raw, target: await resolveReference(raw, { kind: 'repository' }, catalog, files) });
  }
  const crumb = (target: string): Crumb => ({ id: target, title: catalog.documents.get(target)?.summary.title ?? target });
  const diagramLinks = Object.fromEntries([...document.diagramLinks].map(([node, target]) => [node, crumb(target)]));

  const breadcrumbs: Crumb[] = [];
  for (let current: string | null = id; current !== null; ) {
    breadcrumbs.unshift(crumb(current));
    current = catalog.documents.get(current)?.summary.parent ?? null;
  }
  return {
    version: catalog.version,
    document: document.summary,
    body: document.body,
    links,
    sources,
    diagramLinks,
    diagramDetails: document.diagramDetails,
    breadcrumbs,
    children: document.summary.children.flatMap((child) => {
      const summary = catalog.documents.get(child)?.summary;
      return summary ? [summary] : [];
    }),
    issues: pills.issues.length > 0 ? [...document.warnings, ...pills.issues] : document.warnings,
    referenceRules: referenceRules(catalog.config),
    references: pills.references,
    cards: catalog.config.cards,
    work: document.work,
  };
}

export function searchResponse(catalog: Catalog, rawQuery: string): SearchResponse {
  const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { query, results: [] };
  const scored: { score: number; result: SearchResult }[] = [];
  for (const document of catalog.documents.values()) {
    const { id, title, kind, summary } = document.summary;
    const text = plainText(document.body);
    const fields = [
      { value: title.toLowerCase(), weight: 10 },
      { value: id, weight: 6 },
      { value: summary.toLowerCase(), weight: 4 },
      { value: text.toLowerCase(), weight: 1 },
    ];
    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      const termScore = fields.reduce((sum, field) => sum + (field.value.includes(term) ? field.weight : 0), 0);
      if (termScore === 0) matchedAll = false;
      score += termScore;
    }
    if (!matchedAll) continue;
    scored.push({ score, result: { id, title, kind, snippet: snippet(summary, text, terms) } });
  }
  scored.sort((a, b) => b.score - a.score || a.result.title.localeCompare(b.result.title));
  return { query, results: scored.slice(0, MAX_RESULTS).map((entry) => entry.result) };
}

function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippet(summary: string, text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const at = Math.min(...terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0));
  if (!Number.isFinite(at) || summary.toLowerCase().includes(terms[0] ?? '')) return summary.slice(0, 200);
  const start = Math.max(0, at - 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, start + 180)}${start + 180 < text.length ? '…' : ''}`;
}
