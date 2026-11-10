// The wire contract between the local API (server/) and the browser (src/).
// Types only: every rule that produces these values lives in server/.

import type { LifecycleEvent, LifecycleState, ShownState } from './lifecycle.js';
import type { ModelCheckRecord, ModelLink } from './model-check.js';

export const DOCUMENT_KINDS = [
  'system',
  'service',
  'feature',
  'flow',
  'statechart',
  'operation',
  'contract',
  'guide',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_STATUSES = ['implemented', 'mixed', 'fixture', 'proposed', 'reference'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** One accepted document as listed in the catalog and the sidebar. */
export interface DocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly kind: DocumentKind;
  readonly status: DocumentStatus;
  readonly summary: string;
  /** Authored source commit reviewed for this page, not the catalog hash or checkout HEAD. */
  readonly sourceRevision?: string;
  readonly parent: string | null;
  /** Child document IDs, ordered by file path. */
  readonly children: readonly string[];
  /** Repository-relative path of the Markdown file, e.g. `docs/state/services/chat/README.md`. */
  readonly file: string;
  /** Linked TLA+ model, when this page has one. */
  readonly model?: ModelLink;
  /** Last finished rule check saved on the page. */
  readonly modelCheck?: ModelCheckRecord;
  /** True when the saved check does not match the current checkpoint or model bytes. */
  readonly modelCheckStale?: boolean;
  /** Where this page's work is, from its records; absent on a page with no work block and no records. */
  readonly work?: WorkSummary;
}

/** A page's work at a glance: the sidebar pill and the child list. */
export interface WorkSummary {
  readonly state: ShownState;
  /** UTC time of the newest accepted record for the page or any of its tasks; null when none. */
  readonly lastRecordAt: string | null;
  readonly tasks: number;
  /** Tasks not implemented, verified or dropped. */
  readonly open: number;
  readonly blocked: number;
  /** Records that were refused (each is an error in Health). */
  readonly refused: number;
}

/** One `evidence` entry on a record. */
export type WorkEvidence =
  | { readonly kind: 'pr'; readonly value: string }
  | { readonly kind: 'commit'; readonly value: string }
  | { readonly kind: 'check'; readonly value: string }
  | { readonly kind: 'diff'; readonly value: string };

/** One record file, as written and as the lifecycle judged it. */
export interface WorkRecord {
  /** Repository-relative path, e.g. docs/state/work/<page>/<task>/<at>-<by>.md. */
  readonly file: string;
  readonly task: string | null;
  readonly event: LifecycleEvent;
  /** The state the record says the event leads to. */
  readonly state: LifecycleState;
  readonly at: string;
  readonly by: string;
  readonly model?: string;
  readonly sourceRevision?: string;
  readonly evidence: readonly WorkEvidence[];
  /** Markdown; one or two sentences, or the question for `ask`. */
  readonly body: string;
  /** Why the lifecycle refused it; null when it moved (or noted) the task. A refused record never moves a box. */
  readonly refused: string | null;
}

/** One task of a page's `work` block with the state its records lead to. */
export interface WorkTask {
  readonly id: string;
  readonly title: string;
  /** The chart element it makes real, when that element was found; otherwise a warning says why. */
  readonly anchor: { readonly diagram: number; readonly target: DiagramDetailTarget } | null;
  readonly dependsOn: readonly string[];
  readonly state: LifecycleState;
  /** The newest accepted record for this task, or null. */
  readonly lastRecordAt: string | null;
  readonly lastBy: string | null;
}

export interface PageWork {
  readonly summary: WorkSummary;
  /** The state the records lead to, before `stale` is worked out. */
  readonly recorded: LifecycleState;
  readonly tasks: readonly WorkTask[];
  /** Every record for the page and its tasks, oldest first (by `at`, then file). */
  readonly records: readonly WorkRecord[];
  /** After this many milliseconds with no record, open work is drawn as quiet. */
  readonly quietAfterMs: number;
}

/** Why a file was rejected (`error`) or accepted with a caveat (`warning`). */
export type IssueCode =
  | 'state-directory-missing'
  | 'state-directory-escape'
  | 'too-many-files'
  | 'too-deep'
  | 'file-too-large'
  | 'unreadable-file'
  | 'symlink-escape'
  | 'symlink-not-followed'
  | 'missing-frontmatter'
  | 'malformed-yaml'
  | 'missing-field'
  | 'invalid-field'
  | 'unknown-field'
  | 'duplicate-id'
  | 'missing-root'
  | 'misplaced-root'
  | 'missing-parent'
  | 'parent-rejected'
  | 'parent-cycle'
  | 'parent-location-mismatch'
  | 'unknown-diagram-target'
  | 'unused-diagram-link'
  // A `diagramDetails` entry that cannot be bound; the document stays, the entry has no action.
  | 'unknown-detail-diagram'
  | 'unsupported-detail-diagram'
  | 'unknown-detail-node'
  | 'unknown-detail-edge'
  | 'unsupported-detail-label'
  | 'ambiguous-detail-edge'
  | 'unknown-detail-section'
  | 'ambiguous-detail-section'
  | 'duplicate-detail-selector'
  | 'missing-model-file'
  | 'duplicate-model'
  // docs/state/nessa-docs.yaml (server/project-config.ts).
  | 'invalid-config'
  | 'unknown-card'
  | 'card-family-mismatch'
  | 'unresolved-reference'
  | 'missing-source-revision'
  // Work records under docs/state/work (server/work.ts).
  | 'invalid-record'
  | 'unknown-work-page'
  | 'unknown-work-task'
  | 'refused-record'
  | 'unbound-work-anchor'
  | 'unknown-work-dependency';

export type IssueSeverity = 'error' | 'warning';

export interface CatalogIssue {
  /** Repository-relative path of the file the issue is about (`docs/state` for directory-wide issues). */
  readonly file: string;
  readonly code: IssueCode;
  readonly severity: IssueSeverity;
  readonly message: string;
  /** The ID the file declared, when it declared a readable one. */
  readonly documentId: string | null;
}

export interface CatalogResponse {
  /** Changes whenever any Markdown file under docs/state changes. */
  readonly version: string;
  readonly rootId: string | null;
  readonly documents: readonly DocumentSummary[];
  readonly issues: readonly CatalogIssue[];
}

/** Where a Markdown link or a `sources` entry points, decided by the server. */
export type LinkTarget =
  | { readonly kind: 'document'; readonly id: string; readonly fragment: string | null }
  | { readonly kind: 'anchor'; readonly fragment: string }
  | {
      readonly kind: 'repo-file';
      readonly path: string;
      readonly fragment: string | null;
      readonly exists: boolean;
    }
  | { readonly kind: 'outside-repo'; readonly path: string; readonly fragment: string | null }
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'unresolved'; readonly reason: string };

