// Reads docs/state/nessa-docs.yaml, the one place a project chooses its card
// styles, reference patterns, note folders and authoring rules. The file is
// optional: without it a project reads exactly as before. A config that cannot
// be used is reported as one `invalid-config` issue per problem and the parts
// that are valid still apply, so one bad pattern does not turn off the rest.

import { parseDocument } from 'yaml';
import type { CardFamily, CardStyle } from '../shared/api.js';
import { LIFECYCLE_EVENTS, type LifecycleEvent, NEED_KINDS, type NeedKind } from '../shared/lifecycle.js';
import { compileRule, type CompiledRule, MAX_REFERENCE_RULES, type ReferenceRule } from '../shared/references.js';

export const CONFIG_NAME = 'nessa-docs.yaml';
export const CONFIG_FILE = `docs/state/${CONFIG_NAME}`;
export const MAX_CONFIG_BYTES = 64 * 1024;

export type CardLook = CardStyle['look'];
const LOOK_FAMILY: Readonly<Record<CardLook, CardFamily>> = { lifecycle: 'state', handoff: 'sequence', map: 'flowchart', plain: 'any' };

/** Always available; a project may relabel them or add more names that use one of these looks. */
export const BUILT_IN_CARDS: Readonly<Record<string, CardStyle>> = {
  lifecycle: { name: 'lifecycle', look: 'lifecycle', family: 'state', label: 'Lifecycle' },
  handoff: { name: 'handoff', look: 'handoff', family: 'sequence', label: 'Handoff' },
  map: { name: 'map', look: 'map', family: 'flowchart', label: 'Map' },
  plain: { name: 'plain', look: 'plain', family: 'any', label: 'Diagram' },
};

/** Where a matched reference may point. Every value is a template (shared/references.ts fillTemplate). */
export type OpenTarget =
  | { readonly kind: 'document'; readonly id: string; readonly heading: string | null }
  | { readonly kind: 'file'; readonly file: string; readonly heading: string | null }
  | { readonly kind: 'url'; readonly url: string };

export interface ReferenceConfig {
  readonly rule: CompiledRule;
  readonly source: ReferenceRule;
  readonly label: string;
  readonly open: readonly OpenTarget[];
}

export interface ProjectConfig {
  /** Whether docs/state/nessa-docs.yaml exists. */
  readonly present: boolean;
  readonly cards: Readonly<Record<string, CardStyle>>;
  readonly references: readonly ReferenceConfig[];
  /** Repository-relative folders whose Markdown files a pill may show in its peek. */
  readonly notes: readonly string[];
  readonly requireSourceRevision: boolean;
  readonly work: WorkConfig;
}

/** How a project tracks work (the `work` section). States and events are fixed by the lifecycle; a project only adds to them. */
export interface WorkConfig {
  /** Names a record's `by` may use for a person's move (accept, answer). */
  readonly people: readonly string[];
  /** After this long with no new record, open work is shown as quiet. */
  readonly quietAfterMs: number;
  /** Extra requirements per event, on top of the lifecycle's own. */
  readonly require: Readonly<Partial<Record<LifecycleEvent, readonly NeedKind[]>>>;
}

/** The pattern a record's `by` follows: an agent or person name. */
export const WORKER_NAME = /^[a-z0-9][a-z0-9._-]{0,39}$/;
export const DEFAULT_QUIET_AFTER_MS = 2 * 60 * 60 * 1000;
export const EMPTY_WORK_CONFIG: WorkConfig = { people: [], quietAfterMs: DEFAULT_QUIET_AFTER_MS, require: {} };

export const EMPTY_CONFIG: ProjectConfig = { present: false, cards: BUILT_IN_CARDS, references: [], notes: [], requireSourceRevision: false, work: EMPTY_WORK_CONFIG };

export interface ConfigProblem {
  readonly message: string;
}

export interface ConfigOutcome {
  readonly config: ProjectConfig;
  readonly problems: readonly ConfigProblem[];
}

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const TOP_LEVEL = new Set(['version', 'cards', 'references', 'notes', 'authoring', 'work']);

