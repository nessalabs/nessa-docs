// The peek a reference pill opens: the referenced page, section or note,
// rendered in place beside the reading pane (a modal dialog on narrow windows).
// Its content is Markdown the server already read and resolved
// (server/references.ts); links inside it go through the preview's own link
// table, and charts inside it are not drawn here: "Open" shows them in full.

import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import type { Token } from 'marked';
import { X } from 'lucide-react';
import type { ResolvedReference } from '../shared/api';
import { lexMarkdown } from '../shared/markdown';
import { useEscapeLayer } from './layers';
import { MarkdownBody, TargetLink } from './markdown';
import { IconButton } from './ui';

const NO_SLUGS = new Map<Token, string>();

export function ReferencePeek({
  reference,
  modal,
  onClose,
}: {
  reference: ResolvedReference | null;
  modal: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const preview = reference?.preview ?? null;
  const tokens = useMemo(() => (preview ? lexMarkdown(preview.body) : []), [preview]);
  // The preview's own first heading repeats its title; the header already shows it.
  const body = useMemo(() => {
    const first = tokens.findIndex((token) => token.type !== 'space');
    return first >= 0 && tokens[first]?.type === 'heading' ? tokens.slice(first + 1) : tokens;
  }, [tokens]);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (preview === null) {
      if (element.open) element.close();
      return;
    }
    if (element.open && element.matches(':modal') !== modal) element.close();
    if (!element.open) {
      if (modal) element.showModal();
      else element.show();
    }
    scroller.current?.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [preview, modal]);

  useEscapeLayer(preview !== null, onClose, modal);

  return (
    <dialog
      ref={dialog}
      className="detail-inspector reference-peek"
      aria-labelledby={titleId}
      data-peek-rule={reference?.rule}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        const link = (event.target as Element | null)?.closest?.('a[href]');
        if (!link || !event.currentTarget.contains(link) || link.getAttribute('target') === '_blank') return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        onClose();
      }}
    >
      {reference && preview ? (
        <div className="inspector-frame">
          <header className="inspector-head">
            <p className="inspector-kind">{reference.label}</p>
            <h2 id={titleId} ref={heading} tabIndex={-1} className="inspector-title">
              {preview.title}
            </h2>
            <IconButton label="Close reference" onClick={onClose} data-action="close-reference" className="inspector-close">
              <X />
            </IconButton>
            <p className="inspector-element">
              <code>{preview.file}</code>
            </p>
            {reference.target.kind === 'document' ? (
              <span className="inspector-open">
                <TargetLink target={reference.target}>Open page</TargetLink>
              </span>
            ) : null}
          </header>
          <div ref={scroller} className="inspector-body" tabIndex={-1}>
            <MarkdownBody
              tokens={body}
              slugs={NO_SLUGS}
              links={preview.links}
              className="prose inspector-prose"
              diagram={() => <p className="inspector-chart">A chart is here. Open the page to see it.</p>}
            />
            {preview.truncated ? <p className="peek-truncated">This preview is cut short. Open the page to read all of it.</p> : null}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
