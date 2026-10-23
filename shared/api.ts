// The wire contract between the local API (server/) and the browser (src/).
// Types only: every rule that produces these values lives in server/.

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
  | 'duplicate-detail-selector';

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
