import './inspector-header.css';
import { Badge } from '@nessa-ui/react/badge';
import type { Ref } from 'react';
import { X } from 'lucide-react';
import type { Crumb, DiagramDetailTarget } from '../shared/api';
import { AppLink, documentPath } from './router';
import { IconButton } from './ui';

export function InspectorHeader({titleId, headingRef, title, elementName, target, linked, onClose, closeLabel = 'Close details', openLabel = 'Open'}: {titleId: string; headingRef: Ref<HTMLHeadingElement>; title: string; elementName: string; target: DiagramDetailTarget; linked?: Crumb | null; onClose: () => void; closeLabel?: string; openLabel?: string}) {
  return (
          <header className="inspector-head">
            <h2 id={titleId} ref={headingRef} tabIndex={-1} className="inspector-title" dir="auto">
              {title}
            </h2>
            <IconButton label={closeLabel} onClick={onClose} data-action="close-details" className="inspector-close">
              <X />
            </IconButton>
            <div className="inspector-element" dir="auto" data-testid="inspector-element">
              {target.kind === 'edge' ? (
                <span className="inspector-relation" dir="ltr"><code>{target.from}</code> → <code>{target.to}</code></span>
              ) : <code>{target.node}</code>}
              <Badge className="inspector-kind" variant="secondary" dir="auto">
                {elementName}
              </Badge>
            </div>
            {target.kind === 'edge' ? <p className="inspector-label" dir="auto">{target.label}</p> : null}
            {linked ? (
              <AppLink to={documentPath(linked.id)} className="inspector-open" data-action="open-linked-document">{openLabel} <bdi>{linked.title}</bdi>
              </AppLink>
            ) : null}
          </header>
  );
}
