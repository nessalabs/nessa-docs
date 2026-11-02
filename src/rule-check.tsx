// Check rules: progress, cancel, and a visible install offer when TLC is missing.
// The wording stays the same in the app and the MCP explorer.

import { useState } from 'react';
import type { ModelCheckRecord, ModelCheckRunView } from '../shared/model-check';
import { QuietButton } from './ui';

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
