/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { PageWork } from '../shared/api';
import { ago, isQuiet, workMarks, WorkView } from './work-view';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const HOUR = 3_600_000;

const work: PageWork = {
  summary: { state: 'blocked', lastRecordAt: '2026-11-10T09:00:00Z', tasks: 2, open: 2, blocked: 1, refused: 1 },
  recorded: 'blocked',
  quietAfterMs: 2 * HOUR,
  tasks: [
    { id: 'retry', title: 'Retry a failed start', anchor: { diagram: 0, target: { kind: 'node', node: 'Retrying' } }, dependsOn: [], state: 'blocked', lastRecordAt: '2026-11-10T09:00:00Z', lastBy: 'codex' },
    { id: 'cleanup', title: 'Clean up', anchor: null, dependsOn: ['retry'], state: 'working', lastRecordAt: '2026-11-10T11:30:00Z', lastBy: 'claude' },
  ],
  records: [
    { file: 'docs/state/work/run/retry/a.md', task: 'retry', event: 'ask', state: 'blocked', at: '2026-11-10T09:00:00Z', by: 'codex', model: 'some-model', evidence: [], body: 'Retry three times or once?\n\nI recommend three.', refused: null },
    { file: 'docs/state/work/run/cleanup/b.md', task: 'cleanup', event: 'merge', state: 'implemented', at: '2026-11-10T11:00:00Z', by: 'claude', evidence: [{ kind: 'commit', value: 'a'.repeat(40) }], body: '', refused: '"merge" is not allowed from working; it is allowed from review' },
    { file: 'docs/state/work/run/cleanup/c.md', task: 'cleanup', event: 'start', state: 'working', at: '2026-11-10T11:30:00Z', by: 'claude', evidence: [{ kind: 'pr', value: 'https://github.com/o/r/pull/1' }], body: 'Started.', refused: null },
  ],
};

describe('work view', () => {
  it('calls open work quiet only after quietAfter, and never finished or unstarted work', () => {
    expect(isQuiet('working', '2026-11-10T09:00:00Z', 2 * HOUR, NOW)).toBe(true);
    expect(isQuiet('working', '2026-11-10T11:00:00Z', 2 * HOUR, NOW)).toBe(false);
    expect(isQuiet('implemented', '2026-11-01T00:00:00Z', 2 * HOUR, NOW)).toBe(false);
    expect(isQuiet('planned', '2026-11-01T00:00:00Z', 2 * HOUR, NOW)).toBe(false);
    expect(ago('2026-11-10T09:00:00Z', NOW)).toBe('3 h ago');
    expect(ago('2026-11-10T11:59:30Z', NOW)).toBe('just now');
  });

  it('marks only anchored tasks, by chart', () => {
    const marks = workMarks(work, NOW);
    expect([...marks.keys()]).toEqual([0]);
    expect(marks.get(0)).toEqual([{ target: { kind: 'node', node: 'Retrying' }, state: 'blocked', quiet: true, title: 'Retry a failed start' }]);
  });

  it('shows the open question, refused records and evidence, newest first', () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => root.render(<WorkView work={work} now={NOW} />));
    expect(container.querySelector('.work-summary')?.textContent).toContain('2 tasks, 2 open, 1 blocked · last record 3 h ago · 1 refused');
    expect(container.querySelector('.work-question')?.textContent).toBe('Retry three times or once?I recommend three.');
    expect([...container.querySelectorAll('.work-record')].map((item) => item.getAttribute('data-event'))).toEqual(['start', 'merge', 'ask']);
    expect(container.querySelector('[data-refused] .work-record-refused')?.textContent).toContain('is not allowed from working');
    expect(container.querySelector('.work-evidence a')?.getAttribute('href')).toBe('https://github.com/o/r/pull/1');
    expect(container.querySelector('[data-task="cleanup"] .work-task-meta')?.textContent).toContain('Not drawn');
    act(() => root.unmount());
  });
});