/** A repository-relative path or path template: no leading slash, no `..`, no backslash. */
function relativePath(value: string): boolean {
  if (value === '' || value.startsWith('/') || /[\\\0]/.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseProjectConfig(text: string): ConfigOutcome {
  const problems: ConfigProblem[] = [];
  const problem = (message: string) => problems.push({ message });
  const yaml = parseDocument(text, { schema: 'core', customTags: [], uniqueKeys: true, prettyErrors: true });
  const yamlProblems = [...yaml.errors, ...yaml.warnings];
  if (yamlProblems.length > 0) {
    return { config: { ...EMPTY_CONFIG, present: true }, problems: yamlProblems.map((error) => ({ message: `not valid YAML: ${error.message.split('\n')[0]}` })) };
  }
  let data: unknown;
  try {
    data = yaml.toJS({ maxAliasCount: 0 });
  } catch (error) {
    return { config: { ...EMPTY_CONFIG, present: true }, problems: [{ message: `could not be read: ${(error as Error).message}` }] };
  }
  if (data === null || data === undefined) return { config: { ...EMPTY_CONFIG, present: true }, problems };
  if (!isRecord(data)) return { config: { ...EMPTY_CONFIG, present: true }, problems: [{ message: 'must be a YAML mapping' }] };

  for (const key of Object.keys(data)) if (!TOP_LEVEL.has(key)) problem(`"${key}" is not a config section; expected ${[...TOP_LEVEL].join(', ')}`);
  if (data.version !== undefined && data.version !== 1) problem(`version must be 1, got ${JSON.stringify(data.version)}`);

  // Cards: name → { look, label? }.
  const cards: Record<string, CardStyle> = { ...BUILT_IN_CARDS };
  if (data.cards !== undefined) {
    if (!isRecord(data.cards)) problem('cards must be a mapping of card name to { look, label }');
    else {
      for (const [name, raw] of Object.entries(data.cards)) {
        if (!NAME.test(name)) { problem(`card name "${name}" must be lowercase letters, digits and dashes`); continue; }
        const value = isRecord(raw) ? raw : null;
        const builtIn = BUILT_IN_CARDS[name];
        const look = value?.look ?? builtIn?.look;
        if (value === null || typeof look !== 'string' || !Object.hasOwn(LOOK_FAMILY, look)) {
          problem(`card "${name}" needs a look: ${Object.keys(LOOK_FAMILY).join(', ')}`);
          continue;
        }
        for (const key of Object.keys(value)) if (key !== 'look' && key !== 'label') problem(`card "${name}": "${key}" is not a card field (look, label)`);
        const label = typeof value.label === 'string' && value.label.trim() !== '' ? value.label.trim().slice(0, 60) : (builtIn?.label ?? name);
        cards[name] = { name, look: look as CardLook, family: LOOK_FAMILY[look as CardLook], label };
      }
    }
  }

  // References: an ordered list.
  const references: ReferenceConfig[] = [];
  if (data.references !== undefined) {
    if (!Array.isArray(data.references)) problem('references must be a list');
    else {
      if (data.references.length > MAX_REFERENCE_RULES) problem(`at most ${MAX_REFERENCE_RULES} references; the rest are ignored`);
      const seen = new Set<string>();
      data.references.slice(0, MAX_REFERENCE_RULES).forEach((raw, index) => {
        const where = `references[${index}]`;
        if (!isRecord(raw)) { problem(`${where} must be a mapping with name, match and open`); return; }
        const name = raw.name;
        if (typeof name !== 'string' || !NAME.test(name)) { problem(`${where}: name must be lowercase letters, digits and dashes`); return; }
        if (seen.has(name)) { problem(`${where}: name "${name}" is used twice`); return; }
        seen.add(name);
        for (const key of Object.keys(raw)) if (!['name', 'match', 'label', 'open'].includes(key)) problem(`reference "${name}": "${key}" is not a reference field (name, match, label, open)`);
        if (typeof raw.match !== 'string') { problem(`reference "${name}": match must be a regular expression string`); return; }
        const compiled = compileRule({ name, match: raw.match });
        if (compiled.kind === 'invalid') { problem(`reference "${name}": ${compiled.reason}`); return; }
        const label = raw.label === undefined ? '{0}' : raw.label;
        if (typeof label !== 'string' || label.trim() === '') { problem(`reference "${name}": label must be text`); return; }
        const targets = Array.isArray(raw.open) ? raw.open : raw.open === undefined ? [] : [raw.open];
        if (targets.length === 0) { problem(`reference "${name}": open needs at least one target (document, file or url)`); return; }
        const open: OpenTarget[] = [];
        targets.forEach((target, at) => {
          const parsed = openTarget(target);
          if (typeof parsed === 'string') problem(`reference "${name}": open[${at}] ${parsed}`);
          else open.push(parsed);
        });
        if (open.length === 0) return;
        references.push({ rule: compiled.rule, source: { name, match: raw.match }, label, open });
      });
    }
  }

  // Notes: folders whose Markdown a pill may preview. docs/state is always readable.
  const notes: string[] = [];
  if (data.notes !== undefined) {
    if (!Array.isArray(data.notes)) problem('notes must be a list of repository folders, such as docs/adr');
    else {
      for (const folder of data.notes) {
        if (typeof folder !== 'string' || !relativePath(folder.replace(/\/+$/, ''))) problem(`notes: ${JSON.stringify(folder)} must be a repository-relative folder without ".."`);
        else notes.push(folder.replace(/\/+$/, ''));
      }
    }
  }

  let requireSourceRevision = false;
  if (data.authoring !== undefined) {
    if (!isRecord(data.authoring)) problem('authoring must be a mapping');
    else {
      for (const [key, value] of Object.entries(data.authoring)) {
        if (key === 'requireSourceRevision') {
          if (typeof value === 'boolean') requireSourceRevision = value;
          else problem('authoring.requireSourceRevision must be true or false');
        } else problem(`authoring: "${key}" is not an authoring rule (requireSourceRevision)`);
      }
    }
  }

  const work = data.work === undefined ? EMPTY_WORK_CONFIG : readWorkConfig(data.work, problem);

  return { config: { present: true, cards, references, notes, requireSourceRevision, work }, problems };
}

const DURATION = /^(\d{1,4})(m|h|d)$/;
const DURATION_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

function readWorkConfig(raw: unknown, problem: (message: string) => void): WorkConfig {
  if (!isRecord(raw)) {
    problem('work must be a mapping with people, quietAfter and require');
    return EMPTY_WORK_CONFIG;
  }
  let people: string[] = [];
  let quietAfterMs = DEFAULT_QUIET_AFTER_MS;
  const require: Partial<Record<LifecycleEvent, NeedKind[]>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'people') {
      if (!Array.isArray(value) || !value.every((name) => typeof name === 'string' && WORKER_NAME.test(name))) {
        problem('work.people must be a list of names in lowercase letters, digits, ".", "_" and "-", such as [saurav]');
      } else people = [...new Set(value as string[])];
    } else if (key === 'quietAfter') {
      const match = typeof value === 'string' ? DURATION.exec(value) : null;
      if (!match || Number(match[1]) === 0) problem('work.quietAfter must be a duration such as 30m, 2h or 1d');
      else quietAfterMs = Number(match[1]) * DURATION_MS[match[2] as keyof typeof DURATION_MS];
    } else if (key === 'require') {
      if (!isRecord(value)) {
        problem('work.require must map an event to the extra things it needs, such as { merge: [check] }');
        continue;
      }
      for (const [event, needs] of Object.entries(value)) {
        if (!(LIFECYCLE_EVENTS as readonly string[]).includes(event)) {
          problem(`work.require: "${event}" is not a lifecycle event (${LIFECYCLE_EVENTS.join(', ')}); a project adds requirements, never events`);
        } else if (!Array.isArray(needs) || !needs.every((need) => (NEED_KINDS as readonly string[]).includes(need))) {
          problem(`work.require.${event} must list needs from ${NEED_KINDS.join(', ')}`);
        } else require[event as LifecycleEvent] = [...new Set(needs as NeedKind[])];
      }
    } else problem(`work: "${key}" is not a work setting (people, quietAfter, require)`);
  }
  return { people, quietAfterMs, require };
}

