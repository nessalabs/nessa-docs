// Work tracking: a page's `work` block is the plan, and record files under
// docs/state/work are the progress. A record is one state change, written once
// and never edited. This module reads the records and replays them, oldest
// first, through the lifecycle in skills/nessa-docs/references/lifecycle.json.
// A record the lifecycle does not allow is refused: it is reported in Health
// and does not move its task. The state shown is always worked out from the
// records here, never saved anywhere else.

import type { CatalogIssue, DiagramDetailTarget, IssueCode, PageWork, WorkEvidence, WorkRecord, WorkSummary, WorkTask } from '../shared/api.js';
import { isOpen, LIFECYCLE, LIFECYCLE_EVENTS, LIFECYCLE_STATES, type LifecycleEvent, type LifecycleState, type NeedKind } from '../shared/lifecycle.js';
import { lexMarkdown, markdownDiagrams } from '../shared/markdown.js';
import type { ModelCheckRecord } from '../shared/model-check.js';
import { findElement } from './diagram-details.js';
import type { DiagramReader, DiagramReading } from './diagram-reader.js';
import { type AuthoredTask, isDocumentId, readFrontmatter } from './document.js';
import { WORKER_NAME, type WorkConfig } from './project-config.js';
import { textCache } from '../shared/memo.js';

// Every request reloads the catalog; a record's YAML depends only on its text, so it is read once.
const frontmatters = textCache<ReturnType<typeof readFrontmatter>>(16 * 1024 * 1024);

export const WORK_DIRECTORY = 'docs/state/work';

const RECORD_NAME = /^[A-Za-z0-9_-]+\.md$/;
const RECORD_FIELDS = ['page', 'task', 'event', 'state', 'at', 'by', 'model', 'sourceRevision', 'evidence'] as const;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** A record may be dated a little ahead of the reader's clock, never more. */
const FUTURE_SLACK_MS = 10 * 60 * 1000;
export const RECORD_LIMITS = { body: 4000, evidence: 20, text: 300, model: 100 } as const;

/** A record as written, before the lifecycle judges it. */
interface ParsedRecord {
  readonly file: string;
  readonly page: string;
  readonly task: string | null;
  readonly event: LifecycleEvent;
  readonly state: LifecycleState;
  readonly at: string;
  readonly time: number;
  readonly by: string;
  readonly model?: string;
  readonly sourceRevision?: string;
  readonly evidence: readonly WorkEvidence[];
  readonly body: string;
}

/** What the replay needs to know about one page. */
export interface WorkPage {
  readonly id: string;
  readonly tasks: readonly AuthoredTask[];
  readonly sourceRevision?: string;
  readonly hasModel: boolean;
  readonly modelCheck?: ModelCheckRecord;
  readonly modelCheckStale?: boolean;
}

export type WorkIssue = Omit<CatalogIssue, 'severity'> & { readonly severity: CatalogIssue['severity'] };