export interface SourceReference {
  readonly raw: string;
  readonly target: LinkTarget;
}

export interface Crumb {
  readonly id: string;
  readonly title: string;
}

/**
 * The Mermaid chart families `diagramDetails` bind to: a state diagram (states and
 * transitions) or a flowchart (plain nodes and edges, e.g. a component map).
 */
export type DiagramFamily = 'state' | 'flowchart';

/** What a `diagramDetails` entry selects, as Mermaid identifies it in the rendered SVG. */
export type DiagramDetailTarget =
  | { readonly kind: 'node'; readonly node: string }
  | {
      readonly kind: 'edge';
      readonly from: string;
      readonly to: string;
      /** The edge's label exactly as authored (and as found in the chart). */
      readonly label: string;
      /** Mermaid's identity for this edge: the `data-id` of its path and label in the SVG. */
      readonly element: string;
    };

/** One validated `diagramDetails` entry: a chart element explained by a section of the same document. */
export interface DiagramDetail {
  /** Zero-based order of the Mermaid block in the body (shared/markdown.ts, markdownDiagrams). */
  readonly diagram: number;
  /** The chart's family, as Mermaid read it: what the element is called (a transition or an edge). */
  readonly family: DiagramFamily;
  readonly target: DiagramDetailTarget;
  readonly section: {
    /** The heading text, unique among the body's sections. */
    readonly title: string;
    /** Its position in markdownSections(lexMarkdown(body)). */
    readonly index: number;
  };
}

