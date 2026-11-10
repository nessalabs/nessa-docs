import { describe, expect, it } from 'vitest';
import machine from '../skills/nessa-docs/references/lifecycle.json' with { type: 'json' };
import { LIFECYCLE, readLifecycle } from '../shared/lifecycle.js';
import { loadCatalog } from './catalog.js';
import { parseProjectConfig } from './project-config.js';
import { cachedHistory, touches } from './source-history.js';
import { doc, REPO, STATE } from './testing/documents.js';
import { memoryFiles } from './testing/memory-files.js';
import { parseRecord, recordLocation } from './work.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const COMMIT = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const CHART = '# Background command\n\n```mermaid\nstateDiagram-v2\n  [*] --> Starting\n  Starting --> Running: started\n  Starting --> Cleaning: timed out\n  Cleaning --> [*]\n```\n';

const TASKS = [
  { id: 'start-it', title: 'Start the command', anchor: { diagram: 0, node: 'Running' } },
  { id: 'timeout-cleanup', title: 'Clean up when a start times out', anchor: { diagram: 0, edge: { from: 'Starting', to: 'Cleaning', label: 'timed out' } }, dependsOn: ['start-it'] },
];

interface Record {
  task?: string;
  event: string;
  state: string;
  at: string;
  by?: string;
  extra?: string;
  body?: string;
}

function record(page: string, entry: Record): [string, string] {
  const folder = entry.task ? `${STATE}/work/${page}/${entry.task}` : `${STATE}/work/${page}`;
  const name = `${entry.at.replace(/:/g, '-')}-${entry.by ?? 'codex'}.md`;
  const text = `---\npage: ${page}\n${entry.task ? `task: ${entry.task}\n` : ''}event: ${entry.event}\nstate: ${entry.state}\nat: ${entry.at}\nby: ${entry.by ?? 'codex'}\n${entry.extra ?? ''}---\n${entry.body ?? ''}\n`;
  return [`${folder}/${name}`, text];
}

function tree(records: Record[], options: { tasks?: unknown; config?: string; page?: object } = {}): { [path: string]: string } {
  return {
    [`${STATE}/README.md`]: doc('root', null),
    [`${STATE}/run.md`]: doc('run', 'root', { kind: 'statechart', status: 'proposed', sources: ['src/run.ts'], work: options.tasks ?? TASKS, ...(options.page ?? {}) }, CHART),
    [`${STATE}/nessa-docs.yaml`]: options.config ?? 'work:\n  people: [saurav]\n',
    [`${REPO}/src/run.ts`]: 'export {}',
    ...Object.fromEntries(records.map((entry) => record('run', entry))),
  };
}

async function load(records: Record[], options: Parameters<typeof tree>[1] = {}, history?: Parameters<typeof loadCatalog>[4]) {
  return loadCatalog(memoryFiles(tree(records, options)), REPO, undefined, undefined, { now: () => NOW, ...history });
}

const accept: Record = { event: 'accept', state: 'planned', at: '2026-11-10T08:00:00Z', by: 'saurav' };

describe('the lifecycle file', () => {
  it('is read by the code exactly as shipped', () => {
    expect(readLifecycle(machine)).toEqual(LIFECYCLE);
    expect(Object.keys(LIFECYCLE.states)).toEqual(['draft', 'planned', 'working', 'blocked', 'review', 'implemented', 'verified', 'dropped']);
    expect(LIFECYCLE.events.merge).toEqual({ from: ['review'], to: 'implemented', needs: ['commit'], by: 'anyone' });
    expect(LIFECYCLE.events.accept.by).toBe('person');
  });

  it('refuses a file that adds a state or an event', () => {
    expect(() => readLifecycle({ ...machine, states: { ...machine.states, paused: 'x' } })).toThrow(/states must be exactly/);
    expect(() => readLifecycle({ ...machine, events: { ...machine.events, pause: { from: ['working'], to: 'working' } } })).toThrow(/events must be exactly/);
  });
});

