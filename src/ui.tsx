import { t } from './i18n';
// The Nessa UI components this site uses, from the vendored Nessa UI subset
// (see THIRD_PARTY_NOTICES.md), with the app-local defaults this browser needs.

import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@nessa-ui/react/button';
import { Input } from '@nessa-ui/react/input';
import { StatusLabel, type StatusLabelTone } from '@nessa-ui/react/status-label';
import { SegmentedControl, SegmentedControlOption } from '@nessa-ui/react/segmented-control';
import type { DocumentStatus } from '../shared/api';

export { Button, Input, SegmentedControl, SegmentedControlOption };

/** A 28px icon-only control, as in the Nessa desktop titlebar. The label is its name and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string; children: ReactNode }>(
  function IconButton({ label, className, children, ...props }, ref) {
    return (
      <Button
        ref={ref}
        variant="ghost"
        size="icon"
        aria-label={label}
        title={label}
        className={`icon-button ${className ?? ''}`}
        {...props}
      >
        {children}
      </Button>
    );
  },
);

/** A small text control: 28px tall, quiet until hovered. */
export function QuietButton({ className, ...props }: ButtonProps) {
  return <Button variant="ghost" size="sm" className={`quiet-button ${className ?? ''}`} {...props} />;
}

const STATUS_TONE: Record<DocumentStatus, StatusLabelTone> = {
  implemented: 'good',
  mixed: 'warning',
  fixture: 'neutral',
  proposed: 'active',
  reference: 'neutral',
};

const STATUS_TEXT: Record<DocumentStatus, string> = {
  implemented: 'Implemented',
  mixed: 'Mixed',
  fixture: 'Fixture',
  proposed: 'Proposed',
  reference: 'Reference',
};

export function DocumentStatusLabel({ status, ...props }: { status: DocumentStatus } & Omit<ComponentProps<'span'>, 'children'>) {
  return (
    <StatusLabel tone={STATUS_TONE[status]} data-status={status} {...props}>
      {t(STATUS_TEXT[status])}
    </StatusLabel>
  );
}
