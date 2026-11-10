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
import { textCache } from '../shared/memo.js';
import { NO_HISTORY, type SourceHistory } from './source-history.js';
import { bindAnchors, pageWork, readRecords, replayPage, WORK_DIRECTORY } from './work.js';
import type { PageWork } from '../shared/api.js';
import { cardFits, CONFIG_FILE, CONFIG_NAME, EMPTY_CONFIG, MAX_CONFIG_BYTES, parseProjectConfig, type ProjectConfig } from './project-config.js';

export const STATE_DIRECTORY = 'docs/state';
export const ROOT_FILE = `${STATE_DIRECTORY}/README.md`;

export interface LoaderLimits {
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly maxDepth: number;
}

/** Markdown files read at once while loading. */
const READ_CONCURRENCY = 16;

export const DEFAULT_LIMITS: LoaderLimits = { maxFiles: 2000, maxBytes: 1024 * 1024, maxDepth: 12 };

export interface CatalogDocument {
  readonly summary: DocumentSummary;
  readonly body: string;
  readonly sources: readonly string[];
  readonly diagramLinks: ReadonlyMap<string, string>;
  /** The `diagramDetails` entries that bound; the rest are among `warnings`. */
  readonly diagramDetails: readonly DiagramDetail[];
  readonly warnings: readonly CatalogIssue[];
  /** The page's tasks and records, judged by the lifecycle; null when it has neither. */
  readonly work: PageWork | null;
}

/** What a catalog load may ask besides the files: the clock (records dated in the future are refused) and the source history (implemented pages turn stale). */
export interface CatalogContext {
  readonly now?: () => number;
  readonly history?: SourceHistory;
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
  /** docs/state/nessa-docs.yaml as read, or the defaults when it is absent. */
  readonly config: ProjectConfig;
}

interface Candidate {
  readonly file: string;
  readonly parsed: ParsedDocument;
  readonly warnings: CatalogIssue[];
}

// Parsing a file and binding its diagram details depend only on its text, and
// every request reloads the catalog, so unchanged files are not parsed again.
const parsedFiles = textCache<ReturnType<typeof parseDocumentFile>>(32 * 1024 * 1024);
const boundDetails = new WeakMap<DiagramReader, ReturnType<typeof textCache<Promise<Awaited<ReturnType<typeof resolveDiagramDetails>>>>>>();

function bindDetails(entries: Parameters<typeof resolveDiagramDetails>[0], body: string, read: DiagramReader) {
  if (entries.length === 0) return resolveDiagramDetails(entries, body, read);
  let cache = boundDetails.get(read);
  if (!cache) {
    cache = textCache(16 * 1024 * 1024);
    boundDetails.set(read, cache);
  }
  const key = `${JSON.stringify(entries)}\0${body}`;
  const found = cache.get(key);
  if (found) return found;
  const pending = resolveDiagramDetails(entries, body, read);
  cache.set(key, pending);
  // A failed binding is not remembered.
  const owner = cache;
  pending.catch(() => owner.delete(key));
  return pending;
}

