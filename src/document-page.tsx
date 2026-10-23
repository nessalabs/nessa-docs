// One document. The reading pane gives its width to the prose and diagrams;
// provenance (file, sources, warnings) is a closed footer and the outline is
// one click away in the titlebar rather than a permanent column. A chart
// element with an authored explanation opens it in the details inspector.
// Loads by ID; an answer for an ID that is no longer current is dropped, so a
// slow answer cannot replace a newer page.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Token, Tokens } from 'marked';
import { ChevronRight, ListTree } from 'lucide-react';
import type { CatalogIssue, DocumentResponse, DocumentSummary, LinkTarget, UnknownDocumentResponse } from '../shared/api';
import { useProjectReads } from './project-opening/project-context';
import { groupByKind, KIND_NAME, KIND_SINGULAR } from './kinds';
import { lexMarkdown, markdownSections } from '../shared/markdown';
import { useAppearance } from './appearance';
import { DetailInspector } from './detail-inspector';
import { Diagram, type DiagramDetailEntry } from './diagram';
import { useDiagramDetail } from './diagram-detail';
import { collectDiagrams, collectHeadings, type Heading, MarkdownBody, TargetLink } from './markdown';
import { AppLink, documentPath, navigate, scrollToHash, useSearchAndHash } from './router';
import { Titlebar } from './shell';
import { plainText } from '../shared/markdown';
import { DocumentStatusLabel, IconButton, QuietButton, SegmentedControl, SegmentedControlOption } from './ui';
import { useEscapeLayer } from './layers';
import { useNarrow } from './viewport';

type PageState =
  | { readonly kind: 'loading'; readonly id: string }
  | { readonly kind: 'loaded'; readonly id: string; readonly response: DocumentResponse }
  | { readonly kind: 'unknown'; readonly id: string; readonly response: UnknownDocumentResponse }
  | { readonly kind: 'failed'; readonly id: string; readonly message: string };

export function DocumentPage(props: { id: string; catalogVersion: string; onStaleCatalog: () => void; focusOnLoad: boolean }) {
  const api = useProjectReads();
  const { id, catalogVersion, onStaleCatalog, focusOnLoad } = props;
  const [state, setState] = useState<PageState>({ kind: 'loading', id });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading', id });
    api.document(id, controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        if (outcome.kind === 'ok') setState({ kind: 'loaded', id, response: outcome.value });
        else if (outcome.kind === 'unknown-document') setState({ kind: 'unknown', id, response: outcome.value });
        else setState({ kind: 'failed', id, message: outcome.message });
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [id, attempt]);

  const loadedVersion = state.kind === 'loaded' ? state.response.version : null;
  useEffect(() => {
    if (loadedVersion !== null && loadedVersion !== catalogVersion) onStaleCatalog();
  }, [loadedVersion, catalogVersion, onStaleCatalog]);

  if (state.id !== id || state.kind === 'loading') {
    return (
      <>
        <Titlebar current={id} />
        <div className="page-status" aria-busy="true" data-page-state="loading">
          Loading…
        </div>
      </>
    );
  }
  if (state.kind === 'failed') {
    return (
      <>
        <Titlebar current={id} />
        <div className="page-status" role="alert" data-page-state="failed">
          <p>{state.message}</p>
          <QuietButton onClick={() => setAttempt((n) => n + 1)}>Try again</QuietButton>
        </div>
      </>
    );
  }
  if (state.kind === 'unknown') return <UnknownDocument response={state.response} />;
  return <DocumentView key={`${state.id}:${state.response.version}`} response={state.response} focusOnLoad={focusOnLoad} />;
}

type View = 'diagrams' | 'details';