/** Where a record file sits: docs/state/work/<page>/<file> or docs/state/work/<page>/<task>/<file>. */
export function recordLocation(file: string): { page: string; task: string | null } | string {
  if (!file.startsWith(`${WORK_DIRECTORY}/`)) return `a record lives under ${WORK_DIRECTORY}/`;
  const parts = file.slice(WORK_DIRECTORY.length + 1).split('/');
  const name = parts[parts.length - 1] ?? '';
  if (parts.length < 2 || parts.length > 3) return `a record sits at ${WORK_DIRECTORY}/<page>/<file>.md or ${WORK_DIRECTORY}/<page>/<task>/<file>.md`;
  if (!RECORD_NAME.test(name)) return 'a record file name uses only letters, digits, "-" and "_", such as 2026-11-10T07-40-00Z-codex.md';
  const [page, task] = parts;
  if (!isDocumentId(page)) return `the folder "${page}" is not a page id`;
  if (parts.length === 3 && !isDocumentId(task)) return `the folder "${task}" is not a task id`;
  return { page: page as string, task: parts.length === 3 ? (task as string) : null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function oneLine(value: unknown, most: number): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= most && !/[\r\n]/.test(value);
}

/** Reads one record file, or says everything wrong with it. */
export function parseRecord(file: string, text: string, now: number): ParsedRecord | string[] {
  const location = recordLocation(file);
  if (typeof location === 'string') return [location];
  const read = frontmatters.get(text) ?? frontmatters.set(text, readFrontmatter(text));
  if (read.kind === 'rejected') return read.problems.map((problem) => problem.message);
  const fields = read.fields;
  const problems: string[] = [];
  for (const key of Object.keys(fields)) if (!(RECORD_FIELDS as readonly string[]).includes(key)) problems.push(`"${key}" is not a record field (${RECORD_FIELDS.join(', ')})`);
  if (fields.page !== location.page) problems.push(`page must be "${location.page}", the folder it sits in; found ${JSON.stringify(fields.page)}`);
  if (location.task === null ? fields.task !== undefined : fields.task !== location.task) {
    problems.push(location.task === null
      ? 'a page record has no task; put a task record in the task\'s folder'
      : `task must be "${location.task}", the folder it sits in; found ${JSON.stringify(fields.task)}`);
  }
  const event = fields.event;
  if (!(LIFECYCLE_EVENTS as readonly unknown[]).includes(event)) problems.push(`event must be one of ${LIFECYCLE_EVENTS.join(', ')}; found ${JSON.stringify(event)}`);
  const state = fields.state;
  if (!(LIFECYCLE_STATES as readonly unknown[]).includes(state)) problems.push(`state must be one of ${LIFECYCLE_STATES.join(', ')}; found ${JSON.stringify(state)}`);
  const at = fields.at;
  // YAML reads an unquoted timestamp as text in the core schema; either way it must be this exact form.
  const time = typeof at === 'string' && AT.test(at) ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(time)) problems.push(`at must be a UTC time such as 2026-11-10T07:40:00Z; found ${JSON.stringify(at)}`);
  else if (time > now + FUTURE_SLACK_MS) problems.push(`at ${at} is in the future`);
  if (typeof fields.by !== 'string' || !WORKER_NAME.test(fields.by)) problems.push(`by must name who wrote it in lowercase letters, digits, ".", "_" and "-", such as codex; found ${JSON.stringify(fields.by)}`);
  if (fields.model !== undefined && !oneLine(fields.model, RECORD_LIMITS.model)) problems.push(`model must be one line of at most ${RECORD_LIMITS.model} characters, or left out`);
  if (fields.sourceRevision !== undefined && (typeof fields.sourceRevision !== 'string' || !COMMIT_ID.test(fields.sourceRevision))) {
    problems.push('sourceRevision must be a quoted full lowercase Git commit ID, or left out');
  }
  const evidence: WorkEvidence[] = [];
  if (fields.evidence !== undefined) {
    if (!Array.isArray(fields.evidence)) problems.push('evidence must be a list such as [{ pr: https://… }, { commit: "<full id>" }]');
    else if (fields.evidence.length > RECORD_LIMITS.evidence) problems.push(`at most ${RECORD_LIMITS.evidence} evidence entries`);
    else {
      fields.evidence.forEach((entry, index) => {
        const where = `evidence[${index}]`;
        const keys = isRecord(entry) ? Object.keys(entry) : [];
        if (!isRecord(entry) || keys.length !== 1) { problems.push(`${where} must name exactly one of pr, commit, check or diff`); return; }
        const kind = keys[0] as string;
        const value = entry[kind];
        if (kind === 'pr') {
          if (typeof value === 'string' && /^https?:\/\/\S+$/.test(value) && value.length <= RECORD_LIMITS.text) evidence.push({ kind, value });
          else problems.push(`${where}.pr must be the pull request's http(s) link`);
        } else if (kind === 'commit') {
          if (typeof value === 'string' && COMMIT_ID.test(value)) evidence.push({ kind, value });
          else problems.push(`${where}.commit must be a quoted full lowercase Git commit ID`);
        } else if (kind === 'check' || kind === 'diff') {
          if (oneLine(value, RECORD_LIMITS.text)) evidence.push({ kind, value: value.trim() });
          else problems.push(`${where}.${kind} must be one line of at most ${RECORD_LIMITS.text} characters`);
        } else problems.push(`${where}: "${kind}" is not evidence (pr, commit, check, diff)`);
      });
    }
  }
  const body = read.body.trim();
  if (body.length > RECORD_LIMITS.body) problems.push(`the body is ${body.length} characters; keep a record to a few sentences (at most ${RECORD_LIMITS.body})`);
  if (problems.length > 0) return problems;
  return {
    file,
    page: location.page,
    task: location.task,
    event: event as LifecycleEvent,
    state: state as LifecycleState,
    at: at as string,
    time,
    by: fields.by as string,
    ...(typeof fields.model === 'string' ? { model: fields.model.trim() } : {}),
    ...(typeof fields.sourceRevision === 'string' ? { sourceRevision: fields.sourceRevision } : {}),
    evidence,
    body,
  };
}

