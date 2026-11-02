// Parses one Markdown file's YAML frontmatter into a validated document
// record. YAML is read as data only (core schema, no custom tags, no aliases).

import { parseDocument } from 'yaml';
import {
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  type DocumentKind,
  type DocumentStatus,
  type IssueCode,
} from '../shared/api.js';
import { BROKEN_RULE_LIMITS, type BrokenRule, type CheckStop, type ModelCheckRecord, type ModelLink } from '../shared/model-check.js';

export const DOCUMENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 120;
/** Mermaid node identifiers as they appear in flowchart/state/sequence sources. */
const DIAGRAM_NODE_ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$/;

/** Bounds on `diagramDetails`, so a malformed list cannot grow a response or a scan without limit. */
export const DETAIL_LIMITS = { entries: 500, diagram: 999, text: 300 } as const;

const REQUIRED_FIELDS = [
  'id',
  'title',
  'kind',
  'status',
  'summary',
  'parent',
  'sources',
  'diagramLinks',
] as const;
/** Optional details default empty; an absent source revision is unknown. */
const OPTIONAL_FIELDS = ['diagramDetails', 'sourceRevision', 'model', 'modelCheck'] as const;
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MODEL_SPEC = /^tla(?:\/[A-Za-z0-9_-]+)*\/[A-Za-z0-9_-]+\.tla$/;
const MODEL_CONFIG = /^tla(?:\/[A-Za-z0-9_-]+)*\/[A-Za-z0-9_-]+\.cfg$/;
const RULE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CHECKER_NAME = /^tlc-\d+\.\d+\.\d+$/;
const CHECK_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DIGEST = /^[0-9a-f]{64}$/;

/** A chart element as an author names it: a state or flowchart node, or a labelled transition or edge between two of them. */
export type DetailSelector =
  | { readonly kind: 'node'; readonly node: string }
  | { readonly kind: 'edge'; readonly from: string; readonly to: string; readonly label: string };

/** One `diagramDetails` entry, well-formed but not yet checked against the body and its charts. */
export interface AuthoredDiagramDetail {
  readonly diagram: number;
  readonly selector: DetailSelector;
  /** The exact text of a heading in the same document. */
  readonly section: string;
}

export interface ParsedDocument {
  readonly id: string;
  readonly title: string;
  readonly kind: DocumentKind;
  readonly status: DocumentStatus;
  readonly summary: string;
  /** Exact source commit reviewed for this page; absent is unknown, never inherited. */
  readonly sourceRevision?: string;
  readonly parent: string | null;
  readonly sources: readonly string[];
  readonly diagramLinks: ReadonlyMap<string, string>;
  readonly diagramDetails: readonly AuthoredDiagramDetail[];
  readonly model?: ModelLink;
  readonly modelCheck?: ModelCheckRecord;
  readonly body: string;
}

export interface FileProblem {
  readonly code: IssueCode;
  readonly message: string;
}

export type ParseOutcome =
  | { readonly kind: 'parsed'; readonly document: ParsedDocument; readonly warnings: readonly FileProblem[] }
  | {
      readonly kind: 'rejected';
      /** The ID the file declared, if it declared a well-formed one. */
      readonly declaredId: string | null;
      readonly problems: readonly FileProblem[];
    };

const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function isDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && DOCUMENT_ID.test(value);
}

export function parseDocumentFile(text: string): ParseOutcome {
  const match = FRONTMATTER.exec(text);
  if (!match) {
    return {
      kind: 'rejected',
      declaredId: null,
      problems: [
        {
          code: 'missing-frontmatter',
          message: 'the file must begin with a YAML frontmatter block delimited by "---" lines',
        },
      ],
    };
  }
  const yaml = parseDocument(match[1] ?? '', {
    schema: 'core',
    customTags: [],
    uniqueKeys: true,
    prettyErrors: true,
  });
  // Warnings (an unresolved `!!tag`, for one) are refused too: frontmatter is plain data.
  const yamlProblems = [...yaml.errors, ...yaml.warnings];
  if (yamlProblems.length > 0) {
    return {
      kind: 'rejected',
      declaredId: null,
      problems: yamlProblems.map((error) => ({
        code: 'malformed-yaml',
        message: `frontmatter is not valid YAML: ${error.message.split('\n')[0]}`,
      })),
    };
  }
  let data: unknown;
  try {
    // Aliases are refused outright: frontmatter is small and never needs them.
    data = yaml.toJS({ maxAliasCount: 0 });
  } catch (error) {
    return {
      kind: 'rejected',
      declaredId: null,
      problems: [{ code: 'malformed-yaml', message: `frontmatter could not be read: ${(error as Error).message}` }],
    };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      kind: 'rejected',
      declaredId: null,
      problems: [{ code: 'malformed-yaml', message: 'frontmatter must be a YAML mapping of fields' }],
    };
  }
  return validateFields(data as Record<string, unknown>, text.slice(match[0].length));
}