describe('record files', () => {
  it('sit under a page folder, or a task folder inside it', () => {
    expect(recordLocation('docs/state/work/run/a.md')).toEqual({ page: 'run', task: null });
    expect(recordLocation('docs/state/work/run/start-it/2026-11-10T08-00-00Z-codex.md')).toEqual({ page: 'run', task: 'start-it' });
    expect(recordLocation('docs/state/work/run/a/b/c.md')).toMatch(/a record sits at/);
    expect(recordLocation('docs/state/work/Run/a.md')).toMatch(/not a page id/);
  });

  it('say everything wrong with a bad record', () => {
    const problems = parseRecord('docs/state/work/run/start-it/x.md', '---\npage: other\ntask: start-it\nevent: begin\nstate: going\nat: yesterday\nby: Codex\ncolour: red\n---\n', NOW);
    expect(problems).toEqual([
      '"colour" is not a record field (page, task, event, state, at, by, model, sourceRevision, evidence)',
      'page must be "run", the folder it sits in; found "other"',
      expect.stringMatching(/^event must be one of/),
      expect.stringMatching(/^state must be one of/),
      expect.stringMatching(/^at must be a UTC time/),
      expect.stringMatching(/^by must name who wrote it/),
    ]);
    expect(parseRecord('docs/state/work/run/x.md', '---\npage: run\nevent: note\nstate: draft\nat: 2999-01-01T00:00:00Z\nby: codex\n---\n', NOW)).toEqual(['at 2999-01-01T00:00:00Z is in the future']);
  });

  it('read evidence of each kind, and refuse a short commit', () => {
    const text = `---\npage: run\nevent: note\nstate: draft\nat: 2026-11-10T08:00:00Z\nby: codex\nmodel: some-model\nevidence:\n  - pr: https://github.com/o/r/pull/1\n  - commit: "${COMMIT}"\n  - check: npm test\n---\nLanded.\n`;
    expect(parseRecord('docs/state/work/run/x.md', text, NOW)).toMatchObject({ model: 'some-model', body: 'Landed.', evidence: [{ kind: 'pr' }, { kind: 'commit', value: COMMIT }, { kind: 'check', value: 'npm test' }] });
    expect(parseRecord('docs/state/work/run/x.md', text.replace(COMMIT, 'abc123'), NOW)).toEqual(['evidence[1].commit must be a quoted full lowercase Git commit ID']);
  });
});