export async function loadCatalog(
  files: RepositoryFiles,
  repoRoot: string,
  limits: LoaderLimits = DEFAULT_LIMITS,
  readDiagram: DiagramReader = readWithMermaid,
  context: CatalogContext = {},
): Promise<Catalog> {
  const now = (context.now ?? Date.now)();
  const history = context.history ?? NO_HISTORY;
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
  const found: { file: string; absolute: string }[] = [];
  // Records under docs/state/work are not pages; they are read on their own, with their own count.
  const recordsFound: { file: string; absolute: string }[] = [];
  let fileCount = 0;
  let recordCount = 0;
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
      } else if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md') && childRelative.startsWith(`${WORK_DIRECTORY}/`)) {
        recordCount += 1;
        if (recordCount > limits.maxFiles) {
          if (recordCount === limits.maxFiles + 1) issue(WORK_DIRECTORY, 'too-many-files', `more than ${limits.maxFiles} work records; the rest were not read`);
          continue;
        }
        recordsFound.push({ file: childRelative, absolute: childAbsolute });
      } else if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
        fileCount += 1;
        if (fileCount > limits.maxFiles) {
          issue(STATE_DIRECTORY, 'too-many-files', `more than ${limits.maxFiles} Markdown files; the rest were not read`);
          stopped = true;
          return;
        }
        found.push({ file: childRelative, absolute: childAbsolute });
      }
    }
  };
  await walk(state.realPath, STATE_DIRECTORY, 0);

  // Read the files found, several at a time (the reads are independent), keeping walk order.
  const toRead = [...found, ...recordsFound];
  const reads = new Array<Awaited<ReturnType<RepositoryFiles['readText']>>>(toRead.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, toRead.length) }, async () => {
    while (next < toRead.length) {
      const at = next++;
      reads[at] = await files.readText((toRead[at] as { absolute: string }).absolute, limits.maxBytes, state.realPath);
    }
  }));
  const recordTexts: { file: string; text: string }[] = [];
  toRead.forEach(({ file }, at) => {
    const read = reads[at] as Awaited<ReturnType<RepositoryFiles['readText']>>;
    if (read.kind === 'text') (at < found.length ? texts : recordTexts).push({ file, text: read.text });
    else if (read.kind === 'too-large') {
      issue(file, 'file-too-large', `${read.size} bytes exceeds the ${limits.maxBytes}-byte limit`);
    } else {
      issue(file, 'unreadable-file', `could not be read: ${read.reason}`);
    }
  });

  const version = createHash('sha256');
  for (const { file, text } of texts) version.update(file).update('\0').update(text).update('\0');
  for (const { file, text } of recordTexts) version.update(file).update('\0').update(text).update('\0');

  // The optional project config. Its problems are errors on the config file; the valid parts still apply.
  let config: ProjectConfig = EMPTY_CONFIG;
  const configPath = posix.join(state.realPath, CONFIG_NAME);
  const configFile = await files.inspect(configPath);
  if (configFile.kind === 'file') {
    const read = await files.readText(configPath, MAX_CONFIG_BYTES, state.realPath);
    if (read.kind === 'text') {
      version.update(CONFIG_FILE).update('\0').update(read.text).update('\0');
      const outcome = parseProjectConfig(read.text);
      config = outcome.config;
      for (const problem of outcome.problems) issue(CONFIG_FILE, 'invalid-config', problem.message);
    } else {
      issue(CONFIG_FILE, 'invalid-config', read.kind === 'too-large' ? `${read.size} bytes exceeds the ${MAX_CONFIG_BYTES}-byte limit; defaults are used` : `could not be read: ${read.reason}`);
    }
  } else if (configFile.kind !== 'missing') {
    issue(CONFIG_FILE, 'invalid-config', `${CONFIG_FILE} is not a regular file and was not read`);
  }

  // Parse each file on its own.
  const candidates: Candidate[] = [];
  const rejected = new Map<string, CatalogIssue[]>();
  const reject = (file: string, code: IssueCode, message: string, documentId: string | null) => {
    const entry = issue(file, code, message, documentId);
    rejected.set(file, [...(rejected.get(file) ?? []), entry]);
  };
  for (const { file, text } of texts) {
    const outcome = parsedFiles.get(text) ?? parsedFiles.set(text, parseDocumentFile(text));
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

  // Linked models are real files. A missing file, or two pages sharing one, is an error.
  const modelFacts = new Map<string, { readonly stale: boolean }>();
  const linkedBy = new Map<string, { file: string; id: string }[]>();
  for (const candidate of accepted) {
    const model = candidate.parsed.model;
    if (!model) continue;
    for (const relative of [model.spec, model.config]) {
      linkedBy.set(relative, [...(linkedBy.get(relative) ?? []), { file: candidate.file, id: candidate.parsed.id }]);
    }
  }
  const drop = new Set<string>();
  for (const [relative, owners] of linkedBy) {
    if (owners.length < 2) continue;
    for (const owner of owners) {
      drop.add(owner.file);
      const others = owners.filter((item) => item.file !== owner.file).map((item) => item.file).join(', ');
      reject(owner.file, 'duplicate-model', `"${relative}" is also linked by ${others}`, owner.id);
    }
  }
  for (const candidate of accepted) {
    const model = candidate.parsed.model;
    if (!model || drop.has(candidate.file)) continue;
    const texts: string[] = [];
    let missing = false;
    for (const [label, relative] of [['spec', model.spec], ['config', model.config]] as const) {
      const absolute = posix.join(state.realPath, relative);
      const found = await files.inspect(absolute);
      if (found.kind !== 'file' || !isInside(found.realPath, state.realPath)) {
        reject(candidate.file, 'missing-model-file', `model.${label} "${relative}" is not a file under ${STATE_DIRECTORY}`, candidate.parsed.id);
        missing = true;
        continue;
      }
      const read = await files.readText(absolute, limits.maxBytes, state.realPath);
      if (read.kind !== 'text') {
        reject(candidate.file, 'missing-model-file', `model.${label} "${relative}" could not be read${read.kind === 'too-large' ? ` (${read.size} bytes)` : ''}`, candidate.parsed.id);
        missing = true;
        continue;
      }
      texts.push(read.text);
      version.update(relative).update('\0').update(read.text).update('\0');
    }
    if (missing || texts.length !== 2) {
      drop.add(candidate.file);
      continue;
    }
    const check = candidate.parsed.modelCheck;
    if (check) {
      const digest = createHash('sha256').update(texts[0] ?? '').update('\0').update(texts[1] ?? '').digest('hex');
      const revisionMoved = candidate.parsed.sourceRevision !== undefined && check.sourceRevision !== undefined && candidate.parsed.sourceRevision !== check.sourceRevision;
      modelFacts.set(candidate.parsed.id, { stale: digest !== check.modelDigest || check.config !== model.config || revisionMoved });
    }
  }
  accepted = accepted.filter((candidate) => !drop.has(candidate.file));
  let stranded = true;
  while (stranded) {
    stranded = false;
    const ids = new Set(accepted.map((candidate) => candidate.parsed.id));
    accepted = accepted.filter((candidate) => {
      if (candidate.parsed.parent === null || ids.has(candidate.parsed.parent)) return true;
      reject(candidate.file, 'parent-rejected', `parent "${candidate.parsed.parent}" was rejected; fix that document first`, candidate.parsed.id);
      stranded = true;
      return false;
    });
  }

  // The directory tree states the parent too; disagreement is a warning.
  const idByFile = new Map(accepted.map((candidate) => [candidate.file, candidate.parsed.id]));
  const detailsById = new Map<string, readonly DiagramDetail[]>();
  for (const candidate of accepted) {
    const { id, diagramDetails, body } = candidate.parsed;
    const resolution = await bindDetails(diagramDetails, body, readDiagram);
    detailsById.set(id, resolution.details);
    for (const problem of resolution.problems) {
      candidate.warnings.push(issue(candidate.file, problem.code, problem.message, id, 'warning'));
    }
    const diagrams = markdownDiagrams(lexMarkdown(body));
    diagrams.forEach((diagram, index) => {
      if (diagram.card === null) return;
      const card = Object.hasOwn(config.cards, diagram.card) ? config.cards[diagram.card] : undefined;
      if (card === undefined) {
        candidate.warnings.push(issue(candidate.file, 'unknown-card', `diagram ${index} names card "${diagram.card}", which ${CONFIG_FILE} does not define; it is drawn as a plain card`, candidate.parsed.id, 'warning'));
      } else if (!cardFits(card, diagram.source)) {
        candidate.warnings.push(issue(candidate.file, 'card-family-mismatch', `diagram ${index} uses card "${card.name}", which is for ${card.family} charts; it is drawn as a plain card`, candidate.parsed.id, 'warning'));
      }
    });
    if (config.requireSourceRevision && candidate.parsed.sourceRevision === undefined) {
      candidate.warnings.push(issue(candidate.file, 'missing-source-revision', `${CONFIG_FILE} requires sourceRevision on every page`, candidate.parsed.id, 'warning'));
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
  // Work: replay each page's records and bind its task anchors.
  // A record that cannot be read is listed on its page too, so the page says it has a problem.
  const candidateById = new Map(accepted.map((candidate) => [candidate.parsed.id, candidate]));
  const recordsByPage = readRecords(recordTexts, new Set(candidateById.keys()), now, (file, code, message, documentId) => {
    const entry = issue(file, code, message, documentId);
    if (documentId !== null) candidateById.get(documentId)?.warnings.push(entry);
  });
  const workById = new Map<string, PageWork>();
  for (const candidate of ordered) {
    const { id, work: tasks, body, sourceRevision, sources, model, modelCheck } = candidate.parsed;
    const records = recordsByPage.get(id) ?? [];
    if (tasks.length === 0 && records.length === 0) continue;
    const page = { id, tasks, ...(sourceRevision ? { sourceRevision } : {}), hasModel: model !== undefined, ...(modelCheck ? { modelCheck, modelCheckStale: modelFacts.get(id)?.stale ?? true } : {}) };
    const replay = replayPage(page, records, config.work);
    for (const record of replay.records) {
      if (record.refused === null) continue;
      const unknownTask = record.task !== null && !tasks.some((task) => task.id === record.task);
      candidate.warnings.push(issue(record.file, unknownTask ? 'unknown-work-task' : 'refused-record', record.refused, id));
    }
    const bound = await bindAnchors(tasks, body, readDiagram);
    for (const problem of bound.problems) candidate.warnings.push(issue(candidate.file, problem.code, problem.message, id, 'warning'));
    const finished = replay.recorded === 'implemented' || replay.recorded === 'verified';
    const stale = finished && sourceRevision !== undefined && sources.length > 0 && (await history.changedSince(repo.realPath, sourceRevision, sources)) === 'changed';
    workById.set(id, pageWork(page, replay, bound.anchors, stale, config.work));
  }

  const documents = new Map<string, CatalogDocument>();
  for (const candidate of ordered) {
    const { id, title, kind, status, summary, sourceRevision, parent, body, sources, diagramLinks, model, modelCheck } = candidate.parsed;
    const stale = modelFacts.get(id);
    documents.set(id, {
      summary: {
        id, title, kind, status, summary, ...(sourceRevision ? { sourceRevision } : {}), parent, children: children.get(id) ?? [], file: candidate.file,
        ...(model ? { model } : {}),
        ...(modelCheck ? { modelCheck, modelCheckStale: stale?.stale ?? true } : {}),
        ...(workById.has(id) ? { work: (workById.get(id) as PageWork).summary } : {}),
      },
      body,
      sources,
      diagramLinks,
      diagramDetails: detailsById.get(id) ?? [],
      warnings: candidate.warnings,
      work: workById.get(id) ?? null,
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
    config,
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
    config: EMPTY_CONFIG,
  };
}

function mentionsNode(source: string, node: string): boolean {
  const escaped = node.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`, 'm').test(source);
}