function validateFields(fields: Record<string, unknown>, body: string): ParseOutcome {
  const problems: FileProblem[] = [];
  const warnings: FileProblem[] = [];
  const invalid = (field: string, expected: string, value: unknown) =>
    problems.push({
      code: 'invalid-field',
      message: `"${field}" must be ${expected}; found ${describe(value)}`,
    });

  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(fields, field)) {
      problems.push({ code: 'missing-field', message: `required field "${field}" is missing` });
    }
  }
  const known: readonly string[] = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
  for (const field of Object.keys(fields)) {
    if (!known.includes(field)) {
      warnings.push({ code: 'unknown-field', message: `field "${field}" is not part of the contract and is ignored` });
    }
  }

  const id = fields.id;
  if (Object.hasOwn(fields, 'id') && !isDocumentId(id)) {
    invalid('id', 'lowercase kebab-case (a-z, 0-9, single hyphens)', id);
  }
  const title = fields.title;
  if (Object.hasOwn(fields, 'title') && !nonEmptyString(title)) invalid('title', 'a non-empty string', title);
  const summary = fields.summary;
  if (Object.hasOwn(fields, 'summary') && !nonEmptyString(summary)) {
    invalid('summary', 'a non-empty string', summary);
  }
  const sourceRevision = Object.hasOwn(fields, 'sourceRevision') ? fields.sourceRevision : undefined;
  if (Object.hasOwn(fields, 'sourceRevision') && (typeof sourceRevision !== 'string' || !COMMIT_ID.test(sourceRevision))) {
    invalid('sourceRevision', 'a quoted full lowercase Git commit ID (40 or 64 hexadecimal characters)', sourceRevision);
  }
  const kind = fields.kind;
  if (Object.hasOwn(fields, 'kind') && !isMember(DOCUMENT_KINDS, kind)) {
    invalid('kind', `one of ${DOCUMENT_KINDS.join(', ')}`, kind);
  }
  const status = fields.status;
  if (Object.hasOwn(fields, 'status') && !isMember(DOCUMENT_STATUSES, status)) {
    invalid('status', `one of ${DOCUMENT_STATUSES.join(', ')}`, status);
  }
  const parent = fields.parent;
  if (Object.hasOwn(fields, 'parent') && parent !== null && !isDocumentId(parent)) {
    invalid('parent', 'null or a document ID', parent);
  }

  const sources: string[] = [];
  const rawSources = fields.sources;
  if (Object.hasOwn(fields, 'sources')) {
    if (!Array.isArray(rawSources)) {
      invalid('sources', 'a list of repository-relative paths', rawSources);
    } else {
      rawSources.forEach((entry, index) => {
        const problem = sourcePathProblem(entry);
        if (problem) invalid(`sources[${index}]`, problem, entry);
        else sources.push(entry as string);
      });
    }
  }

  const diagramLinks = new Map<string, string>();
  const rawLinks = fields.diagramLinks;
  if (Object.hasOwn(fields, 'diagramLinks')) {
    if (rawLinks === null || typeof rawLinks !== 'object' || Array.isArray(rawLinks)) {
      invalid('diagramLinks', 'a mapping of Mermaid node IDs to document IDs (use {} for none)', rawLinks);
    } else {
      for (const [node, target] of Object.entries(rawLinks)) {
        if (!DIAGRAM_NODE_ID.test(node)) {
          invalid(`diagramLinks key "${node}"`, 'a Mermaid node ID (letters, digits, _ . -)', node);
        } else if (!isDocumentId(target)) {
          invalid(`diagramLinks.${node}`, 'a document ID', target);
        } else {
          diagramLinks.set(node, target);
        }
      }
    }
  }

  const diagramDetails: AuthoredDiagramDetail[] = [];
  if (Object.hasOwn(fields, 'diagramDetails')) {
    const raw = fields.diagramDetails;
    if (!Array.isArray(raw)) {
      invalid('diagramDetails', 'a list of { diagram, node | edge, section } entries (omit it or use [] for none)', raw);
    } else if (raw.length > DETAIL_LIMITS.entries) {
      invalid('diagramDetails', `at most ${DETAIL_LIMITS.entries} entries`, `${raw.length} entries`);
    } else {
      raw.forEach((entry, index) => {
        const outcome = diagramDetail(entry);
        if (typeof outcome === 'string') invalid(`diagramDetails[${index}]`, outcome, entry);
        else diagramDetails.push(outcome);
      });
    }
  }

  const model = Object.hasOwn(fields, 'model') ? readModel(fields.model, invalid) : undefined;
  const modelCheck = Object.hasOwn(fields, 'modelCheck') ? readModelCheck(fields.modelCheck, invalid) : undefined;
  if (modelCheck && !model) invalid('modelCheck', 'present only on a page that also has "model"', modelCheck);

  const declaredId = isDocumentId(id) ? id : null;
  if (problems.length > 0) return { kind: 'rejected', declaredId, problems: [...problems, ...warnings] };
  return {
    kind: 'parsed',
    document: {
      id: id as string,
      title: (title as string).trim(),
      kind: kind as DocumentKind,
      status: status as DocumentStatus,
      summary: (summary as string).trim(),
      ...(typeof sourceRevision === 'string' ? { sourceRevision } : {}),
      parent: parent as string | null,
      sources,
      diagramLinks,
      diagramDetails,
      ...(model ? { model } : {}),
      ...(modelCheck ? { modelCheck } : {}),
      body,
    },
    warnings,
  };
}