/** Why the record does not have what `need` asks for, or null. */
function missingNeed(need: NeedKind, record: ParsedRecord, page: WorkPage): string | null {
  const has = (kind: WorkEvidence['kind']) => record.evidence.some((entry) => entry.kind === kind);
  switch (need) {
    case 'question':
      return record.body === '' ? 'it needs the question in its body, with the options and a recommendation' : null;
    case 'reason':
      return record.body === '' ? 'it needs the reason in its body' : null;
    case 'evidence':
      return record.evidence.length === 0 ? 'it needs evidence: a pr, commit, check or diff' : null;
    case 'commit':
      return has('commit') ? null : 'it needs a commit in its evidence';
    case 'pr':
      return has('pr') ? null : 'it needs a pr in its evidence';
    case 'check':
      return has('check') ? null : 'it needs a passing check in its evidence';
    case 'modelCheck': {
      if (record.task !== null || !page.hasModel) return 'only a page with a model can be verified';
      const check = page.modelCheck;
      if (!check) return 'the page has no saved rule check; run check_model first';
      if (page.modelCheckStale) return 'the page\'s saved rule check is stale; run check_model again';
      if (check.broke.length > 0) return `the saved rule check broke ${check.broke.map((rule) => rule.rule).join(', ')}`;
      if (check.unchecked.length > 0) return `the saved rule check left ${check.unchecked.join(', ')} unchecked`;
      if (page.sourceRevision === undefined || check.sourceRevision !== page.sourceRevision) return 'the saved rule check must name the same commit as the page\'s sourceRevision';
      return null;
    }
  }
}

/** The state a page with tasks is in, from its tasks. Its own records only accept, drop or verify it. */
function followTasks(own: LifecycleState, tasks: readonly LifecycleState[], verified: boolean): LifecycleState {
  if (own === 'draft' || own === 'dropped' || tasks.length === 0) return own;
  const live = tasks.filter((state) => state !== 'dropped');
  if (live.length === 0) return 'dropped';
  if (live.every((state) => state === 'implemented' || state === 'verified')) return verified ? 'verified' : 'implemented';
  if (live.some((state) => state === 'blocked')) return 'blocked';
  if (live.every((state) => state === 'review' || state === 'implemented' || state === 'verified')) return 'review';
  if (live.every((state) => state === 'planned' || state === 'draft')) return 'planned';
  return 'working';
}

/** The events a page that follows its tasks writes on itself. */
const PAGE_OWN_EVENTS: ReadonlySet<LifecycleEvent> = new Set(['accept', 'drop', 'verify', 'note']);

export interface PageReplay {
  readonly recorded: LifecycleState;
  readonly tasks: ReadonlyMap<string, { state: LifecycleState; lastRecordAt: string | null; lastBy: string | null }>;
  readonly records: readonly WorkRecord[];
  readonly lastRecordAt: string | null;
}

/**
 * Replays one page's records, oldest first (by `at`, then file), through the
 * lifecycle. Pages and tasks use the same machine. A page with tasks follows
 * them: its own records may only accept, drop, verify or note it, so it can
 * never be ahead of its tasks.
 */
