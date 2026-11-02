/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { ModelCheckRecord } from '../shared/model-check';
import { RuleStatusIcon, ruleVerification, useRuleDisclosure } from './rule-check';

const check = (extra: Partial<ModelCheckRecord> = {}): ModelCheckRecord => ({
  checker: 'tlc-1.7.4',
  date: '2026-11-02T08:12:00.000Z',
  config: 'tla/attachment.cfg',
  modelDigest: 'b'.repeat(64),
  states: 4,
  held: ['OnlyOpenOrClosed'],
  broke: [],
  unchecked: [],
  ...extra,
});

const broke = check({
  held: [],
  broke: [{ rule: 'NoWriteAfterClose', path: ['Close the attachment.', 'Write bytes.'], states: ['Closed'] }],
});

describe('rule verification', () => {
  it('shows nothing when the page has no model', () => {
    expect(ruleVerification({ model: false, modelCheck: check() })).toBeNull();
  });

  it('maps a current pass, a break, and an unfinished or stale check', () => {
    expect(ruleVerification({ model: true, modelCheck: check() })).toMatchObject({ status: 'verified', label: 'Verified', rules: [], reasons: [] });
    expect(ruleVerification({ model: true, modelCheck: broke })).toMatchObject({
      status: 'broke',
      label: 'Not verified',
      rules: [{ rule: 'NoWriteAfterClose', path: ['Close the attachment.', 'Write bytes.'] }],
    });
    expect(ruleVerification({ model: true })).toMatchObject({ status: 'open', label: 'Not checked', reasons: ['This model has not been checked.'] });
    expect(ruleVerification({ model: true, modelCheck: check({ held: [], unchecked: ['OnlyOpenOrClosed'], stop: 'states' }) })).toMatchObject({
      status: 'open',
      label: 'Not checked',
      reasons: ['The state limit stopped the check before OnlyOpenOrClosed.'],
    });
    expect(ruleVerification({ model: true, modelCheck: check({ held: [], unchecked: ['OnlyOpenOrClosed'], stop: 'time' }) })).toMatchObject({
      status: 'open',
      label: 'Not checked',
      reasons: ['The check timed out before OnlyOpenOrClosed.'],
    });
    expect(ruleVerification({ model: true, modelCheck: check(), stale: true })).toMatchObject({
      status: 'open',
      label: 'Out of date',
      reasons: ['The model changed since this check.'],
    });
    const staleBreak = ruleVerification({ model: true, modelCheck: broke, stale: true });
    expect(staleBreak?.status).toBe('open');
    expect(staleBreak?.label).toBe('Out of date');
    expect(staleBreak?.rules.map((item) => item.rule)).toEqual(['NoWriteAfterClose']);
    expect(staleBreak?.reasons).toContain('The model changed since this check.');
    const partial = ruleVerification({
      model: true,
      modelCheck: check({ broke: broke.broke, unchecked: ['OnlyOpenOrClosed'], stop: 'states', held: [] }),
    });
    expect(partial?.status).toBe('broke');
    expect(partial?.reasons).toContain('The state limit stopped the check before OnlyOpenOrClosed.');
  });
});

function Harness({ mark }: { mark: NonNullable<ReturnType<typeof ruleVerification>> }) {
  const { toggle, panel } = useRuleDisclosure(mark, <button type="button">Check rules</button>);
  return <div>{toggle}{panel}</div>;
}

describe('the status disclosure', () => {
  it('expands from the button and keeps the check action inside the panel', async () => {
    const mark = ruleVerification({ model: true, modelCheck: broke });
    if (!mark) throw new Error('expected a mark');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => { root.render(<Harness mark={mark} />); });
    const toggle = container.querySelector('button[aria-expanded]') as HTMLButtonElement;
    const panel = container.querySelector('[data-testid="rule-status-panel"]') as HTMLElement;
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.type).toBe('button');
    expect(toggle.getAttribute('aria-label')).toBe('Not verified');
    expect(toggle.getAttribute('title')).toBe('Not verified');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.hidden).toBe(true);

    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('NoWriteAfterClose');
    expect(panel.textContent).toContain('Close the attachment.');
    expect(panel.textContent).toContain('Write bytes.');
    expect(panel.textContent).toContain('Check rules');

    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    root.unmount();
    container.remove();
  });

  it('puts only the icon and its words on a catalog row', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<RuleStatusIcon model modelCheck={check()} />);
    });
    expect(container.querySelector('button')).toBeNull();
    const icon = container.querySelector('[data-rule-status]') as HTMLElement;
    expect(icon.getAttribute('data-rule-status')).toBe('verified');
    expect(icon.getAttribute('title')).toBe('Verified');
    expect(icon.textContent).toContain('Verified');
    root.unmount();
    container.remove();
  });
});