function readModel(
  value: unknown,
  invalid: (field: string, expected: string, found: unknown) => void,
): ModelLink | undefined {
  if (!isPlainMapping(value)) {
    invalid('model', 'a mapping { spec, config, steps? }', value);
    return undefined;
  }
  const extra = Object.keys(value).filter((key) => !['spec', 'config', 'steps'].includes(key));
  if (extra.length > 0) invalid('model', `only spec, config, and steps (found ${extra.join(', ')})`, value);
  const { spec, config } = value;
  if (typeof spec !== 'string' || !MODEL_SPEC.test(spec)) invalid('model.spec', 'a docs/state-relative path under tla/ ending in .tla', spec);
  if (typeof config !== 'string' || !MODEL_CONFIG.test(config)) invalid('model.config', 'a docs/state-relative path under tla/ ending in .cfg', config);
  const steps: Record<string, string> = {};
  let stepsOk = true;
  if (Object.hasOwn(value, 'steps')) {
    if (!isPlainMapping(value.steps)) {
      invalid('model.steps', 'a mapping of TLC action names to one sentence each', value.steps);
      stepsOk = false;
    } else {
      const entries = Object.entries(value.steps);
      if (entries.length > 40) {
        invalid('model.steps', 'at most 40 actions', `${entries.length} actions`);
        stepsOk = false;
      }
      for (const [key, sentence] of entries) {
        if (!RULE_NAME.test(key) || key.length > 80) invalid(`model.steps.${key}`, 'a TLC action name', key);
        else if (typeof sentence !== 'string' || sentence.trim() === '' || sentence.length > BROKEN_RULE_LIMITS.sentence || /[\r\n]/.test(sentence)) {
          invalid(`model.steps.${key}`, `one plain sentence (1–${BROKEN_RULE_LIMITS.sentence} characters, one line)`, sentence);
        } else steps[key] = sentence;
      }
    }
  }
  if (typeof spec !== 'string' || !MODEL_SPEC.test(spec) || typeof config !== 'string' || !MODEL_CONFIG.test(config) || !stepsOk) return undefined;
  return { spec, config, steps };
}