export function replayPage(page: WorkPage, records: readonly ParsedRecord[], config: WorkConfig): PageReplay {
  const ordered = [...records].sort((a, b) => a.time - b.time || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const hasTasks = page.tasks.length > 0;
  let own: LifecycleState = LIFECYCLE.start;
  let verified = false;
  const tasks = new Map(page.tasks.map((task) => [task.id, { state: LIFECYCLE.start as LifecycleState, lastRecordAt: null as string | null, lastBy: null as string | null }]));
  const pageState = () => (hasTasks ? followTasks(own, [...tasks.values()].map((task) => task.state), verified) : own);
  const people = new Set(config.people);
  const judged: WorkRecord[] = [];
  let lastRecordAt: string | null = null;
  for (const record of ordered) {
    const rule = LIFECYCLE.events[record.event];
    const task = record.task === null ? null : tasks.get(record.task);
    const current = task ? task.state : pageState();
    let refused: string | null = null;
    if (record.task !== null && !task) refused = `the page plans no task "${record.task}"`;
    else if (task && pageState() === 'dropped' && record.event !== 'note') refused = 'the page was dropped';
    // A task moves only once its page's plan is accepted; until then it can only be dropped from the draft.
    else if (task && own === 'draft' && record.event !== 'note' && record.event !== 'drop') refused = 'the page\'s plan is not accepted yet; a person accepts the page first';
    else if (!task && hasTasks && !PAGE_OWN_EVENTS.has(record.event)) refused = `this page follows its tasks; write "${record.event}" on a task, not the page`;
    else if (!rule.from.includes(current)) refused = `"${record.event}" is not allowed from ${current}; it is allowed from ${rule.from.join(', ')}`;
    else if (record.state !== (rule.to ?? current)) refused = `"${record.event}" from ${current} leads to ${rule.to ?? current}, but the record says ${record.state}`;
    else if (rule.by === 'person' && !people.has(record.by)) {
      refused = people.size === 0
        ? `"${record.event}" is a person's move; list who may make it under work.people in nessa-docs.yaml`
        : `"${record.event}" is a person's move, and "${record.by}" is not listed in work.people`;
    } else if (rule.by === 'person' && record.model !== undefined) refused = `"${record.event}" is a person's move, but the record names a model`;
    else {
      for (const need of new Set([...rule.needs, ...(config.require[record.event] ?? [])])) {
        const missing = missingNeed(need, record, page);
        if (missing) { refused = `"${record.event}" refused: ${missing}`; break; }
      }
    }
    if (refused === null) {
      if (task) {
        if (rule.to !== null && rule.to !== task.state) verified = false;
        task.state = rule.to ?? task.state;
        task.lastRecordAt = record.at;
        task.lastBy = record.by;
      } else if (!hasTasks) own = rule.to ?? own;
      else if (record.event === 'accept') {
        own = 'planned';
        for (const entry of tasks.values()) if (entry.state === 'draft') entry.state = 'planned';
      } else if (record.event === 'drop') own = 'dropped';
      else if (record.event === 'verify') verified = true;
      lastRecordAt = record.at;
    }
    const { time: _time, page: _page, ...shown } = record;
    judged.push({ ...shown, refused });
  }
  return { recorded: pageState(), tasks, records: judged, lastRecordAt };
}

/** Binds each task's anchor to its chart element, the same way `diagramDetails` binds. */
export async function bindAnchors(
  tasks: readonly AuthoredTask[],
  body: string,
  read: DiagramReader,
): Promise<{ anchors: ReadonlyMap<string, { diagram: number; target: DiagramDetailTarget }>; problems: { code: IssueCode; message: string }[] }> {
  const anchors = new Map<string, { diagram: number; target: DiagramDetailTarget }>();
  const problems: { code: IssueCode; message: string }[] = [];
  if (tasks.length === 0) return { anchors, problems };
  const diagrams = markdownDiagrams(lexMarkdown(body));
  const readings = new Map<number, Promise<DiagramReading>>();
  const ids = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    for (const other of task.dependsOn) {
      if (!ids.has(other) || other === task.id) problems.push({ code: 'unknown-work-dependency', message: `task "${task.id}" depends on "${other}", which is not another task on this page` });
    }
    const { diagram: index, selector } = task.anchor;
    const diagram = diagrams[index];
    const where = `task "${task.id}" anchor (diagram ${index}, ${selector.kind === 'node' ? `node ${selector.node}` : `edge ${selector.from} → ${selector.to} ${JSON.stringify(selector.label)}`})`;
    if (diagram === undefined) {
      problems.push({ code: 'unbound-work-anchor', message: `${where}: the page has ${diagrams.length} Mermaid diagram${diagrams.length === 1 ? '' : 's'} (counted from 0)` });
      continue;
    }
    if (!readings.has(index)) readings.set(index, read(diagram.source));
    const reading = await (readings.get(index) as Promise<DiagramReading>);
    if (reading.kind === 'unsupported') {
      problems.push({ code: 'unbound-work-anchor', message: `${where}: ${reading.reason}` });
      continue;
    }
    const found = findElement(reading, selector);
    if (found.kind === 'missing') problems.push({ code: 'unbound-work-anchor', message: `${where}: ${found.reason}` });
    else anchors.set(task.id, { diagram: index, target: found.target });
  }
  // A dependency loop can never be finished in order.
  const after = new Map(tasks.map((task) => [task.id, task.dependsOn]));
  for (const task of tasks) {
    const seen = new Set<string>();
    const stack = [...task.dependsOn];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (next === task.id) {
        problems.push({ code: 'unknown-work-dependency', message: `task "${task.id}" depends on itself through dependsOn` });
        break;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(after.get(next) ?? []));
    }
  }
  return { anchors, problems };
}

