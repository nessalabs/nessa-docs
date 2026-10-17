import { useEffect, useId, useRef, useState } from 'react';
import { ListTree } from 'lucide-react';
import type { Heading } from './markdown';
import { navigate } from './router';
import { IconButton } from './ui';
import { useEscapeLayer } from './layers';

export function OutlineMenu({ headings, hrefFor, label = "On this page" }: { headings: readonly Heading[]; hrefFor: (slug: string) => string; label?: string; hint?: string }) {
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
      <IconButton ref={button} label={label} aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((v) => !v)} data-action="outline">
        <ListTree />
      </IconButton>
      {open ? (
        <div ref={list} id={menuId} className="popover outline" role="navigation" aria-label={label}>
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