function readModelCheck(
  value: unknown,
  invalid: (field: string, expected: string, found: unknown) => void,
): ModelCheckRecord | undefined {
  if (!isPlainMapping(value)) {
    invalid('modelCheck', 'a mapping of the last checker result', value);
    return undefined;
  }
  const allowed = ['sourceRevision', 'checker', 'date', 'config', 'modelDigest', 'states', 'held', 'broke', 'unchecked', 'stop'];
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) invalid('modelCheck', `only ${allowed.join(', ')} (found ${extra.join(', ')})`, value);
  const sourceRevision = Object.hasOwn(value, 'sourceRevision') ? value.sourceRevision : undefined;
  if (sourceRevision !== undefined && (typeof sourceRevision !== 'string' || !COMMIT_ID.test(sourceRevision))) {
    invalid('modelCheck.sourceRevision', 'a quoted full lowercase Git commit ID, or omit it', sourceRevision);
  }
  if (typeof value.checker !== 'string' || !CHECKER_NAME.test(value.checker)) invalid('modelCheck.checker', 'tlc-<major.minor.patch>', value.checker);
  if (typeof value.date !== 'string' || !CHECK_DATE.test(value.date)) invalid('modelCheck.date', 'a UTC timestamp such as 2026-11-02T08:12:00.000Z', value.date);
  if (typeof value.config !== 'string' || !MODEL_CONFIG.test(value.config)) invalid('modelCheck.config', 'the config path that was checked', value.config);
  if (typeof value.modelDigest !== 'string' || !DIGEST.test(value.modelDigest)) invalid('modelCheck.modelDigest', 'a lowercase SHA-256 hex digest', value.modelDigest);
  if (!Number.isInteger(value.states) || (value.states as number) < 0 || (value.states as number) > 1_000_000) {
    invalid('modelCheck.states', 'an integer from 0 to 1000000', value.states);
  }
  const held = ruleList(value.held, 'modelCheck.held', invalid);
  const unchecked = ruleList(value.unchecked, 'modelCheck.unchecked', invalid);
  const broke = brokenRules(value.broke, invalid);
  const stop = Object.hasOwn(value, 'stop') ? value.stop : undefined;
  if (stop !== undefined && stop !== 'states' && stop !== 'time') invalid('modelCheck.stop', '"states" or "time", or omit it', stop);
  if (
    typeof value.checker !== 'string' || !CHECKER_NAME.test(value.checker) ||
    typeof value.date !== 'string' || !CHECK_DATE.test(value.date) ||
    typeof value.config !== 'string' || !MODEL_CONFIG.test(value.config) ||
    typeof value.modelDigest !== 'string' || !DIGEST.test(value.modelDigest) ||
    !Number.isInteger(value.states) || held === null || unchecked === null || broke === null ||
    (stop !== undefined && stop !== 'states' && stop !== 'time') ||
    (sourceRevision !== undefined && (typeof sourceRevision !== 'string' || !COMMIT_ID.test(sourceRevision)))
  ) return undefined;
  return {
    ...(typeof sourceRevision === 'string' ? { sourceRevision } : {}),
    checker: value.checker,
    date: value.date,
    config: value.config,
    modelDigest: value.modelDigest,
    states: value.states as number,
    held,
    broke,
    unchecked,
    ...(stop === 'states' || stop === 'time' ? { stop: stop satisfies CheckStop } : {}),
  };
}

function ruleList(
  value: unknown,
  field: string,
  invalid: (field: string, expected: string, found: unknown) => void,
): string[] | null {
  if (!Array.isArray(value)) {
    invalid(field, 'a list of rule names', value);
    return null;
  }
  if (value.length > 50) {
    invalid(field, 'at most 50 rule names', `${value.length} names`);
    return null;
  }
  const names: string[] = [];
  for (const [index, name] of value.entries()) {
    if (typeof name !== 'string' || !RULE_NAME.test(name)) invalid(`${field}[${index}]`, 'a TLC rule name', name);
    else names.push(name);
  }
  return names.length === value.length ? names : null;
}

