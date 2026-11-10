// The work lifecycle, read from the one data file that ships with Nessa Docs
// (skills/nessa-docs/references/lifecycle.json). The validator, the reader and
// the skill all read that file, so they cannot disagree about which states
// exist or which moves are allowed. This module only checks the file's shape
// and gives it types; it adds no rule of its own.

import machine from '../skills/nessa-docs/references/lifecycle.json' with { type: 'json' };

/** Every state a page or task can be in. The data file is checked against this list when it loads. */
export const LIFECYCLE_STATES = ['draft', 'planned', 'working', 'blocked', 'review', 'implemented', 'verified', 'dropped'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** A state that is never written, only shown: see `shown` in the data file. */
export type ShownState = LifecycleState | 'stale';

export const LIFECYCLE_EVENTS = ['accept', 'start', 'ask', 'answer', 'submit', 'rework', 'merge', 'verify', 'reopen', 'drop', 'note'] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

/** What an event can require. A project may add any of these to an event (work.require), never a new kind. */
export const NEED_KINDS = ['question', 'reason', 'evidence', 'commit', 'pr', 'check', 'modelCheck'] as const;
export type NeedKind = (typeof NEED_KINDS)[number];

export interface EventRule {
  readonly from: readonly LifecycleState[];
  /** Where the event leads; null keeps the current state (a note). */
  readonly to: LifecycleState | null;
  readonly needs: readonly NeedKind[];
  /** `person`: only someone listed in work.people may write it. */
  readonly by: 'person' | 'anyone';
}

export interface Lifecycle {
  readonly version: number;
  readonly start: LifecycleState;
  /** What each state means, in the fixed order. */
  readonly states: Readonly<Record<LifecycleState, string>>;
  readonly shown: Readonly<Record<'stale', string>>;
  readonly events: Readonly<Record<LifecycleEvent, EventRule>>;
  readonly needs: Readonly<Record<NeedKind, string>>;
}

function isMember<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function sameKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key, at) => key === expected[at]);
}

/** Checks a lifecycle file's shape. Throws on anything the code does not know, so a mismatch fails at start-up and in tests, not quietly. */
export function readLifecycle(raw: unknown): Lifecycle {
  const fail = (why: string): never => {
    throw new Error(`lifecycle.json: ${why}`);
  };
  if (raw === null || typeof raw !== 'object') return fail('must be an object');
  const data = raw as Record<string, unknown>;
  if (data.version !== 1) fail('version must be 1');
  if (!isMember(LIFECYCLE_STATES, data.start)) fail('start must be a state');
  const states = data.states;
  if (states === null || typeof states !== 'object' || !sameKeys(states, LIFECYCLE_STATES)) fail(`states must be exactly ${LIFECYCLE_STATES.join(', ')}, in that order`);
  const shown = data.shown as Record<string, unknown> | undefined;
  if (!shown || typeof shown !== 'object' || !sameKeys(shown, ['stale'])) fail('shown must be exactly stale');
  const needs = data.needs;
  if (needs === null || typeof needs !== 'object' || !sameKeys(needs, NEED_KINDS)) fail(`needs must be exactly ${NEED_KINDS.join(', ')}`);
  const events = data.events;
  if (events === null || typeof events !== 'object' || !sameKeys(events, LIFECYCLE_EVENTS)) fail(`events must be exactly ${LIFECYCLE_EVENTS.join(', ')}`);
  const rules = {} as Record<LifecycleEvent, EventRule>;
  for (const name of LIFECYCLE_EVENTS) {
    const rule = (events as Record<string, unknown>)[name] as Record<string, unknown>;
    if (!rule || typeof rule !== 'object') fail(`event ${name} must be an object`);
    for (const key of Object.keys(rule)) if (!['from', 'to', 'needs', 'by'].includes(key)) fail(`event ${name}: unknown key ${key}`);
    const from = rule.from;
    if (!Array.isArray(from) || from.length === 0 || !from.every((state) => isMember(LIFECYCLE_STATES, state))) fail(`event ${name}: from must list states`);
    const to = rule.to;
    if (to !== null && !isMember(LIFECYCLE_STATES, to)) fail(`event ${name}: to must be a state or null`);
    const need = rule.needs ?? [];
    if (!Array.isArray(need) || !need.every((kind) => isMember(NEED_KINDS, kind))) fail(`event ${name}: needs must list need kinds`);
    if (rule.by !== undefined && rule.by !== 'person') fail(`event ${name}: by must be person or absent`);
    rules[name] = { from: from as LifecycleState[], to: to as LifecycleState | null, needs: need as NeedKind[], by: rule.by === 'person' ? 'person' : 'anyone' };
  }
  return {
    version: 1,
    start: data.start as LifecycleState,
    states: states as Record<LifecycleState, string>,
    shown: shown as Record<'stale', string>,
    events: rules,
    needs: needs as Record<NeedKind, string>,
  };
}

export const LIFECYCLE: Lifecycle = readLifecycle(machine);

/** Open work: not finished and not stopped. */
export function isOpen(state: LifecycleState): boolean {
  return state !== 'implemented' && state !== 'verified' && state !== 'dropped';
}
