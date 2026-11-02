// Check rules: progress, cancel, and a visible install offer when TLC is missing.
// The wording stays the same in the app and the MCP explorer.

import { useEffect, useId, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, CircleDashed, type LucideIcon } from 'lucide-react';
import type { ModelCheckRecord, ModelCheckRunView } from '../shared/model-check';
import { QuietButton } from './ui';

export interface RuleMark {
  readonly status: 'verified' | 'broke' | 'open';
  readonly label: string;
  readonly rules: readonly { readonly rule: string; readonly path: readonly string[] }[];
  readonly reasons: readonly string[];
}

const STATUS_ICON: Record<RuleMark['status'], LucideIcon> = {
  verified: CircleCheck,
  broke: CircleAlert,
  open: CircleDashed,
};

/** Icon state for a page. No model means no indicator. */
export function ruleVerification(input: {
  readonly model: boolean;
  readonly modelCheck?: ModelCheckRecord;
  readonly stale?: boolean;
}): RuleMark | null {
  if (!input.model) return null;
  const check = input.modelCheck;
  const rules = check?.broke.map((item) => ({ rule: item.rule, path: item.path })) ?? [];
  if (!check) return { status: 'open', label: 'Not checked', rules, reasons: ['This model has not been checked.'] };
  const reasons = openReasons(check, input.stale === true);
  if (input.stale) return { status: 'open', label: 'Out of date', rules, reasons };
  if (rules.length > 0) return { status: 'broke', label: 'Not verified', rules, reasons };
  if (check.unchecked.length > 0) return { status: 'open', label: 'Not checked', rules, reasons };
  return { status: 'verified', label: 'Verified', rules, reasons: [] };
}

function openReasons(check: ModelCheckRecord, stale: boolean): string[] {
  const reasons: string[] = [];
  if (stale) reasons.push('The model changed since this check.');
  if (check.unchecked.length > 0) {
    const names = check.unchecked.join(', ');
    if (check.stop === 'states') reasons.push(`The state limit stopped the check before ${names}.`);
    else if (check.stop === 'time') reasons.push(`The check timed out before ${names}.`);
    else reasons.push(`Not finished: ${names}.`);
  }
  return reasons;
}

/** Icon only, for a catalog row. The words are the hover label and the accessible name. */
export function RuleStatusIcon({ model, modelCheck, stale }: { model?: boolean; modelCheck?: ModelCheckRecord; stale?: boolean }) {
  const mark = ruleVerification({ model: model === true, modelCheck, stale });
  if (!mark) return null;
  const Icon = STATUS_ICON[mark.status];
  return (
    <span className={`rule-status-icon rule-status-${mark.status}`} title={mark.label} data-rule-status={mark.status}>
      <Icon aria-hidden="true" />
      <span className="visually-hidden">{mark.label}</span>
    </span>
  );
}

/** Compact status button, with the detail and the check action behind it. */
export function useRuleDisclosure(mark: RuleMark | null, controls: ReactNode, resetKey?: string) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  useEffect(() => { setOpen(false); }, [resetKey]);
  if (!mark) return { toggle: null, panel: null };
  const Icon = STATUS_ICON[mark.status];
  const toggle = (
    <button
      type="button"
      className={`rule-status-toggle rule-status-${mark.status}`}
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={mark.label}
      title={mark.label}
      data-testid="rule-status"
      data-rule-status={mark.status}
      onClick={() => setOpen((value) => !value)}
    >
      <Icon aria-hidden="true" />
    </button>
  );
  const panel = (
    <div id={panelId} className="rule-status-panel" hidden={!open} data-testid="rule-status-panel">
      {mark.status === 'verified' ? <p>Every rule held on this model.</p> : null}
      {mark.rules.map((item) => (
        <div key={item.rule}>
          <p><strong>{item.rule}</strong> does not hold.</p>
          <ol>{item.path.map((step, index) => <li key={`${item.rule}-${index}`}>{step}</li>)}</ol>
        </div>
      ))}
      {mark.reasons.map((reason) => <p key={reason}>{reason}</p>)}
      {controls}
    </div>
  );
  return { toggle, panel };
}

export function RuleBadge({ revision, stale }: { revision?: string; stale?: boolean }) {
  if (!revision) return null;
  return (
    <span
      className={stale ? 'meta-rule meta-rule-stale' : 'meta-rule'}
      data-testid="rule-badge"
      data-stale={stale ? '' : undefined}
      title={stale ? 'The source checkpoint or the model changed after this check.' : 'The source checkpoint this model was checked against.'}
    >
      Rules checked at {revision.slice(0, 12)}{stale ? ' · stale' : ''}
    </span>
  );
}

export function RulePath({ rules }: { rules: readonly { rule: string; path: readonly string[] }[] }) {
  if (rules.length === 0) return null;
  return (
    <aside className="rule-path" data-testid="rule-path">
      {rules.map((item) => (
        <div key={item.rule}>
          <p><strong>{item.rule}</strong> does not hold.</p>
          <ol>{item.path.map((step, index) => <li key={`${item.rule}-${index}`}>{step}</li>)}</ol>
        </div>
      ))}
      <p className="quiet">This path is about the design, not a test of the code.</p>
    </aside>
  );
}

export function RuleCheckControls({
  disabled,
  onCheck,
  onInstall,
}: {
  disabled?: boolean;
  onCheck: (report: (message: string) => void, signal: AbortSignal) => Promise<ModelCheckRunView | null>;
  onInstall: (report: (message: string) => void, signal: AbortSignal) => Promise<string | null>;
}) {
  const [message, setMessage] = useState('');
  const [offer, setOffer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [controller, setController] = useState<AbortController | null>(null);

  const run = async (action: 'check' | 'install') => {
    const next = new AbortController();
    setController(next);
    setBusy(true);
    setOffer(false);
    setMessage(action === 'install' ? 'Downloading the rule checker…' : 'Checking rules…');
    try {
      if (action === 'install') {
        const installed = await onInstall(setMessage, next.signal);
        setMessage(installed ?? 'The rule checker is installed. This checks the design, not the code.');
        return;
      }
      const view = await onCheck(setMessage, next.signal);
      if (!view) return;
      if (view.state === 'not-installed') {
        setOffer(true);
        setMessage(view.message || 'The rule checker is not installed. Nothing was marked as held.');
        return;
      }
      setMessage(view.message);
    } catch (error) {
      if (!next.signal.aborted) setMessage(error instanceof Error ? error.message : 'The rule check failed.');
    } finally {
      setBusy(false);
      setController(null);
    }
  };

  return (
    <div className="rule-check" data-testid="rule-check">
      <QuietButton data-testid="check-rules" disabled={disabled || busy} onClick={() => void run('check')}>
        {busy && !offer ? 'Checking…' : 'Check rules'}
      </QuietButton>
      {busy && controller ? (
        <QuietButton data-testid="check-cancel" onClick={() => controller.abort()}>Cancel</QuietButton>
      ) : null}
      {offer ? (
        <QuietButton data-testid="check-install" onClick={() => void run('install')}>Install checker</QuietButton>
      ) : null}
      {message ? <p className="rule-check-status" data-testid="check-progress" role="status">{message}</p> : null}
      <p className="quiet">A model checks this design, not the code.</p>
    </div>
  );
}

export function summarize(record: ModelCheckRecord | undefined): string {
  if (!record) return '';
  const held = record.held.join(', ') || 'none';
  const broke = record.broke.map((item) => item.rule).join(', ') || 'none';
  const unchecked = record.unchecked.join(', ') || 'none';
  return `Held: ${held}. Broke: ${broke}. Not checked: ${unchecked}.`;
}