function brokenRules(
  value: unknown,
  invalid: (field: string, expected: string, found: unknown) => void,
): BrokenRule[] | null {
  if (!Array.isArray(value)) {
    invalid('modelCheck.broke', 'a list of { rule, path, states }', value);
    return null;
  }
  if (value.length > 50) {
    invalid('modelCheck.broke', 'at most 50 broken rules', `${value.length} rules`);
    return null;
  }
  const rules: BrokenRule[] = [];
  for (const [index, entry] of value.entries()) {
    const field = `modelCheck.broke[${index}]`;
    if (!isPlainMapping(entry)) {
      invalid(field, 'a mapping { rule, path, states }', entry);
      continue;
    }
    const path = entry.path;
    const states = entry.states;
    const ruleOk = typeof entry.rule === 'string' && RULE_NAME.test(entry.rule);
    const pathOk = Array.isArray(path) && path.length > 0 && path.length <= BROKEN_RULE_LIMITS.path && path.every((step) => typeof step === 'string' && step.trim() !== '' && step.length <= BROKEN_RULE_LIMITS.sentence && !/[\r\n]/.test(step));
    const statesOk = Array.isArray(states) && states.length <= 20 && states.every((state) => typeof state === 'string' && DIAGRAM_NODE_ID.test(state));
    if (!ruleOk) invalid(`${field}.rule`, 'a TLC rule name', entry.rule);
    if (!pathOk) invalid(`${field}.path`, `1 to ${BROKEN_RULE_LIMITS.path} plain sentences of at most ${BROKEN_RULE_LIMITS.sentence} characters each`, path);
    if (!statesOk) invalid(`${field}.states`, 'a list of diagram state ids', states);
    if (ruleOk && pathOk && statesOk) rules.push({ rule: entry.rule as string, path: path as string[], states: states as string[] });
  }
  return rules.length === value.length ? rules : null;
}

const DETAIL_SHAPE =
  '{ diagram: <index>, node: <state or node ID> | edge: { from, to, label }, section: <heading text> }';

/** One entry's shape, or what is wrong with it. Exactly the listed keys; values bounded. */
function diagramDetail(entry: unknown): AuthoredDiagramDetail | string {
  if (!isPlainMapping(entry)) return `a mapping ${DETAIL_SHAPE}`;
  const extra = Object.keys(entry).filter((key) => !['diagram', 'node', 'edge', 'section'].includes(key));
  if (extra.length > 0) return `${DETAIL_SHAPE} without other keys (found ${extra.map((key) => JSON.stringify(key)).join(', ')})`;
  const { diagram, section } = entry;
  if (!Number.isInteger(diagram) || (diagram as number) < 0 || (diagram as number) > DETAIL_LIMITS.diagram) {
    return `a "diagram" index from 0 to ${DETAIL_LIMITS.diagram}`;
  }
  if (!detailText(section)) return `a "section" heading text (one line, 1–${DETAIL_LIMITS.text} characters)`;
  const hasNode = Object.hasOwn(entry, 'node');
  const hasEdge = Object.hasOwn(entry, 'edge');
  if (hasNode === hasEdge) return 'exactly one of "node" or "edge"';
  if (hasNode) {
    return typeof entry.node === 'string' && DIAGRAM_NODE_ID.test(entry.node)
      ? { diagram: diagram as number, selector: { kind: 'node', node: entry.node }, section: section as string }
      : 'a "node" that is a Mermaid state or node ID (letters, digits, _ . -)';
  }
  const edge = entry.edge;
  if (!isPlainMapping(edge)) return 'an "edge" mapping { from, to, label }';
  const edgeExtra = Object.keys(edge).filter((key) => !['from', 'to', 'label'].includes(key));
  if (edgeExtra.length > 0) return `an "edge" with only from, to and label (found ${edgeExtra.map((key) => JSON.stringify(key)).join(', ')})`;
  const { from, to, label } = edge;
  if (typeof from !== 'string' || !DIAGRAM_NODE_ID.test(from) || typeof to !== 'string' || !DIAGRAM_NODE_ID.test(to)) {
    return 'an "edge" whose "from" and "to" are Mermaid state or node IDs (letters, digits, _ . -)';
  }
  if (!detailText(label)) return `an "edge" "label": the transition's or edge's label (one line, 1–${DETAIL_LIMITS.text} characters)`;
  return { diagram: diagram as number, selector: { kind: 'edge', from, to, label }, section: section as string };
}

function isPlainMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function detailText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= DETAIL_LIMITS.text && !/[\r\n]/.test(value);
}

/** A `sources` entry is a repository-relative path, optionally with a #fragment. */
function sourcePathProblem(entry: unknown): string | null {
  if (!nonEmptyString(entry)) return 'a non-empty repository-relative path';
  if (/^[a-z][a-z0-9+.-]*:/i.test(entry)) return 'a repository-relative path, not a URL';
  if (entry.startsWith('/') || entry.startsWith('~')) return 'a repository-relative path, not an absolute one';
  if (/[\\\0]/.test(entry)) return 'a POSIX path without backslashes or NUL';
  return null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMember<T extends string>(set: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (set as readonly string[]).includes(value);
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
