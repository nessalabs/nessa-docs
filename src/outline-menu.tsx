import './outline-menu.css';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ListTree } from 'lucide-react';
import type { Heading } from './markdown';
import { navigate, useSearchAndHash } from './router';
import { Button } from './ui';
import { useEscapeLayer } from './layers';

export function OutlineMenu({ headings, hrefFor, label = "On this page", hint = "Jump to section · Esc to close" }: { headings: readonly Heading[]; hrefFor: (slug: string) => string; label?: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const location = useSearchAndHash();
  const selected = location.split("#")[1] ?? "";
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
      <Button variant="ghost" size="sm" className="outline-trigger" ref={button} aria-label={label} aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((v) => !v)} data-action="outline">
        <ListTree aria-hidden="true" /><span>{label}</span><ChevronDown aria-hidden="true" />
      </Button>
      {open ? (
        <div ref={list} id={menuId} className="popover outline" role="navigation" aria-label={label}>
          <div className="outline-heading"><ListTree aria-hidden="true" /><span>{label}</span><span className="outline-count">{headings.length}</span></div>
          <ul>
            {headings.map((heading, index) => (
              <li key={heading.slug} data-depth={heading.depth}>
                <a
                  href={hrefFor(heading.slug)}
                  aria-current={selected === encodeURIComponent(heading.slug) ? "location" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    setOpen(false);
                    navigate(hrefFor(heading.slug));
                  }}
                >
                  <span className="outline-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <span dir="auto" className="outline-label">{heading.text}</span>
                  {selected === encodeURIComponent(heading.slug) ? <Check aria-hidden="true" /> : null}
                </a>
              </li>
            ))}
          </ul>
          <div className="outline-hint">{hint}</div>
        </div>
      ) : null}
    </div>
  );
}

