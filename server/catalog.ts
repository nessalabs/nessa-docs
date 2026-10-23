// Loads docs/state into a validated catalog. Only Markdown files inside
// docs/state are read, through the injected RepositoryFiles seam; every file
// that is not accepted is reported with its path and a typed reason.

import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { CatalogIssue, DiagramDetail, DocumentSummary, IssueCode, IssueSeverity } from '../shared/api.js';
import { lexMarkdown, markdownDiagrams } from '../shared/markdown.js';
import { resolveDiagramDetails } from './diagram-details.js';
import { parseDocumentFile, type ParsedDocument } from './document.js';
import type { RepositoryFiles } from './files.js';
import { isInside } from './path-containment.js';
import { type DiagramReader, readDiagram as readWithMermaid } from './diagram-reader.js';

export const STATE_DIRECTORY = 'docs/state';
export const ROOT_FILE = `${STATE_DIRECTORY}/README.md`;

export interface LoaderLimits {
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly maxDepth: number;
}

export const DEFAULT_LIMITS: LoaderLimits = { maxFiles: 2000, maxBytes: 1024 * 1024, maxDepth: 12 };

export interface CatalogDocument {
  readonly summary: DocumentSummary;
  readonly body: string;
  readonly sources: readonly string[];
  readonly diagramLinks: ReadonlyMap<string, string>;
  /** The `diagramDetails` entries that bound; the rest are among `warnings`. */
  readonly diagramDetails: readonly DiagramDetail[];
  readonly warnings: readonly CatalogIssue[];
}

export interface Catalog {
  readonly version: string;
  /** Canonical repository root, or null when it could not be inspected. */
  readonly repoRoot: string | null;
  readonly rootId: string | null;
  /** Accepted documents in file-path order. */
  readonly documents: ReadonlyMap<string, CatalogDocument>;
  /** Repository-relative file path → accepted document ID. */
  readonly documentByFile: ReadonlyMap<string, string>;
  /** Repository-relative file path → why it was rejected. */
  readonly rejectedFiles: ReadonlyMap<string, readonly CatalogIssue[]>;
  readonly issues: readonly CatalogIssue[];
}

interface Candidate {
  readonly file: string;
  readonly parsed: ParsedDocument;
  readonly warnings: CatalogIssue[];
}