/** Plain text compared without differences in spacing or a final full stop. */
function comparable(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

/**
 * Whether the body's first content block is a paragraph saying the summary,
 * either as the whole paragraph or as its complete first sentence. Only the
 * first block is considered: a later paragraph that happens to match stays
 * where the author put it. A shared start that stops mid-sentence is not the
 * summary, so the header keeps it.
 */
export function opensWithSummary(tokens: readonly Token[], summary: string): boolean {
  const first = tokens.find((token) => token.type !== 'space');
  if (first?.type !== 'paragraph') return false;
  const opening = comparable(plainText((first as Tokens.Paragraph).tokens));
  const said = comparable(summary);
  if (opening === said) return true;
  if (said === '' || !opening.startsWith(said)) return false;
  // The sentence ends where the summary does: at its own stop (with any closing quote or bracket it carries), or,
  // when it has none left after comparable(), at a bare stop in the opening. Either way a space follows.
  const rest = opening.slice(said.length);
  return /[.!?]["'”’)]*$/.test(said) ? /^\s/.test(rest) : /^[.!?]\s/.test(rest);
}

/**
 * Diagrams first: a page with charts opens on them, captioned by their
 * sections, with the full Markdown one click away in Details
 * (`?view=details`). A link to a section (`#anchor`) opens Details. A page
 * without charts is Details. Any other `view` value is not a view.
 */
export function chooseView(search: string, hash: string, hasDiagrams: boolean): View {
  if (!hasDiagrams) return 'details';
  const requested = new URLSearchParams(search).get('view');
  if (requested === 'details' || requested === 'diagrams') return requested;
  return hash.length > 1 ? 'details' : 'diagrams';
}

const NO_DETAILS: readonly DiagramDetailEntry[] = [];

function DocumentView({ response, focusOnLoad }: { response: DocumentResponse; focusOnLoad: boolean }) {
  const { document, breadcrumbs, children, sources, issues } = response;
  // Closed on every document: DocumentView is keyed by document, so this starts false each time.
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const provenance = useRef<HTMLDetailsElement>(null);
  const provenanceId = useId();
  const openProvenance = () => {
    setProvenanceOpen(true);
    requestAnimationFrame(() => {
      provenance.current?.scrollIntoView({ block: 'start' });
      provenance.current?.querySelector('summary')?.focus({ preventScroll: true });
    });
  };
  const title = useRef<HTMLHeadingElement>(null);
  const [titleOnScreen, setTitleOnScreen] = useState(true);
  const location = useSearchAndHash();

  const { all, sections, tokens, headings, slugs, diagrams } = useMemo(() => {
    const all = lexMarkdown(response.body);
    // A leading "# Title" repeats the title shown above.
    const first = all.findIndex((token) => token.type !== 'space');
    const lead = all[first];
    const body =
      lead?.type === 'heading' && lead.depth === 1 && plainText(lead.tokens).trim().toLowerCase() === document.title.toLowerCase()
        ? all.filter((_, index) => index !== first)
        : all;
    const collected = collectHeadings(body);
    // Sections are indexed over the whole body, as the server indexed them (shared/markdown.ts).
    return { all, sections: markdownSections(all), tokens: body, ...collected, diagrams: collectDiagrams(body, collected.slugs) };
  }, [response.body, document.title]);

  const view = chooseView(window.location.search, window.location.hash, diagrams.length > 0);
  const detailsHref = useCallback(
    (slug?: string) => `${documentPath(document.id)}?view=details${slug ? `#${encodeURIComponent(slug)}` : ''}`,
    [document.id],
  );
  const setView = (next: View) => {
    if (next !== view) navigate(next === 'details' ? detailsHref() : `${documentPath(document.id)}?view=diagrams`);
  };

  // The details inspector (design table in verification/CHECKLIST.md, "Diagram details").
  // One selection per page; it closes whenever the element it came from is redrawn or
  // removed (view or theme change), on any move in this tab's location (a link followed
  // from the inspector, Back/Forward), and DocumentView remounts per document version.
  const level = useDiagramDetail();
  const appearance = useAppearance();
  const narrow = useNarrow();
  const [selected, setSelected] = useState<number | null>(null);
  const [expandedCharts, setExpandedCharts] = useState(0);
  const invoker = useRef<Element | null>(null);
  // Where focus goes once the inspector has closed: the element it came from, or the link's destination.
  const focusAfterClose = useRef<Element | 'destination' | null>(null);
  const [paneLeft, setPaneLeft] = useState<number | null>(null);
  const onPlaced = useCallback((rect: DOMRect | null) => setPaneLeft(rect ? Math.round(rect.left) : null), []);
  const detailsByDiagram = useMemo(() => {
    const byDiagram = new Map<number, DiagramDetailEntry[]>();
    response.diagramDetails.forEach((detail, key) => {
      byDiagram.set(detail.diagram, [...(byDiagram.get(detail.diagram) ?? []), { key, detail }]);
    });
    return byDiagram;
  }, [response.diagramDetails]);
  const selectDetail = useCallback((key: number, element: Element) => {
    invoker.current = element;
    setSelected(key);
  }, []);
  const closeDetail = useCallback(() => {
    focusAfterClose.current = invoker.current;
    invoker.current = null;
    setSelected(null);
  }, []);
  const followLink = useCallback(() => {
    focusAfterClose.current = 'destination';
    invoker.current = null;
    setSelected(null);
  }, []);
  const onExpandedChange = useCallback((expanded: boolean) => setExpandedCharts((n) => n + (expanded ? 1 : -1)), []);
  useEffect(() => {
    invoker.current = null;
    setSelected(null);
  }, [view, appearance, location]);
  // After the inspector has closed (its own layout effect runs first), focus returns to the
  // element it came from, or moves to where a followed link led (the #section, else the title).
  useLayoutEffect(() => {
    const target = focusAfterClose.current;
    if (selected !== null || !target) return;
    focusAfterClose.current = null;
    let element: Element | null = target === 'destination' ? null : target;
    if (target === 'destination' && window.location.hash.length > 1) {
      try {
        element = window.document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
      } catch {
        element = null;
      }
      if (element instanceof HTMLElement && !element.hasAttribute('tabindex')) element.tabIndex = -1;
    }
    if ((element instanceof HTMLElement || element instanceof SVGElement) && element.isConnected) element.focus({ preventScroll: true });
    else title.current?.focus({ preventScroll: true });
  }, [selected]);
  // In the inspector a same-page #section link opens that section in Details (Diagrams does not draw the prose).
  const inspectorLinks = useMemo(() => {
    return Object.fromEntries<LinkTarget>(Object.entries(response.links).map(([href, target]) => [
      href,
      target.kind === 'anchor' ? { kind: 'document', id: document.id, fragment: target.fragment } : target,
    ]));
  }, [response.links, document.id]);
  const selection =
    selected !== null && response.diagramDetails[selected] ? { key: selected, detail: response.diagramDetails[selected] } : null;
  const chart = (index: number, source: string, canvas: boolean, caption?: Heading | null) => (
    <Diagram
      key={index}
      index={index}
      source={source}
      links={response.diagramLinks}
      canvas={canvas}
      caption={caption ? { text: caption.text, detailsHref: detailsHref(caption.slug) } : null}
      details={detailsByDiagram.get(index) ?? NO_DETAILS}
      selectedDetail={selection?.detail.diagram === index ? selection.key : null}
      onSelectDetail={selectDetail}
      onExpandedChange={onExpandedChange}
      revealLeftOf={selection?.detail.diagram === index && !narrow ? paneLeft : null}
    />
  );

  useEffect(() => {
    const element = title.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setTitleOnScreen(entry?.isIntersecting ?? false), {
      rootMargin: '-44px 0px 0px 0px',
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    window.document.title = `${document.title} · Nessa Docs`;
    if (focusOnLoad) title.current?.focus({ preventScroll: true });
  }, [document.title, focusOnLoad]);

  // On arrival and on every view change: the named section, or the top.
  const hash = window.location.hash;
  // Diagrams above the section finish rendering after this runs and push it
  // down, so the section is re-applied while the layout settles — until the
  // reader scrolls or types, or a few seconds pass.
  useEffect(() => {
    const main = window.document.getElementById('main');
    if (!scrollToHash(hash)) {
      main?.scrollTo(0, 0);
      return;
    }
    const article = window.document.querySelector('article.document');
    if (!article) return;
    const observer = new ResizeObserver(() => scrollToHash(hash));
    observer.observe(article);
    const stop = () => {
      observer.disconnect();
      window.removeEventListener('wheel', stop, true);
      window.removeEventListener('keydown', stop, true);
      window.removeEventListener('pointerdown', stop, true);
      window.removeEventListener('touchmove', stop, true);
    };
    window.addEventListener('wheel', stop, true);
    window.addEventListener('keydown', stop, true);
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('touchmove', stop, true);
    const timer = window.setTimeout(stop, 4000);
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [view, hash]);

  const outline = headings.filter((heading) => heading.depth <= 3);
  const summaryRepeatsTitle = document.summary.trim().toLowerCase() === document.title.trim().toLowerCase();
  // In Details, an opening paragraph that says the summary (whole, or as its first sentence) is the introduction; the header doesn't say it first.
  const bodyOpensWithSummary = opensWithSummary(tokens, document.summary);
  const childList = children.length > 0 ? <ChildList items={children} /> : null;
  const viewSwitch =
    diagrams.length > 0 ? (
      <SegmentedControl
        variant="glass"
        value={view}
        onValueChange={(value) => setView(value === 'details' ? 'details' : 'diagrams')}
        aria-label="View"
        className="view-switch"
      >
        <SegmentedControlOption value="diagrams" data-view="diagrams">
          Diagrams
        </SegmentedControlOption>
        <SegmentedControlOption value="details" data-view="details">
          Details
        </SegmentedControlOption>
      </SegmentedControl>
    ) : null;

  return (
    <>
      <Titlebar
        trail={breadcrumbs.slice(0, -1)}
        current={document.title}
        currentShown={!titleOnScreen}
        actions={
          <>
            {viewSwitch ? <div className="wide-only view-switch-slot">{viewSwitch}</div> : null}
            {outline.length > 1 ? <OutlineMenu headings={outline} hrefFor={detailsHref} /> : null}
          </>
        }
      />
      <div
        className="page document-layout"
        data-doc-id={document.id}
        data-view={view}
        data-diagram-detail={level}
        data-inspector={selection ? (narrow || expandedCharts > 0 ? 'dialog' : 'pane') : undefined}
      >
        <article className="document" aria-labelledby="doc-title">
          <header className="document-header" data-compact={view === 'diagrams' ? '' : undefined}>
            <h1 id="doc-title" ref={title} tabIndex={-1}>
              {document.title}
            </h1>
            <p className="document-meta">
              <span className="document-kind">{KIND_SINGULAR[document.kind]}</span>
              <DocumentStatusLabel status={document.status} />
              <button
                type="button"
                className="meta-revision"
                data-testid="source-revision"
                title={document.sourceRevision ? `Source reviewed at ${document.sourceRevision}` : 'No source commit recorded for this page'}
                onClick={openProvenance}
                aria-controls={provenanceId}
              >
                {document.sourceRevision ? `Reviewed at ${document.sourceRevision.slice(0, 12)}` : 'Source revision not recorded'}
              </button>
              {issues.length > 0 ? (
                <button type="button" className="meta-warning" onClick={openProvenance} aria-controls={provenanceId}>
                  {issues.length} warning{issues.length === 1 ? '' : 's'}
                </button>
              ) : null}
              {view === 'diagrams' && !summaryRepeatsTitle ? (
                <span className="document-summary-inline" title={document.summary}>
                  {document.summary}
                </span>
              ) : null}
            </p>
            {view === 'details' && !summaryRepeatsTitle && !bodyOpensWithSummary ? (
              <p className="document-summary">{document.summary}</p>
            ) : null}
            {viewSwitch ? <div className="narrow-only view-switch-slot">{viewSwitch}</div> : null}
          </header>

          {view === 'diagrams' ? (
            <>
              <div className="diagram-view">{diagrams.map((diagram, index) => chart(index, diagram.source, true, diagram.section))}</div>
              {childList}
            </>
          ) : (
            <>
              {document.kind !== 'system' ? childList : null}
              <MarkdownBody
                tokens={tokens}
                slugs={slugs}
                links={response.links}
                diagram={(index, source) => chart(index, source, false)}
              />
              {document.kind === 'system' ? childList : null}
            </>
          )}

          {/* Provenance is reference material: last, and closed until asked for. */}
          <details
            ref={provenance}
            id={provenanceId}
            className="provenance"
            open={provenanceOpen}
            onToggle={(event) => setProvenanceOpen(event.currentTarget.open)}
          >
            <summary data-action="provenance">
              <span className="provenance-title">Sources and provenance</span>
              <span className="provenance-count">
                {sources.length} source{sources.length === 1 ? '' : 's'}
                {issues.length > 0 ? ` · ${issues.length} warning${issues.length === 1 ? '' : 's'}` : ''}
              </span>
            </summary>
            <div className="provenance-body">
              <dl>
                <div>
                  <dt>Source reviewed at</dt>
                  <dd data-testid="source-revision-full">
                    {document.sourceRevision ? <code>{document.sourceRevision}</code> : 'Not recorded for this page'}
                    <p className="quiet">The source commit this page was reviewed against. This is not a test result or a claim that newer code is covered.</p>
                  </dd>
                </div>
                <div>
                  <dt>File</dt>
                  <dd>
                    <code>{document.file}</code>
                  </dd>
                </div>
                <div>
                  <dt>ID</dt>
                  <dd>
                    <code>{document.id}</code>
                  </dd>
                </div>
                <div>
                  <dt>Sources</dt>
                  <dd>
                    {sources.length === 0 ? (
                      <span className="quiet">None listed</span>
                    ) : (
                      <ul className="source-list">
                        {sources.map((source) => (
                          <li key={source.raw}>
                            <TargetLink target={source.target}>{null}</TargetLink>
                            {source.target.kind === 'unresolved' ? <code className="evidence-path">{source.raw}</code> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="details-note">Provenance only: paths are named and checked for existence, never opened.</p>
                  </dd>
                </div>
              </dl>
              {issues.length > 0 ? <IssueList title="Warnings" issues={issues} /> : null}
            </div>
          </details>
        </article>
        <DetailInspector
          selection={selection}
          tokens={all}
          sections={sections}
          slugs={slugs}
          links={inspectorLinks}
          diagramLinks={response.diagramLinks}
          level={level}
          modal={narrow || expandedCharts > 0}
          detailsHref={detailsHref}
          onClose={closeDetail}
          onFollowLink={followLink}
          onPlaced={onPlaced}
        />
      </div>
    </>
  );
}

/** "On this page": the headings, one click away instead of a permanent column. */
function OutlineMenu({ headings, hrefFor }: { headings: readonly Heading[]; hrefFor: (slug: string) => string }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEscapeLayer(open, () => {
    setOpen(false);
    button.current?.focus();
  });
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('a')?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!list.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [open]);
  return (
    <div className="outline-menu">
      <IconButton ref={button} label="On this page" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((v) => !v)} data-action="outline">
        <ListTree />
      </IconButton>
      {open ? (
        <div ref={list} id={menuId} className="popover outline" role="navigation" aria-label="On this page">
          <ul>
            {headings.map((heading) => (
              <li key={heading.slug} data-depth={heading.depth}>
                <a
                  href={hrefFor(heading.slug)}
                  onClick={(event) => {
                    event.preventDefault();
                    setOpen(false);
                    navigate(hrefFor(heading.slug));
                  }}
                >
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ChildList({ items }: { items: readonly DocumentSummary[] }) {
  return (
    <section className="child-section" aria-label="Contents">
      {groupByKind(items).map((group) => (
        <div key={group.kind} className="child-group">
          <h2 className="caption">{KIND_NAME[group.kind]}</h2>
          <ul className="child-list">
            {group.items.map((child) => (
              <li key={child.id}>
                <AppLink to={documentPath(child.id)} className="child-row card" data-doc-id={child.id}>
                  <span className="child-title">{child.title}</span>
                  {child.summary.trim().toLowerCase() !== child.title.trim().toLowerCase() ? (
                    <span className="child-summary">{child.summary}</span>
                  ) : null}
                  <span className="child-meta">
                    {child.children.length > 0 ? <span className="child-count">{child.children.length}</span> : null}
                    <DocumentStatusLabel status={child.status} className="status-compact" title={child.status} />
                  </span>
                  <ChevronRight aria-hidden="true" className="child-chevron" />
                </AppLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function IssueList({ title, issues }: { title: string; issues: readonly CatalogIssue[] }) {
  return (
    <section className="issues" aria-label={title}>
      <h2 className="caption">{title}</h2>
      <ul>
        {issues.map((issue, index) => (
          <li key={index} className={`issue issue-${issue.severity}`} data-issue-code={issue.code}>
            <span className="issue-head">
              <span className="issue-severity">{issue.severity}</span>
              <code className="issue-code">{issue.code}</code>
              <code className="issue-file">{issue.file}</code>
            </span>
            <span className="issue-message">{issue.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UnknownDocument({ response }: { response: UnknownDocumentResponse }) {
  useEffect(() => {
    window.document.title = 'Document not found · Nessa Docs';
  }, []);
  return (
    <>
      <Titlebar current="Not found" />
      <div className="page not-found" data-page-state="not-found">
        <h1 tabIndex={-1}>No document “{response.id}”</h1>
        {response.rejected.length > 0 ? (
          <>
            <p>A file declares this ID, but it was rejected:</p>
            <IssueList title="Why it was rejected" issues={response.rejected} />
          </>
        ) : (
          <p>No accepted document in docs/state has this ID. Nothing else is shown in its place.</p>
        )}
        <p>
          <AppLink to="/">Open the system overview</AppLink> or search from the sidebar.
        </p>
      </div>
    </>
  );
}