/** Everything the reader shows about one page's work. */
export function pageWork(
  page: WorkPage,
  replay: PageReplay,
  anchors: ReadonlyMap<string, { diagram: number; target: DiagramDetailTarget }>,
  stale: boolean,
  config: WorkConfig,
): PageWork {
  const tasks: WorkTask[] = page.tasks.map((task) => {
    const state = replay.tasks.get(task.id) ?? { state: LIFECYCLE.start, lastRecordAt: null, lastBy: null };
    return { id: task.id, title: task.title, anchor: anchors.get(task.id) ?? null, dependsOn: task.dependsOn, ...state };
  });
  const shownStale = stale && (replay.recorded === 'implemented' || replay.recorded === 'verified');
  const summary: WorkSummary = {
    state: shownStale ? 'stale' : replay.recorded,
    lastRecordAt: replay.lastRecordAt,
    tasks: tasks.length,
    open: tasks.filter((task) => isOpen(task.state)).length,
    blocked: tasks.filter((task) => task.state === 'blocked').length,
    refused: replay.records.filter((record) => record.refused !== null).length,
  };
  return { summary, recorded: replay.recorded, tasks, records: replay.records, quietAfterMs: config.quietAfterMs };
}

/** Groups parsed records by page and reports the ones that cannot be read or name no page. */
export function readRecords(
  files: readonly { file: string; text: string }[],
  pages: ReadonlySet<string>,
  now: number,
  issue: (file: string, code: IssueCode, message: string, documentId: string | null) => void,
): Map<string, ParsedRecord[]> {
  const byPage = new Map<string, ParsedRecord[]>();
  for (const { file, text } of files) {
    const outcome = parseRecord(file, text, now);
    if (Array.isArray(outcome)) {
      const location = recordLocation(file);
      for (const message of outcome) issue(file, 'invalid-record', message, typeof location === 'string' ? null : location.page);
      continue;
    }
    if (!pages.has(outcome.page)) {
      issue(file, 'unknown-work-page', `no accepted page has the id "${outcome.page}"`, outcome.page);
      continue;
    }
    byPage.set(outcome.page, [...(byPage.get(outcome.page) ?? []), outcome]);
  }
  return byPage;
}