describe('replaying records through the lifecycle', () => {
  it('moves each task by its newest allowed record and the page follows its tasks', async () => {
    const catalog = await load([
      accept,
      { task: 'start-it', event: 'start', state: 'working', at: '2026-11-10T09:00:00Z' },
      { task: 'start-it', event: 'submit', state: 'review', at: '2026-11-10T10:00:00Z', extra: 'evidence:\n  - pr: https://github.com/o/r/pull/1\n' },
      { task: 'timeout-cleanup', event: 'start', state: 'working', at: '2026-11-10T09:30:00Z', by: 'claude' },
    ]);
    expect(catalog.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    const work = catalog.documents.get('run')?.work;
    expect(work?.tasks.map((task) => [task.id, task.state, task.lastBy])).toEqual([['start-it', 'review', 'codex'], ['timeout-cleanup', 'working', 'claude']]);
    expect(work?.summary).toEqual({ state: 'working', lastRecordAt: '2026-11-10T10:00:00Z', tasks: 2, open: 2, blocked: 0, refused: 0 });
    expect(catalog.documents.get('run')?.summary.work?.state).toBe('working');
    expect(work?.tasks[1]?.anchor).toMatchObject({ diagram: 0, target: { kind: 'edge', from: 'Starting', to: 'Cleaning', label: 'timed out' } });
  });

  it('refuses a skipped step, and the refused record moves nothing', async () => {
    const catalog = await load([
      accept,
      { task: 'start-it', event: 'merge', state: 'implemented', at: '2026-11-10T09:00:00Z', extra: `evidence:\n  - commit: "${COMMIT}"\n` },
    ]);
    const refused = catalog.issues.filter((issue) => issue.code === 'refused-record');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.message).toBe('"merge" is not allowed from planned; it is allowed from review');
    expect(refused[0]?.severity).toBe('error');
    expect(catalog.documents.get('run')?.work?.tasks[0]?.state).toBe('planned');
    expect(catalog.documents.get('run')?.work?.summary.refused).toBe(1);
  });

  it('refuses work before the person accepts the plan', async () => {
    const catalog = await load([{ task: 'start-it', event: 'start', state: 'working', at: '2026-11-10T09:00:00Z' }]);
    expect(catalog.issues.find((issue) => issue.code === 'refused-record')?.message).toBe('the page\'s plan is not accepted yet; a person accepts the page first');
    expect(catalog.documents.get('run')?.summary.work?.state).toBe('draft');
    // Not even a person can accept one task ahead of the page.
    const early = await load([{ task: 'start-it', event: 'accept', state: 'planned', at: '2026-11-10T07:00:00Z', by: 'saurav' }]);
    expect(early.issues.find((issue) => issue.code === 'refused-record')?.message).toMatch(/plan is not accepted yet/);
  });

  it('only lets a listed person accept or answer, and never with a model', async () => {
    const byAgent = await load([{ ...accept, by: 'codex' }]);
    expect(byAgent.issues.find((issue) => issue.code === 'refused-record')?.message).toBe('"accept" is a person\'s move, and "codex" is not listed in work.people');
    const noPeople = await load([accept], { config: 'version: 1\n' });
    expect(noPeople.issues.find((issue) => issue.code === 'refused-record')?.message).toMatch(/list who may make it under work.people/);
    const withModel = await load([{ ...accept, extra: 'model: some-model\n' }]);
    expect(withModel.issues.find((issue) => issue.code === 'refused-record')?.message).toBe('"accept" is a person\'s move, but the record names a model');
  });

  it('checks what each event needs, plus what the project adds', async () => {
    const start = { task: 'start-it', event: 'start', state: 'working', at: '2026-11-10T09:00:00Z' };
    const ask = await load([accept, start, { task: 'start-it', event: 'ask', state: 'blocked', at: '2026-11-10T09:10:00Z' }]);
    expect(ask.issues.find((issue) => issue.code === 'refused-record')?.message).toBe('"ask" refused: it needs the question in its body, with the options and a recommendation');
    const asked = await load([accept, start, { task: 'start-it', event: 'ask', state: 'blocked', at: '2026-11-10T09:10:00Z', body: 'Retry or give up? I recommend retry.' }]);
    expect(asked.documents.get('run')?.summary.work).toMatchObject({ state: 'blocked', blocked: 1 });
    const submit = { task: 'start-it', event: 'submit', state: 'review', at: '2026-11-10T09:20:00Z', extra: 'evidence:\n  - diff: src/run.ts\n' };
    const merge = { task: 'start-it', event: 'merge', state: 'implemented', at: '2026-11-10T09:30:00Z', extra: `evidence:\n  - commit: "${COMMIT}"\n` };
    const strict = await load([accept, start, submit, merge], { config: 'work:\n  people: [saurav]\n  require:\n    merge: [check]\n' });
    expect(strict.issues.find((issue) => issue.code === 'refused-record')?.message).toBe('"merge" refused: it needs a passing check in its evidence');
    const loose = await load([accept, start, submit, merge]);
    expect(loose.documents.get('run')?.work?.tasks[0]?.state).toBe('implemented');
  });

  it('says the record claims the wrong state', async () => {
    const catalog = await load([accept, { task: 'start-it', event: 'start', state: 'review', at: '2026-11-10T09:00:00Z' }]);
    expect(catalog.issues.find((issue) => issue.code === 'refused-record')?.message).toBe('"start" from planned leads to working, but the record says review');
  });

  it('keeps a page with tasks from moving ahead of them', async () => {
    const catalog = await load([accept, { event: 'merge', state: 'implemented', at: '2026-11-10T09:00:00Z', extra: `evidence:\n  - commit: "${COMMIT}"\n` }]);
    expect(catalog.issues.find((issue) => issue.code === 'refused-record')?.message).toBe('this page follows its tasks; write "merge" on a task, not the page');
  });

  it('finishes the page when every task is finished or dropped, and reopening one opens the page', async () => {
    const flow = (task: string, hour: string): Record[] => [
      { task, event: 'start', state: 'working', at: `2026-11-10T${hour}:00:00Z` },
      { task, event: 'submit', state: 'review', at: `2026-11-10T${hour}:10:00Z`, extra: 'evidence:\n  - diff: src/run.ts\n' },
      { task, event: 'merge', state: 'implemented', at: `2026-11-10T${hour}:20:00Z`, extra: `evidence:\n  - commit: "${COMMIT}"\n` },
    ];
    const drop: Record = { task: 'timeout-cleanup', event: 'drop', state: 'dropped', at: '2026-11-10T10:30:00Z', body: 'Not needed: the runner already cleans up.' };
    const done = await load([accept, ...flow('start-it', '09'), drop]);
    expect(done.documents.get('run')?.summary.work).toMatchObject({ state: 'implemented', open: 0 });
    const reopened = await load([accept, ...flow('start-it', '09'), drop, { task: 'start-it', event: 'reopen', state: 'working', at: '2026-11-10T11:00:00Z' }]);
    expect(reopened.documents.get('run')?.summary.work?.state).toBe('working');
  });

  it('a page with no tasks moves on its own records', async () => {
    const catalog = await load([accept, { event: 'start', state: 'working', at: '2026-11-10T09:00:00Z' }], { tasks: [] });
    expect(catalog.documents.get('run')?.summary.work).toMatchObject({ state: 'working', tasks: 0 });
  });

  it('orders by time, then by file name, whatever order the files are read in', async () => {
    const catalog = await load([
      { task: 'start-it', event: 'start', state: 'working', at: '2026-11-10T09:00:00Z' },
      accept,
    ]);
    expect(catalog.documents.get('run')?.work?.records.map((entry) => entry.event)).toEqual(['accept', 'start']);
    expect(catalog.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('reports records for unknown pages and tasks, and anchors that name nothing', async () => {
    const files = tree([accept, { task: 'nope', event: 'start', state: 'working', at: '2026-11-10T09:00:00Z' }], {
      tasks: [{ id: 'start-it', title: 'Start', anchor: { diagram: 0, node: 'Missing' }, dependsOn: ['ghost'] }],
    });
    files[`${STATE}/work/ghost-page/x.md`] = '---\npage: ghost-page\nevent: note\nstate: draft\nat: 2026-11-10T08:00:00Z\nby: codex\n---\n';
    const catalog = await loadCatalog(memoryFiles(files), REPO, undefined, undefined, { now: () => NOW });
    const codes = catalog.issues.map((issue) => [issue.code, issue.severity]);
    expect(codes).toContainEqual(['unknown-work-page', 'error']);
    expect(codes).toContainEqual(['unknown-work-task', 'error']);
    expect(codes).toContainEqual(['unbound-work-anchor', 'warning']);
    expect(codes).toContainEqual(['unknown-work-dependency', 'warning']);
    expect(catalog.documents.get('run')?.work?.tasks[0]?.anchor).toBeNull();
  });

  it('refuses a work block with a malformed task, rejecting the page like any bad field', async () => {
    const catalog = await load([], { tasks: [{ id: 'x', title: 'X', anchor: { diagram: 0, section: 'y', node: 'A' } }] });
    expect(catalog.issues.find((issue) => issue.code === 'invalid-field')?.message).toMatch(/^"work\[0\]\.anchor" must be a mapping/);
    expect(catalog.documents.has('run')).toBe(false);
  });

  it('does not read records as pages', async () => {
    const catalog = await load([accept]);
    expect([...catalog.documents.keys()]).toEqual(['root', 'run']);
    expect(catalog.issues.filter((issue) => issue.code === 'missing-frontmatter' || issue.code === 'missing-field')).toEqual([]);
  });
});

describe('stale and verified', () => {
  const finish: Record[] = [
    { event: 'start', state: 'working', at: '2026-11-10T09:00:00Z' },
    { event: 'submit', state: 'review', at: '2026-11-10T09:10:00Z', extra: 'evidence:\n  - diff: src/run.ts\n' },
    { event: 'merge', state: 'implemented', at: '2026-11-10T09:20:00Z', extra: `evidence:\n  - commit: "${COMMIT}"\n` },
  ];

  it('shows an implemented page as stale once its sources changed after sourceRevision', async () => {
    const changed = cachedHistory(async () => new Set(['src/run.ts']));
    const unchanged = cachedHistory(async () => new Set(['README.md']));
    const options = { tasks: [], page: { sourceRevision: COMMIT } };
    const stale = await load([accept, ...finish], options, { history: changed });
    expect(stale.documents.get('run')?.work).toMatchObject({ recorded: 'implemented', summary: { state: 'stale' } });
    const fresh = await load([accept, ...finish], options, { history: unchanged });
    expect(fresh.documents.get('run')?.summary.work?.state).toBe('implemented');
    // Open work is never stale: only finished work can go out of date.
    const open = await load([accept], options, { history: changed });
    expect(open.documents.get('run')?.summary.work?.state).toBe('planned');
  });

  it('verifies only a page whose saved check is fresh and names the page commit', async () => {
    const verify: Record = { event: 'verify', state: 'verified', at: '2026-11-10T09:30:00Z' };
    const catalog = await load([accept, ...finish, verify], { tasks: [], page: { sourceRevision: COMMIT } });
    expect(catalog.issues.find((issue) => issue.code === 'refused-record')?.message).toBe('"verify" refused: only a page with a model can be verified');
    void OTHER;
  });

  it('matches source files and folders, ignoring fragments', () => {
    expect(touches(new Set(['src/run.ts']), ['src/run.ts#L10'])).toBe(true);
    expect(touches(new Set(['src/run/a.ts']), ['src/run/'])).toBe(true);
    expect(touches(new Set(['src/runner.ts']), ['src/run'])).toBe(false);
  });
});

describe('the work config', () => {
  it('reads people, quietAfter and extra requirements, and refuses new events', () => {
    const outcome = parseProjectConfig('work:\n  people: [saurav, saurav]\n  quietAfter: 30m\n  require:\n    merge: [check]\n    pause: [reason]\n');
    expect(outcome.config.work).toEqual({ people: ['saurav'], quietAfterMs: 30 * 60_000, require: { merge: ['check'] } });
    expect(outcome.problems.map((problem) => problem.message)).toEqual([expect.stringMatching(/"pause" is not a lifecycle event/)]);
    expect(parseProjectConfig('work:\n  quietAfter: soon\n').problems[0]?.message).toMatch(/duration/);
  });
});
