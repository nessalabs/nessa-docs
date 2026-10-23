// The details inspector: the authored section that explains a chart element.
// On wide windows it is a quiet inset pane over the right of the reading pane
// (non-modal; the page moves the chart so the element stays in view beside it);
// on narrow windows, or over an expanded chart, it is a modal dialog. Its
// content is the document's own Markdown section, rendered by MarkdownBody: no
// HTML is injected, links go through the server's resolution table, and nothing
// is generated. A chart inside the section is a link to that chart in Details,
// not a second chart. Following any link from here closes it.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Token } from 'marked';
import { InspectorHeader } from './inspector-header';
import type { Crumb, DiagramDetail, LinkTarget } from '../shared/api';
import { type MarkdownSection, markdownDiagrams } from '../shared/markdown';
import { chartAnchor, ELEMENT_NAMES } from './diagram';
import type { DiagramDetailLevel } from './diagram-detail';
import { useEscapeLayer } from './layers';
import { MarkdownBody } from './markdown';
import { AppLink, documentPath } from './router';
import { QuietButton } from './ui';

export interface InspectorSelection {
  readonly key: number;
  readonly detail: DiagramDetail;
}

/** At most this many blocks before the section's first nested heading: the overview Standard opens on. */
const OVERVIEW_BLOCKS = 2;

/** The section's opening: its blocks up to the first nested heading, at most OVERVIEW_BLOCKS of them. */
export function sectionOverview(body: readonly Token[]): readonly Token[] {
  const overview: Token[] = [];
  let blocks = 0;
  for (const token of body) {
    if (token.type === 'heading' || blocks === OVERVIEW_BLOCKS) break;
    overview.push(token);
    if (token.type !== 'space') blocks += 1;
  }
  return overview;
}

const contentCount = (tokens: readonly Token[]) => tokens.filter((token) => token.type !== 'space').length;
// The section's own headings render without anchors: the page's headings own those IDs.
const NO_SLUGS = new Map<Token, string>();

export function DetailInspector({
  selection,
  tokens,
  sections,
  slugs,
  links,
  diagramLinks,
  level,
  modal,
  detailsHref,
  onClose,
  onFollowLink,
  onPlaced,
}: {
  selection: InspectorSelection | null;
  /** The whole body, as markdownSections indexed it. */
  tokens: readonly Token[];
  sections: readonly MarkdownSection[];
  slugs: Map<Token, string>;
  links: Readonly<Record<string, LinkTarget>>;
  diagramLinks: Readonly<Record<string, Crumb>>;
  level: DiagramDetailLevel;
  modal: boolean;
  detailsHref: (slug?: string) => string;
  onClose: () => void;
  /** A link in the inspector was followed in this tab. */
  onFollowLink: () => void;
  /** Where the open inspector sits on screen (null when closed), so the page can keep the element beside it. */
  onPlaced: (rect: DOMRect | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // "Show full explanation" applies to the detail it was chosen on.
  const [fullFor, setFullFor] = useState<number | null>(null);
  const key = selection?.key ?? null;

  // Open, close, or move between pane and dialog; focus goes to the title.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (key === null) {
      if (element.open) element.close();
      onPlaced(null);
      return;
    }
    if (element.open && element.matches(':modal') !== modal) element.close();
    if (!element.open) {
      if (modal) element.showModal();
      else element.show();
    }
    scroller.current?.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
    onPlaced(element.getBoundingClientRect());
    const observer = new ResizeObserver(() => onPlaced(element.getBoundingClientRect()));
    observer.observe(element);
    return () => observer.disconnect();
  }, [key, modal, onPlaced]);

  // Escape closes it when it is the top layer (src/layers.ts); turning into a dialog over an
  // expanded chart raises it above that chart.
  useEscapeLayer(key !== null, onClose, modal);

  // As a dialog, Tab wraps inside it rather than leaving for the browser's own controls.
  useEffect(() => {
    if (key === null) return;
    const onKey = (event: KeyboardEvent) => {
      const element = dialog.current;
      if (event.key === 'Tab' && element?.matches(':modal')) {
        // Moved here, in the dialog's order, rather than left to the engine: WebKit skips links by
        // default, so its notion of the last stop differs, and focus would leave the dialog.
        const focusable = [...element.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]')];
        if (focusable.length === 0) return;
        const at = focusable.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? focusable[at <= 0 ? focusable.length - 1 : at - 1]
          : focusable[at < 0 || at === focusable.length - 1 ? 0 : at + 1];
        event.preventDefault();
        event.stopPropagation();
        next?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [key]);

  const section = selection ? sections[selection.detail.section.index] : undefined;
  const body = section ? tokens.slice(section.start + 1, section.end) : [];
  const overview = sectionOverview(body);
  const showFull = level === 'full' || fullFor === key;
  const shown = showFull ? body : overview;
  const more = !showFull && contentCount(overview) < contentCount(body);
  const target = selection?.detail.target;
  const linked = target?.kind === 'node' && Object.hasOwn(diagramLinks, target.node) ? (diagramLinks[target.node] as Crumb) : null;
  const slug = section ? slugs.get(section.heading) : undefined;
  // Mermaid blocks before the section's body: a block in it is chart (offset + n) of the page.
  const chartsBefore = section ? markdownDiagrams(tokens.slice(0, section.start + 1)).length : 0;

  return (
    <dialog
      ref={dialog}
      className="detail-inspector"
      aria-labelledby={titleId}
      data-detail-level={level}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // After the link's own handler has navigated: a link followed in this tab closes the inspector.
        const link = (event.target as Element | null)?.closest?.('a[href]');
        if (!link || !event.currentTarget.contains(link) || link.getAttribute('target') === '_blank') return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        onFollowLink();
      }}
    >
      {selection && section && target ? (
        <div className="inspector-frame" data-detail-key={selection.key}>
          <InspectorHeader titleId={titleId} headingRef={heading} title={section.title}
            elementName={ELEMENT_NAMES[selection.detail.family][target.kind]} target={target}
            linked={linked} onClose={onClose} />
          <div ref={scroller} className="inspector-body" tabIndex={-1} data-shown={showFull ? 'full' : 'overview'}>
            <MarkdownBody
              tokens={shown}
              slugs={NO_SLUGS}
              links={links}
              className="prose inspector-prose"
              diagram={(index) => (
                <p className="inspector-chart">
                  <AppLink to={detailsHref(chartAnchor(chartsBefore + index))} data-action="inspector-chart" data-diagram-index={chartsBefore + index}>
                    Open chart {chartsBefore + index + 1} in Details
                  </AppLink>
                </p>
              )}
            />
            {more ? (
              <QuietButton
                onClick={() => {
                  setFullFor(selection.key);
                  // The button goes; keep the reader in the explanation it opened.
                  requestAnimationFrame(() => scroller.current?.focus({ preventScroll: true }));
                }}
                data-action="show-full"
                className="inspector-more"
              >
                Show full explanation
              </QuietButton>
            ) : null}
            <AppLink to={detailsHref(slug)} className="inspector-section-link" data-action="inspector-section">
              Show this section in Details
            </AppLink>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
