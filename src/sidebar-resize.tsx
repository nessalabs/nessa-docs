import { t } from './i18n';
// The docked sidebar's resize separator, in the gutter between the panes.
// States and orderings: verification/CHECKLIST.md, "Sidebar resize" (rows R1–R10,
// R13 cited below). A drag previews by writing `--sidebar-w` on the shell
// directly, so nothing re-renders while the pointer moves; the width is
// committed (and stored, by the owner of `onCommit`) once, on release. The
// light along the edge follows the pointer the same way, through `--sidebar-glow`
// on the handle (src/styles.css).

import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { clampSidebarWidth, SIDEBAR_WIDTH } from './sidebar-width';

interface Drag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  preview: number;
}

const valueText = (width: number) => `${width} pixels`;

export function SidebarResizer({
  shell,
  width,
  onCommit,
}: {
  shell: RefObject<HTMLDivElement | null>;
  width: number;
  onCommit: (width: number) => void;
}) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const preview = useCallback(
    (value: number) => {
      shell.current?.style.setProperty('--sidebar-w', `${value}px`);
      handle.current?.setAttribute('aria-valuenow', String(value));
      handle.current?.setAttribute('aria-valuetext', valueText(value));
    },
    [shell],
  );

  // R4 (commit) and R5/R6 (discard). Clearing `drag` first makes the
  // lostpointercapture that our own release causes a no-op.
  const finish = useCallback(
    (commit: boolean) => {
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      shell.current?.removeAttribute('data-resizing');
      if (handle.current?.hasPointerCapture(current.pointerId)) handle.current.releasePointerCapture(current.pointerId);
      // A discard moves the edge back from under the pointer: forget the light's height there and
      // then, as WebKit sends no pointerleave until the pointer next moves (R16).
      if (!commit) handle.current?.style.removeProperty('--sidebar-glow');
      if (commit && current.preview !== current.startWidth) onCommit(current.preview);
      else preview(current.startWidth);
    },
    [shell, onCommit, preview],
  );

  // R10: unmounted mid-drag (sidebar hidden, window narrowed) — discard the preview.
  useEffect(
    () => () => {
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      shell.current?.removeAttribute('data-resizing');
      shell.current?.style.setProperty('--sidebar-w', `${current.startWidth}px`);
    },
    [shell],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return; // R2
    event.preventDefault();
    // A press is not keyboard focus: the light then leaves with the pointer (R16).
    event.currentTarget.focus({ preventScroll: true, focusVisible: false });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, preview: width };
    shell.current?.setAttribute('data-resizing', '');
  };

  // R15: the light follows the pointer's height on the handle, while hovered and while dragging.
  const glow = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--sidebar-glow', `${event.clientY - box.top}px`);
  };

  // R16: leaving while idle forgets the height, so keyboard focus later lights the middle.
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) event.currentTarget.style.removeProperty('--sidebar-glow');
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    glow(event);
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    // R3, R13: measured from the press, so leaving a bound and coming back follows the pointer.
    const next = clampSidebarWidth(current.startWidth + (document.documentElement.dir === 'rtl' ? -1 : 1) * (event.clientX - current.startX));
    if (next === current.preview) return;
    current.preview = next;
    preview(next);
  };

  const onPointerEnd = (commit: boolean) => (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) finish(commit);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (drag.current) {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false); // R6
      }
      return;
    }
    const next =
      event.key === 'ArrowLeft'
        ? width + (document.documentElement.dir === 'rtl' ? 1 : -1) * SIDEBAR_WIDTH.step
        : event.key === 'ArrowRight'
          ? width + (document.documentElement.dir === 'rtl' ? -1 : 1) * SIDEBAR_WIDTH.step
          : event.key === 'Home'
            ? SIDEBAR_WIDTH.min
            : event.key === 'End'
              ? SIDEBAR_WIDTH.max
              : null;
    if (next === null) return;
    event.preventDefault();
    onCommit(next); // R7, R8
  };

  return (
    <div
      ref={handle}
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-controls="sidebar"
      aria-label={t("Resize sidebar")}
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      aria-valuenow={width}
      aria-valuetext={valueText(width)}
      tabIndex={0}
      title={t("Drag to resize · double-click to reset")}
      data-sidebar-resizer=""
      onPointerEnter={glow}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd(true)}
      onPointerCancel={onPointerEnd(false)}
      onLostPointerCapture={onPointerEnd(false)}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(SIDEBAR_WIDTH.initial)} // R9
    />
  );
}
