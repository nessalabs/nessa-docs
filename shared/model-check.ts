// The rule-check result shared by the page frontmatter, the local API, and MCP.
// The runner that produces these values lives in server/model-check/.

export const TLC_VERSION = '1.7.4';
export const CHECKER_ID = `tlc-${TLC_VERSION}`;

/** Distinct-state cap and wall-clock cap for one TLC invocation. */
export const MODEL_CHECK_LIMITS = { maxDistinctStates: 2_000, timeoutMs: 20_000 } as const;

/**
 * Bounds for a plain sentence stored on a page. `path` is the most steps on a
 * broken rule. `sentence` is the most characters in one of those steps, and
 * in one `model.steps` sentence. The checker writes inside these bounds, and
 * the page parser rejects a record outside them.
 */
export const BROKEN_RULE_LIMITS = { path: 30, sentence: 200 } as const;

export const CHECK_RUN_STATES = [
  'not-installed',
  'downloading',
  'ready',
  'running',
  'passed',
  'broke',
  'not-checked',
  'failed',
  'cancelled',
] as const;
export type CheckRunState = (typeof CHECK_RUN_STATES)[number];

export const CHECKER_STATES = ['not-installed', 'downloading', 'ready', 'failed'] as const;
export type CheckerState = (typeof CHECKER_STATES)[number];

/** Frontmatter `model`. Paths are relative to `docs/state`. */
export interface ModelLink {
  readonly spec: string;
  readonly config: string;
  /** TLC action name → one plain sentence. `Init` is the initial state. */
  readonly steps: Readonly<Record<string, string>>;
}

export interface BrokenRule {
  readonly rule: string;
  readonly path: readonly string[];
  /** Diagram node ids that appear in the last state of the counterexample. */
  readonly states: readonly string[];
}

/** Why a run left rules in `unchecked`. */
export const CHECK_STOPS = ['states', 'time'] as const;
export type CheckStop = (typeof CHECK_STOPS)[number];

/** Frontmatter `modelCheck`, also the tool and HTTP result body. */
export interface ModelCheckRecord {
  readonly sourceRevision?: string;
  readonly checker: string;
  readonly date: string;
  readonly config: string;
  readonly modelDigest: string;
  readonly states: number;
  readonly held: readonly string[];
  readonly broke: readonly BrokenRule[];
  readonly unchecked: readonly string[];
  /** Set when the state limit or the time limit stopped the run. */
  readonly stop?: CheckStop;
}

export interface CheckerStatus {
  readonly state: CheckerState;
  readonly version: string;
  readonly cachePath: string;
  readonly message?: string;
}

export interface ModelCheckRunView {
  readonly id: string;
  readonly state: CheckRunState;
  readonly message: string;
  readonly result?: ModelCheckRecord;
}

/** Rules of one config after a finished or bounded run. They do not overlap. */
export interface RuleFindings {
  readonly states: number;
  readonly held: readonly string[];
  readonly broke: readonly BrokenRule[];
  readonly unchecked: readonly string[];
  readonly stop?: CheckStop;
}