function openTarget(raw: unknown): OpenTarget | string {
  if (!isRecord(raw)) return 'must be a mapping such as { file: docs/adr/{n}.md }';
  const kinds = ['document', 'file', 'url'].filter((key) => key in raw);
  if (kinds.length !== 1) return 'must name exactly one of document, file or url';
  const allowed = new Set([kinds[0], ...(kinds[0] === 'url' ? [] : ['heading'])]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) return `has "${key}", which a ${kinds[0]} target does not take`;
  const heading = raw.heading;
  if (heading !== undefined && (typeof heading !== 'string' || heading.trim() === '')) return 'heading must be text';
  const headingValue = typeof heading === 'string' ? heading.trim() : null;
  if (typeof raw.document === 'string') return { kind: 'document', id: raw.document, heading: headingValue };
  if (typeof raw.file === 'string') {
    const file = raw.file;
    if (!relativePath(file)) return 'file must be a repository-relative path without ".."';
    if (file.slice(0, file.lastIndexOf('/') + 1).includes('*')) return 'file may use * only in its last part, such as docs/adr/{n}-*.md';
    return { kind: 'file', file, heading: headingValue };
  }
  if (typeof raw.url === 'string') {
    if (!/^https?:\/\//i.test(raw.url)) return 'url must start with http:// or https://';
    return { kind: 'url', url: raw.url };
  }
  return 'target value must be text';
}

/** The patterns as the browser receives them, in config order. */
export function referenceRules(config: ProjectConfig): readonly ReferenceRule[] {
  return config.references.map((reference) => reference.source);
}

export { cardFits, chartFamily } from '../shared/cards.js';