/** The Mermaid chart a card style is meant for; `any` takes every chart. */
export const CARD_FAMILIES = ['state', 'sequence', 'flowchart', 'any'] as const;
export type CardFamily = (typeof CARD_FAMILIES)[number];

/** A diagram card style a page may name on its Mermaid fence (`card=handoff`). */
export interface CardStyle {
  readonly name: string;
  /** Which built-in look draws it. */
  readonly look: 'lifecycle' | 'handoff' | 'map' | 'plain';
  readonly family: CardFamily;
  /** Shown in the card header when the fence names no title. */
  readonly label: string;
}

/**
 * The roles a state can be tagged with (`class Pending waiting` in Mermaid).
 * Fixed on purpose, so a colour means the same thing on every page.
 */
export const STATE_ROLES = ['start', 'working', 'waiting', 'done', 'refused', 'uncertain', 'ended'] as const;
export type StateRole = (typeof STATE_ROLES)[number];

/** What a reference pill shows in its peek: a page, a section of one, or a note file. */
export interface ReferencePreview {
  readonly title: string;
  /** Markdown, frontmatter removed; cut at a block boundary when long. */
  readonly body: string;
  readonly truncated: boolean;
  /** Every href in `body`, resolved relative to the previewed file. */
  readonly links: Readonly<Record<string, LinkTarget>>;
  /** The file the preview came from, repository-relative. */
  readonly file: string;
}

/** A matched reference after the server resolved it. */
export interface ResolvedReference {
  readonly rule: string;
  /** Text drawn in the pill. */
  readonly label: string;
  readonly target: LinkTarget;
  /** Present for a page, section or note the reader can show in place. */
  readonly preview: ReferencePreview | null;
}

/** A reference pattern as the browser receives it: the same split the server used. */
export interface ReferenceRuleView {
  readonly name: string;
  readonly match: string;
}

export interface DocumentResponse {
  readonly version: string;
  readonly document: DocumentSummary;
  /** Markdown body without frontmatter. Rendered as text by the client; never as HTML. */
  readonly body: string;
  /** Every link/image href in the body, keyed by the href exactly as written. */
  readonly links: Readonly<Record<string, LinkTarget>>;
  readonly sources: readonly SourceReference[];
  /** Mermaid node ID → validated target document. */
  readonly diagramLinks: Readonly<Record<string, Crumb>>;
  /** Chart elements with an explanation in this document; entries that could not be bound are warnings instead. */
  readonly diagramDetails: readonly DiagramDetail[];
  /** Root first, this document last. */
  readonly breadcrumbs: readonly Crumb[];
  readonly children: readonly DocumentSummary[];
  /** Warnings that apply to this document. */
  readonly issues: readonly CatalogIssue[];
  /** Patterns from the project config, in order; the browser splits text with them (shared/references.ts). */
  readonly referenceRules: readonly ReferenceRuleView[];
  /** Every reference found in the body, keyed by referenceKey(rule, text). */
  readonly references: Readonly<Record<string, ResolvedReference>>;
  /** Card styles this project offers, by name. */
  readonly cards: Readonly<Record<string, CardStyle>>;
  /** The page's tasks and records; null when it has neither. */
  readonly work: PageWork | null;
}

export interface UnknownDocumentResponse {
  readonly error: 'unknown-document';
  readonly id: string;
  /** Rejected files that declared this ID, so the 404 can say why. */
  readonly rejected: readonly CatalogIssue[];
}

export interface SearchResult {
  readonly id: string;
  readonly title: string;
  readonly kind: DocumentKind;
  readonly snippet: string;
}

export interface SearchResponse {
  readonly query: string;
  readonly results: readonly SearchResult[];
}