export async function loadCatalog(
  files: RepositoryFiles,
  repoRoot: string,
  limits: LoaderLimits = DEFAULT_LIMITS,
  readDiagram: DiagramReader = readWithMermaid,
): Promise<Catalog> {
  const issues: CatalogIssue[] = [];
  const issue = (
    file: string,
    code: IssueCode,
    message: string,
    documentId: string | null = null,
    severity: IssueSeverity = 'error',
  ): CatalogIssue => {
    const entry = { file, code, severity, message, documentId };
    issues.push(entry);
    return entry;
  };

  const repo = await files.inspect(repoRoot);
  if (repo.kind !== 'directory') {
    issue(STATE_DIRECTORY, 'state-directory-missing', `repository root ${repoRoot} is not a readable directory`);
    return emptyCatalog(null, issues);
  }
  const state = await files.inspect(posix.join(repo.realPath, STATE_DIRECTORY));
  if (state.kind === 'missing' || state.kind === 'file' || state.kind === 'other') {
    issue(STATE_DIRECTORY, 'state-directory-missing', `${STATE_DIRECTORY} does not exist in ${repo.realPath}`);
    return emptyCatalog(repo.realPath, issues);
  }
  if (!isInside(state.realPath, repo.realPath)) {
    issue(STATE_DIRECTORY, 'state-directory-escape', `${STATE_DIRECTORY} resolves outside the repository`);
    return emptyCatalog(repo.realPath, issues);
  }

  // Walk docs/state, reading Markdown files only.
  const texts: { file: string; text: string }[] = [];
  let fileCount = 0;
  let stopped = false;
  const walk = async (absolute: string, relative: string, depth: number): Promise<void> => {
    const entries = [...(await files.list(absolute))].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (stopped) return;
      if (entry.name.startsWith('.')) continue;
      const childAbsolute = posix.join(absolute, entry.name);
      const childRelative = `${relative}/${entry.name}`;
      if (entry.kind === 'symlink') {
        const target = await files.inspect(childAbsolute);
        if (target.kind !== 'missing' && !isInside(target.realPath, state.realPath)) {
          issue(childRelative, 'symlink-escape', 'symlink points outside docs/state and was not read');
        } else {
          issue(
            childRelative,
            'symlink-not-followed',
            'symlinks are not followed; replace it with the file or directory itself',
            null,
            'warning',
          );
        }
      } else if (entry.kind === 'directory') {
        if (depth + 1 > limits.maxDepth) {
          issue(childRelative, 'too-deep', `directory nesting exceeds ${limits.maxDepth} levels and was not read`);
        } else {
          await walk(childAbsolute, childRelative, depth + 1);
        }
      } else if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
        fileCount += 1;
        if (fileCount > limits.maxFiles) {
          issue(STATE_DIRECTORY, 'too-many-files', `more than ${limits.maxFiles} Markdown files; the rest were not read`);
          stopped = true;
          return;
        }
        const read = await files.readText(childAbsolute, limits.maxBytes, state.realPath);
        if (read.kind === 'text') texts.push({ file: childRelative, text: read.text });
        else if (read.kind === 'too-large') {
          issue(childRelative, 'file-too-large', `${read.size} bytes exceeds the ${limits.maxBytes}-byte limit`);
        } else {
          issue(childRelative, 'unreadable-file', `could not be read: ${read.reason}`);
        }
      }
    }
  };
  await walk(state.realPath, STATE_DIRECTORY, 0);

  const version = createHash('sha256');
  for (const { file, text } of texts) version.update(file).update('\0').update(text).update('\0');

  // Parse each file on its own.
  const candidates: Candidate[] = [];
  const rejected = new Map<string, CatalogIssue[]>();
  const reject = (file: string, code: IssueCode, message: string, documentId: string | null) => {
    const entry = issue(file, code, message, documentId);
    rejected.set(file, [...(rejected.get(file) ?? []), entry]);
  };
  for (const { file, text } of texts) {
    const outcome = parseDocumentFile(text);
    if (outcome.kind === 'rejected') {
      for (const problem of outcome.problems) {
        if (problem.code === 'unknown-field') issue(file, problem.code, problem.message, outcome.declaredId, 'warning');
        else reject(file, problem.code, problem.message, outcome.declaredId);
      }
      continue;
    }
    const id = outcome.document.id;
    candidates.push({
      file,
      parsed: outcome.document,
      warnings: outcome.warnings.map((warning) => issue(file, warning.code, warning.message, id, 'warning')),
    });
  }

  // Duplicate IDs reject every file that declares them.
  const filesById = new Map<string, string[]>();
  for (const candidate of candidates) {
    filesById.set(candidate.parsed.id, [...(filesById.get(candidate.parsed.id) ?? []), candidate.file]);
  }
  let accepted = candidates.filter((candidate) => {
    const declaring = filesById.get(candidate.parsed.id) ?? [];
    if (declaring.length < 2) return true;
    const others = declaring.filter((file) => file !== candidate.file).join(', ');
    reject(candidate.file, 'duplicate-id', `id "${candidate.parsed.id}" is also declared by ${others}`, candidate.parsed.id);
    return false;
  });

  // Exactly one root: docs/state/README.md with parent: null.
  accepted = accepted.filter((candidate) => {
    const isRootFile = candidate.file === ROOT_FILE;
    if (isRootFile && candidate.parsed.parent !== null) {
      reject(candidate.file, 'misplaced-root', `${ROOT_FILE} is the system document and must have parent: null`, candidate.parsed.id);
      return false;
    }
    if (!isRootFile && candidate.parsed.parent === null) {
      reject(candidate.file, 'misplaced-root', `only ${ROOT_FILE} may have parent: null`, candidate.parsed.id);
      return false;
    }
    return true;
  });

  // Parents and diagram targets must be accepted documents. Rejecting one
  // document can strand others, so repeat until nothing changes; a parent
  // chain that never reaches the root is a cycle.
  const declaredIds = new Set(candidates.map((candidate) => candidate.parsed.id));
  for (;;) {
    const ids = new Set(accepted.map((candidate) => candidate.parsed.id));
    const next = accepted.filter((candidate) => {
      const { id, parent, diagramLinks } = candidate.parsed;
      if (parent !== null && !ids.has(parent)) {
        if (declaredIds.has(parent)) {
          reject(candidate.file, 'parent-rejected', `parent "${parent}" was rejected; fix that document first`, id);
        } else {
          reject(candidate.file, 'missing-parent', `parent "${parent}" is not declared by any document`, id);
        }
        return false;
      }
      const unknown = [...diagramLinks].filter(([, target]) => !ids.has(target));
      if (unknown.length > 0) {
        const list = unknown.map(([node, target]) => `${node} → "${target}"`).join(', ');
        reject(candidate.file, 'unknown-diagram-target', `diagramLinks name documents that are not accepted: ${list}`, id);
        return false;
      }
      return true;
    });
    if (next.length === accepted.length) {
      const parentOf = new Map(next.map((candidate) => [candidate.parsed.id, candidate.parsed.parent]));
      // On a cycle: following parents from this document comes back to it.
      // Documents merely below a cycle are rejected as parent-rejected next round.
      const onCycle = (start: string): boolean => {
        const seen = new Set<string>();
        let current = parentOf.get(start) ?? null;
        while (current !== null && !seen.has(current)) {
          if (current === start) return true;
          seen.add(current);
          current = parentOf.get(current) ?? null;
        }
        return false;
      };
      const acyclic = next.filter((candidate) => {
        if (!onCycle(candidate.parsed.id)) return true;
        reject(
          candidate.file,
          'parent-cycle',
          `parent chain of "${candidate.parsed.id}" loops without reaching the root`,
          candidate.parsed.id,
        );
        return false;
      });
      if (acyclic.length === next.length) {
        accepted = acyclic;
        break;
      }
      accepted = acyclic;
    } else {
      accepted = next;
    }
  }

  // The directory tree states the parent too; disagreement is a warning.
  const idByFile = new Map(accepted.map((candidate) => [candidate.file, candidate.parsed.id]));
  const detailsById = new Map<string, readonly DiagramDetail[]>();
  for (const candidate of accepted) {
    const { id, diagramDetails, body } = candidate.parsed;
    const resolution = await resolveDiagramDetails(diagramDetails, body, readDiagram);
    detailsById.set(id, resolution.details);
    for (const problem of resolution.problems) {
      candidate.warnings.push(issue(candidate.file, problem.code, problem.message, id, 'warning'));
    }
  }
  for (const candidate of accepted) {
    if (candidate.file === ROOT_FILE) continue;
    const directory = posix.dirname(candidate.file);
    const owner = posix.basename(candidate.file) === 'README.md' ? posix.dirname(directory) : directory;
    const expected = idByFile.get(`${owner}/README.md`);
    if (expected !== undefined && expected !== candidate.parsed.parent) {
      candidate.warnings.push(
        issue(
          candidate.file,
          'parent-location-mismatch',
          `parent is "${candidate.parsed.parent}" but the file sits under ${owner}/README.md ("${expected}")`,
          candidate.parsed.id,
          'warning',
        ),
      );
    }
    const sources = markdownDiagrams(lexMarkdown(candidate.parsed.body)).map((diagram) => diagram.source);
    for (const node of candidate.parsed.diagramLinks.keys()) {
      if (!sources.some((source) => mentionsNode(source, node))) {
        candidate.warnings.push(
          issue(
            candidate.file,
            'unused-diagram-link',
            `diagramLinks key "${node}" does not appear in any Mermaid diagram in this document`,
            candidate.parsed.id,
            'warning',
          ),
        );
      }
    }
  }

  if (!accepted.some((candidate) => candidate.file === ROOT_FILE) && !rejected.has(ROOT_FILE)) {
    issue(ROOT_FILE, 'missing-root', `${ROOT_FILE} (the system document) does not exist`);
  }

  const children = new Map<string, string[]>();
  const sortKey = (file: string) => (posix.basename(file) === 'README.md' ? posix.dirname(file) : file);
  const ordered = [...accepted].sort((a, b) => sortKey(a.file).localeCompare(sortKey(b.file)));
  for (const candidate of ordered) {
    const parent = candidate.parsed.parent;
    if (parent !== null) children.set(parent, [...(children.get(parent) ?? []), candidate.parsed.id]);
  }
  const documents = new Map<string, CatalogDocument>();
  for (const candidate of ordered) {
    const { id, title, kind, status, summary, sourceRevision, parent, body, sources, diagramLinks } = candidate.parsed;
    documents.set(id, {
      summary: { id, title, kind, status, summary, ...(sourceRevision ? { sourceRevision } : {}), parent, children: children.get(id) ?? [], file: candidate.file },
      body,
      sources,
      diagramLinks,
      diagramDetails: detailsById.get(id) ?? [],
      warnings: candidate.warnings,
    });
  }

  return {
    version: version.digest('hex').slice(0, 16),
    repoRoot: repo.realPath,
    rootId: accepted.find((candidate) => candidate.file === ROOT_FILE)?.parsed.id ?? null,
    documents,
    documentByFile: idByFile,
    rejectedFiles: rejected,
    issues,
  };
}

function emptyCatalog(repoRoot: string | null, issues: CatalogIssue[]): Catalog {
  return {
    version: 'empty',
    repoRoot,
    rootId: null,
    documents: new Map(),
    documentByFile: new Map(),
    rejectedFiles: new Map(),
    issues,
  };
}

function mentionsNode(source: string, node: string): boolean {
  const escaped = node.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`, 'm').test(source);
}
