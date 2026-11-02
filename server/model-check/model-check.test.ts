import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BROKEN_RULE_LIMITS, type BrokenRule, type ModelCheckRecord } from '../../shared/model-check.js';
import { loadCatalog } from '../catalog.js';
import { parseDocumentFile } from '../document.js';
import { doc, REPO, STATE } from '../testing/documents.js';
import { memoryFiles } from '../testing/memory-files.js';
import { createCheckerCache, tlcCacheDirectory, type Downloader } from './cache.js';
import { TLA_JAR } from './pins.js';
import { ruleNames, withoutRule } from './config.js';
import type { DownloadPin } from './pins.js';
import { withModelCheck } from './record.js';
import { checkSpec, type CommandResult, type CommandRunner } from './run.js';
import { createModelCheckService } from './service.js';
import { PATH_OMITTED, plainPath, SHORTENED_MARK, type TraceStep } from './trace.js';
import { nodeRepositoryFiles } from '../files.js';

const SPEC = `---- MODULE Attachment ----
VARIABLES phase
Init == phase = "Open"
Next == phase = "Open" /\\ phase' = "Closed"
NoWriteAfterClose == phase = "Open"
====
`;
const CONFIG = 'SPECIFICATION Spec\nINVARIANT NoWriteAfterClose OnlyOpenOrClosed\n';

function passedReport(states = 2): string {
  return [
    '@!@!@STARTMSG 2193:0 @!@!@',
    'Model checking completed. No error has been found.',
    '@!@!@ENDMSG 2193 @!@!@',
    '@!@!@STARTMSG 2200:0 @!@!@',
    `Progress(1) at 2026-11-02 00:00:00: ${states} states generated, ${states} distinct states found, 0 states left on queue.`,
    '@!@!@ENDMSG 2200 @!@!@',
  ].join('\n');
}

function brokenReport(): string {
  return [
    '@!@!@STARTMSG 2110:1 @!@!@',
    'Invariant NoWriteAfterClose is violated.',
    '@!@!@ENDMSG 2110 @!@!@',
    '@!@!@STARTMSG 2217:4 @!@!@',
    '1: <Initial predicate>',
    'phase = "Open"',
    '@!@!@ENDMSG 2217 @!@!@',
    '@!@!@STARTMSG 2217:4 @!@!@',
    '2: <Close line 4, col 1 to line 6, col 20 of module Attachment>',
    'phase = "Closed"',
    '@!@!@ENDMSG 2217 @!@!@',
    '@!@!@STARTMSG 2200:0 @!@!@',
    'Progress(2) at 2026-11-02 00:00:00: 2 states generated, 2 distinct states found, 0 states left on queue.',
    '@!@!@ENDMSG 2200 @!@!@',
  ].join('\n');
}

function runner(behavior: (config: string, signal: AbortSignal, onOutput: (chunk: string) => void) => Promise<CommandResult>): CommandRunner {
  return {
    async run(_command, _args, options) {
      const names = (await import('node:fs/promises')).readdir(options.cwd);
      const files = await names;
      const cfgName = files.find((name) => name.endsWith('.cfg'));
      const config = cfgName ? await readFile(join(options.cwd, cfgName), 'utf8') : '';
      return behavior(config, options.signal, options.onOutput);
    },
  };
}

describe('TLC config rules', () => {
  it('lists invariants and properties and removes one name', () => {
    const config = 'SPECIFICATION Spec\nINVARIANT Alpha Beta\nPROPERTY Eventually\nCONSTANTS N = 1\n';
    expect(ruleNames(config)).toEqual(['Alpha', 'Beta', 'Eventually']);
    expect(ruleNames(withoutRule(config, 'Alpha'))).toEqual(['Beta', 'Eventually']);
    expect(withoutRule(config, 'Alpha')).toContain('CONSTANTS N = 1');
  });

  it.each(['INVARIANTS', 'PROPERTIES'])('keeps the %s header when a later line still names a rule', (keyword) => {
    const config = `${keyword} Alpha\n  Beta\n`;
    expect(withoutRule(config, 'Alpha')).toBe(`${keyword}\n  Beta\n`);
    expect(ruleNames(withoutRule(config, 'Alpha'))).toEqual(['Beta']);
    expect(withoutRule(`${keyword} Alpha \\* keep\n  Beta\n`, 'Alpha')).toBe(`${keyword} \\* keep\n  Beta\n`);
    expect(withoutRule(`${keyword} Alpha\n  Beta\n`, 'Beta')).toBe(`${keyword} Alpha\n`);
  });

  it.each(['INVARIANTS', 'PROPERTIES'])('drops the %s header only when its list is empty', (keyword) => {
    expect(withoutRule(`${keyword} Alpha\n`, 'Alpha')).toBe('');
    expect(ruleNames(withoutRule(`${keyword}\n  Alpha\n`, 'Alpha'))).toEqual([]);
    expect(withoutRule(`${keyword}\n  Alpha\n`, 'Alpha')).not.toContain(keyword);
    expect(withoutRule(`${keyword} Alpha \\* keep\n`, 'Alpha')).toBe('\\* keep\n');
    const nextSection = keyword.startsWith('INVARIANT') ? 'PROPERTY' : 'INVARIANT';
    expect(withoutRule(`${keyword} Alpha\n${nextSection} Gamma\n`, 'Alpha')).toBe(`${nextSection} Gamma\n`);
    expect(ruleNames(withoutRule(`${keyword} Alpha\n${nextSection} Gamma\nCONSTANTS N = 1\n`, 'Alpha'))).toEqual(['Gamma']);
  });
});

describe('checkSpec', () => {
  const base = { spec: SPEC, config: CONFIG, steps: { Init: 'Start with the attachment open.', Close: 'Close the attachment.' }, nodeIds: ['Open', 'Closed'], java: 'java', jar: 'tla2tools.jar' };

  it('holds every rule when TLC finishes cleanly', async () => {
    const result = await checkSpec({
      ...base,
      signal: new AbortController().signal,
      run: runner(async (_config, _signal, onOutput) => {
        onOutput(passedReport());
        return { code: 0, signal: null, stdout: passedReport(), stderr: '' };
      }),
    });
    expect(result).toMatchObject({ state: 'passed', findings: { held: ['NoWriteAfterClose', 'OnlyOpenOrClosed'], broke: [], unchecked: [] } });
  });

  it('records a broken rule and holds the rule that remains', async () => {
    const result = await checkSpec({
      ...base,
      signal: new AbortController().signal,
      run: runner(async (config, _signal, onOutput) => {
        const report = config.includes('NoWriteAfterClose') ? brokenReport() : passedReport();
        onOutput(report);
        return { code: config.includes('NoWriteAfterClose') ? 1 : 0, signal: null, stdout: report, stderr: '' };
      }),
    });
    expect(result.state).toBe('broke');
    if (result.state !== 'broke') return;
    expect(result.findings.held).toEqual(['OnlyOpenOrClosed']);
    expect(result.findings.broke[0]).toMatchObject({
      rule: 'NoWriteAfterClose',
      path: ['Start with the attachment open.', 'Close the attachment.'],
      states: ['Closed'],
    });
    expect(result.findings.unchecked).toEqual([]);
  });

  it('reports the remaining rules as not checked when the state cap is hit', async () => {
    const result = await checkSpec({
      ...base,
      limits: { maxDistinctStates: 10, timeoutMs: 5_000 },
      signal: new AbortController().signal,
      run: runner(async (_config, signal, onOutput) => {
        onOutput('Progress(9) at 2026-11-02 00:00:00: 40 states generated, 30 distinct states found, 1 states left on queue.\n');
        if (signal.aborted) return { code: null, signal: 'SIGKILL', stdout: '', stderr: '' };
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        return { code: null, signal: 'SIGKILL', stdout: '', stderr: '' };
      }),
    });
    expect(result).toMatchObject({ state: 'not-checked', findings: { held: [], broke: [], unchecked: ['NoWriteAfterClose', 'OnlyOpenOrClosed'] } });
  });

  it.each(['INVARIANTS', 'PROPERTIES'])('checks the rule on the next line after a broken %s name', async (keyword) => {
    const seen: string[] = [];
    const result = await checkSpec({
      ...base,
      config: `SPECIFICATION Spec\n${keyword} NoWriteAfterClose\n  OnlyOpenOrClosed\n`,
      signal: new AbortController().signal,
      run: runner(async (config, _signal, onOutput) => {
        seen.push(config);
        const listed = ruleNames(config);
        if (listed.length === 0 || !/^(?:INVARIANT|INVARIANTS|PROPERTY|PROPERTIES)\b/m.test(config)) {
          const report = 'Error: The configuration file is not correct.';
          onOutput(report);
          return { code: 1, signal: null, stdout: report, stderr: '' };
        }
        const report = config.includes('NoWriteAfterClose') ? brokenReport() : passedReport();
        onOutput(report);
        return { code: config.includes('NoWriteAfterClose') ? 1 : 0, signal: null, stdout: report, stderr: '' };
      }),
    });
    expect(result.state).toBe('broke');
    if (result.state !== 'broke') return;
    expect(result.findings.broke.map((item) => item.rule)).toEqual(['NoWriteAfterClose']);
    expect(result.findings.held).toEqual(['OnlyOpenOrClosed']);
    expect(result.findings.unchecked).toEqual([]);
    expect(seen[1]).toMatch(new RegExp(`^${keyword}\\b`, 'm'));
    expect(seen[1]).toContain('OnlyOpenOrClosed');
    expect(seen[1]).not.toContain('NoWriteAfterClose');
  });

  it('cancels without a result', async () => {
    const signal = new AbortController();
    const pending = checkSpec({
      ...base,
      signal: signal.signal,
      run: runner(async (_config, child) => new Promise((resolve) => {
        child.addEventListener('abort', () => resolve({ code: null, signal: 'SIGKILL', stdout: '', stderr: '' }));
      })),
    });
    signal.abort();
    await expect(pending).resolves.toMatchObject({ state: 'cancelled' });
  });
});

describe('saved traces stay inside the page limits', () => {
  const record = (broke: BrokenRule): ModelCheckRecord => ({
    checker: 'tlc-1.7.4',
    date: '2026-11-02T08:12:00.000Z',
    config: 'tla/attachment.cfg',
    modelDigest: 'b'.repeat(64),
    states: 31,
    held: ['OnlyOpenOrClosed'],
    broke: [broke],
    unchecked: [],
  });

  it('saves a trace longer than the path limit and the page stays in the catalog', async () => {
    const steps: TraceStep[] = Array.from({ length: BROKEN_RULE_LIMITS.path + 1 }, (_, index) => ({
      action: `Step${index}`,
      assignments: [`phase = "${index === BROKEN_RULE_LIMITS.path ? 'Closed' : 'Open'}"`],
    }));
    const fitting = plainPath(steps.slice(0, BROKEN_RULE_LIMITS.path), {});
    expect(fitting).toHaveLength(BROKEN_RULE_LIMITS.path);
    expect(fitting.at(-1)).not.toBe(PATH_OMITTED);

    const result = await checkSpec({
      spec: SPEC,
      config: CONFIG,
      steps: {},
      nodeIds: ['Open', 'Closed'],
      java: 'java',
      jar: 'tla2tools.jar',
      signal: new AbortController().signal,
      run: runner(async (config, _signal, onOutput) => {
        const report = config.includes('NoWriteAfterClose') ? violationReport(steps) : passedReport();
        onOutput(report);
        return { code: config.includes('NoWriteAfterClose') ? 1 : 0, signal: null, stdout: report, stderr: '' };
      }),
    });
    expect(result.state).toBe('broke');
    if (result.state !== 'broke') return;
    const broken = result.findings.broke[0];
    expect(broken?.path).toHaveLength(BROKEN_RULE_LIMITS.path);
    expect(broken?.path.at(-1)).toBe(PATH_OMITTED);
    expect(broken?.path[0]).toContain('Step0');
    expect(broken?.path[BROKEN_RULE_LIMITS.path - 2]).toContain(`Step${BROKEN_RULE_LIMITS.path - 2}`);
    expect(broken?.path.some((step) => step.includes(`Step${BROKEN_RULE_LIMITS.path - 1}`) || step.includes(`Step${BROKEN_RULE_LIMITS.path}`))).toBe(false);
    expect(broken?.states).toEqual(['Closed']);
    expect(broken?.path.every((step) => step.length <= BROKEN_RULE_LIMITS.sentence && !/[\r\n]/.test(step))).toBe(true);
    if (!broken) return;
    await expectSavedPage(record(broken));
  });

  it('saves an assignment longer than the sentence limit and the page stays in the catalog', async () => {
    const value = 'x'.repeat(BROKEN_RULE_LIMITS.sentence + 1);
    const exact = 'A'.repeat(BROKEN_RULE_LIMITS.sentence);
    expect(plainPath([{ action: 'Close', assignments: [] }], { Close: exact })).toEqual([exact]);

    const result = await checkSpec({
      spec: SPEC,
      config: CONFIG,
      steps: {},
      nodeIds: ['Open', 'Closed'],
      java: 'java',
      jar: 'tla2tools.jar',
      signal: new AbortController().signal,
      run: runner(async (config, _signal, onOutput) => {
        const report = config.includes('NoWriteAfterClose')
          ? violationReport([{ action: 'Next', assignments: [`phase = "${value}"`] }])
          : passedReport();
        onOutput(report);
        return { code: config.includes('NoWriteAfterClose') ? 1 : 0, signal: null, stdout: report, stderr: '' };
      }),
    });
    expect(result.state).toBe('broke');
    if (result.state !== 'broke') return;
    const broken = result.findings.broke[0];
    expect(broken?.path).toHaveLength(1);
    expect(broken?.path[0]).toMatch(/^Next: phase is x/);
    expect(broken?.path[0]?.endsWith(SHORTENED_MARK)).toBe(true);
    expect(broken?.path[0]?.length).toBe(BROKEN_RULE_LIMITS.sentence);
    if (!broken) return;
    await expectSavedPage(record(broken));
  });

  it('rejects a path the shared limits do not allow', () => {
    const page = doc('attachment', 'nessa', { model: { spec: 'tla/attachment.tla', config: 'tla/attachment.cfg', steps: {} } }, '# Attachment\n');
    const over = withModelCheck(page, record({
      rule: 'NoWriteAfterClose',
      path: Array.from({ length: BROKEN_RULE_LIMITS.path + 1 }, () => 'Step.'),
      states: [],
    }));
    expect(parseDocumentFile(over).kind).toBe('rejected');
    const longSentence = withModelCheck(page, record({
      rule: 'NoWriteAfterClose',
      path: ['x'.repeat(BROKEN_RULE_LIMITS.sentence + 1)],
      states: [],
    }));
    expect(parseDocumentFile(longSentence).kind).toBe('rejected');
    const atLimit = withModelCheck(page, record({
      rule: 'NoWriteAfterClose',
      path: Array.from({ length: BROKEN_RULE_LIMITS.path }, () => 'x'.repeat(BROKEN_RULE_LIMITS.sentence)),
      states: [],
    }));
    expect(parseDocumentFile(atLimit).kind).toBe('parsed');
  });
});

async function expectSavedPage(saved: ModelCheckRecord) {
  const page = doc('attachment', 'nessa', {
    kind: 'statechart',
    model: { spec: 'tla/attachment.tla', config: 'tla/attachment.cfg', steps: {} },
  }, '# Attachment\n\n```mermaid\nstateDiagram-v2\n  [*] --> Open\n```\n');
  const markdown = withModelCheck(page, saved);
  const parsed = parseDocumentFile(markdown);
  expect(parsed.kind).toBe('parsed');
  if (parsed.kind !== 'parsed') return;
  expect(parsed.document.modelCheck?.broke[0]?.path).toEqual([...saved.broke[0]?.path ?? []]);
  const catalog = await loadCatalog(memoryFiles({
    [`${STATE}/README.md`]: doc('nessa', null),
    [`${STATE}/attachment.md`]: markdown,
    [`${STATE}/tla/attachment.tla`]: SPEC,
    [`${STATE}/tla/attachment.cfg`]: CONFIG,
  }), REPO);
  expect(catalog.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  expect(catalog.documents.has('attachment')).toBe(true);
  expect(catalog.documents.get('attachment')?.summary.modelCheck?.broke[0]?.path).toEqual([...saved.broke[0]?.path ?? []]);
}

function violationReport(states: readonly TraceStep[]): string {
  const chunks = [
    '@!@!@STARTMSG 2110:1 @!@!@',
    'Invariant NoWriteAfterClose is violated.',
    '@!@!@ENDMSG 2110 @!@!@',
  ];
  states.forEach((state, index) => {
    chunks.push(
      '@!@!@STARTMSG 2217:4 @!@!@',
      `${index + 1}: <${state.action} line 1, col 1 to line 1, col 2 of module Attachment>`,
      ...state.assignments,
      '@!@!@ENDMSG 2217 @!@!@',
    );
  });
  return chunks.join('\n');
}

describe('modelCheck frontmatter', () => {
  it('adds the result and leaves the other fields', () => {
    const page = doc('attachment', 'nessa', { model: { spec: 'tla/attachment.tla', config: 'tla/attachment.cfg', steps: {} } }, '# Attachment\n');
    const next = withModelCheck(page, {
      sourceRevision: 'a'.repeat(40),
      checker: 'tlc-1.7.4',
      date: '2026-11-02T08:12:00.000Z',
      config: 'tla/attachment.cfg',
      modelDigest: 'b'.repeat(64),
      states: 4,
      held: ['OnlyOpenOrClosed'],
      broke: [{ rule: 'NoWriteAfterClose', path: ['Close the attachment.'], states: ['Closed'] }],
      unchecked: [],
    });
    expect(next).toContain('id: "attachment"');
    expect(next).toContain('OnlyOpenOrClosed');
    expect(next).toContain(`sourceRevision: "${'a'.repeat(40)}"`);
    expect(next).toContain('# Attachment');
  });
});

describe('checker cache', () => {
  it('uses the platform cache path and the override', () => {
    expect(tlcCacheDirectory({ platform: 'darwin', home: '/Users/ada', env: {} })).toBe('/Users/ada/Library/Caches/nessa-docs/tlc/1.7.4');
    expect(tlcCacheDirectory({ platform: 'linux', home: '/home/ada', env: {} })).toBe('/home/ada/.cache/nessa-docs/tlc/1.7.4');
    expect(tlcCacheDirectory({ platform: 'linux', home: '/home/ada', env: { XDG_CACHE_HOME: '/xdg' } })).toBe('/xdg/nessa-docs/tlc/1.7.4');
    expect(tlcCacheDirectory({ platform: 'win32', home: '/Users/ada', env: { LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local' } })).toContain('nessa-docs');
    expect(tlcCacheDirectory({ platform: 'linux', home: '/home/ada', env: { NESSA_DOCS_TLC_HOME: '/custom/tlc' } })).toBe('/custom/tlc/1.7.4');
  });

  it('reuses a verified cache, refuses a checksum mismatch, and stays uninstalled offline', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nessa-tlc-'));
    const java = archiveJava();
    const jarBytes = new TextEncoder().encode('not-a-real-jar');
    const pins = { jar: pin('jar', jarBytes), java: pin('tar.gz', java.bytes) };
    let fetches = 0;
    const download: Downloader = async (url) => {
      fetches += 1;
      if (url.endsWith('/mismatch')) return { ok: true, status: 200, body: new Uint8Array([1, 2, 3]) };
      return { ok: true, status: 200, body: url.includes('jre') ? java.bytes : jarBytes };
    };
    const urls = { ...pins, jar: { ...pins.jar, url: 'https://example.test/tlc.jar' }, java: { ...pins.java, url: 'https://example.test/jre.tar.gz' } };
    const cache = createCheckerCache({ directory, download, pins: urls });
    expect((await cache.install(new AbortController().signal)).state).toBe('ready');
    const fetched = fetches;
    const again = createCheckerCache({ directory, download: async () => { throw new Error('offline'); }, pins: urls });
    expect((await again.status()).state).toBe('ready');
    expect((await again.install(new AbortController().signal)).state).toBe('ready');
    expect(fetches).toBe(fetched);

    const bad = createCheckerCache({
      directory: mkdtempSync(join(tmpdir(), 'nessa-tlc-bad-')),
      download: async () => ({ ok: true, status: 200, body: new Uint8Array([9]) }),
      pins: urls,
    });
    const mismatch = await bad.install(new AbortController().signal);
    expect(mismatch.state).toBe('not-installed');
    expect(mismatch.message).toMatch(/checksum/i);
    expect(await bad.runtime()).toBeNull();

    const offline = createCheckerCache({
      directory: mkdtempSync(join(tmpdir(), 'nessa-tlc-off-')),
      download: async () => { throw new Error('offline'); },
      pins: urls,
    });
    const missed = await offline.install(new AbortController().signal);
    expect(missed.state).toBe('not-installed');
    expect(missed.message).toMatch(/network is unavailable/i);
    expect(await offline.runtime()).toBeNull();
  });
});

describe('catalog model links', () => {
  const page = (extra: Record<string, unknown> = {}) => doc('attachment', 'nessa', { kind: 'statechart', ...extra }, '# Attachment\n\n```mermaid\nstateDiagram-v2\n  [*] --> Open\n```\n');

  it('accepts a linked model and rejects a missing or shared one', async () => {
    const tree: Record<string, string> = {
      [`${STATE}/README.md`]: doc('nessa', null),
      [`${STATE}/attachment.md`]: page({ model: { spec: 'tla/attachment.tla', config: 'tla/attachment.cfg', steps: { Init: 'Start.' } } }),
      [`${STATE}/tla/attachment.tla`]: SPEC,
      [`${STATE}/tla/attachment.cfg`]: CONFIG,
    };
    const catalog = await loadCatalog(memoryFiles(tree), REPO);
    expect(catalog.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(catalog.documents.get('attachment')?.summary.model?.spec).toBe('tla/attachment.tla');

    const withoutCfg = { ...tree };
    delete withoutCfg[`${STATE}/tla/attachment.cfg`];
    const missingCatalog = await loadCatalog(memoryFiles(withoutCfg), REPO);
    expect(missingCatalog.issues.some((issue) => issue.code === 'missing-model-file')).toBe(true);
    expect(missingCatalog.documents.has('attachment')).toBe(false);

    const shared = {
      ...tree,
      [`${STATE}/other.md`]: doc('other', 'nessa', { model: { spec: 'tla/attachment.tla', config: 'tla/other.cfg', steps: {} } }),
      [`${STATE}/tla/other.cfg`]: CONFIG,
    };
    const sharedCatalog = await loadCatalog(memoryFiles(shared), REPO);
    expect(sharedCatalog.issues.filter((issue) => issue.code === 'duplicate-model').map((issue) => issue.file).sort()).toEqual([
      'docs/state/attachment.md',
      'docs/state/other.md',
    ]);
  });
});

describe('the check service', () => {
  it('writes a finished pass and does not write a cancellation or a missing checker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nessa-project-'));
    const state = join(root, 'docs/state');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(state, 'tla'), { recursive: true });
    const revision = 'c'.repeat(40);
    const page = doc('attachment', 'root', {
      kind: 'statechart',
      sourceRevision: revision,
      model: { spec: 'tla/attachment.tla', config: 'tla/attachment.cfg', steps: { Init: 'Start.' } },
    }, '# Attachment\n');
    await writeFile(join(state, 'README.md'), doc('root', null));
    await writeFile(join(state, 'attachment.md'), page);
    await writeFile(join(state, 'tla/attachment.tla'), SPEC);
    await writeFile(join(state, 'tla/attachment.cfg'), CONFIG);
    const files = nodeRepositoryFiles();
    const ready = { state: 'ready' as const, version: 'tlc-1.7.4', cachePath: '/cache/1.7.4' };
    const service = createModelCheckService({
      files,
      loadCatalog: (project) => loadCatalog(files, project),
      runtime: async () => ({ java: 'java', jar: 'tla2tools.jar' }),
      status: async () => ready,
      install: async () => ready,
      now: () => new Date('2026-11-02T08:12:00.000Z'),
      gitHead: async () => null,
      run: runner(async (_config, _signal, onOutput) => {
        onOutput(passedReport());
        return { code: 0, signal: null, stdout: passedReport(), stderr: '' };
      }),
    });
    const started = await service.start(root, 'attachment');
    const view = await finished(service, started.id);
    expect(view.state).toBe('passed');
    const saved = await readFile(join(state, 'attachment.md'), 'utf8');
    expect(saved).toContain('checker: tlc-1.7.4');
    expect(saved).toContain(`sourceRevision: "${revision}"`);
    expect(saved).toContain('NoWriteAfterClose');

    const missing = createModelCheckService({
      files,
      loadCatalog: (project) => loadCatalog(files, project),
      runtime: async () => null,
      status: async () => ({ state: 'not-installed', version: 'tlc-1.7.4', cachePath: '/cache/1.7.4', message: 'The rule checker is not installed.' }),
      install: async () => ({ state: 'not-installed', version: 'tlc-1.7.4', cachePath: '/cache/1.7.4' }),
    });
    const before = await readFile(join(state, 'attachment.md'), 'utf8');
    await expect(missing.start(root, 'attachment')).resolves.toMatchObject({ state: 'not-installed' });
    expect(await readFile(join(state, 'attachment.md'), 'utf8')).toBe(before);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const cancelling = createModelCheckService({
      files,
      loadCatalog: (project) => loadCatalog(files, project),
      runtime: async () => ({ java: 'java', jar: 'tla2tools.jar' }),
      status: async () => ready,
      install: async () => ready,
      run: runner(async (_config, signal) => {
        await gate;
        if (signal.aborted) return { code: null, signal: 'SIGKILL', stdout: '', stderr: '' };
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        return { code: null, signal: 'SIGKILL', stdout: '', stderr: '' };
      }),
    });
    const running = await cancelling.start(root, 'attachment');
    expect(cancelling.cancel(running.id)?.state).toBe('cancelled');
    release();
    await finished(cancelling, running.id);
    expect(await readFile(join(state, 'attachment.md'), 'utf8')).toBe(before);
    await rm(root, { recursive: true, force: true });
  });
});

async function finished(service: ReturnType<typeof createModelCheckService>, id: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const view = service.read(id);
    if (view && view.state !== 'running' && view.state !== 'downloading') return view;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for the check');
}

describe('attachment model under TLC', () => {
  it('passes, and removing the write guard breaks NoWriteAfterClose', async () => {
    const jar = await pinnedJar();
    const spec = readFileSync(new URL('../../examples/store/docs/state/tla/services/sdk/attachment.tla', import.meta.url), 'utf8');
    const config = readFileSync(new URL('../../examples/store/docs/state/tla/services/sdk/attachment.cfg', import.meta.url), 'utf8');
    const steps = {
      Init: 'Start with the attachment open.',
      Close: 'Close the attachment.',
      Write: 'Write bytes.',
      Done: 'The attachment stays closed.',
    };
    const request = { spec, config, steps, nodeIds: ['Open', 'Closed'], java: 'java', jar, signal: new AbortController().signal };
    const passed = await checkSpec(request);
    expect(passed.state).toBe('passed');
    if (passed.state === 'passed') expect(passed.findings.held).toEqual(['NoWriteAfterClose', 'OnlyOpenOrClosed']);

    const unguarded = spec.replace('    /\\ phase = "Open" \\* guard: writing requires the attachment to be open\n', '');
    const broke = await checkSpec({ ...request, spec: unguarded, signal: new AbortController().signal });
    expect(broke.state).toBe('broke');
    if (broke.state !== 'broke') return;
    expect(broke.findings.broke.map((item) => item.rule)).toContain('NoWriteAfterClose');
    expect(broke.findings.broke.find((item) => item.rule === 'NoWriteAfterClose')).toMatchObject({
      path: ['Start with the attachment open.', 'Close the attachment.', 'Write bytes.'],
      states: ['Closed'],
    });
    expect(broke.findings.held).toContain('OnlyOpenOrClosed');
    expect(broke.findings.unchecked).toEqual([]);
  }, 120_000);
});

async function pinnedJar(): Promise<string> {
  const dest = join(tmpdir(), 'nessa-docs-tla2tools-1.7.4.jar');
  try {
    const existing = await readFile(dest);
    if (createHash('sha256').update(existing).digest('hex') === TLA_JAR.sha256) return dest;
  } catch { /* download the pinned jar */ }
  const response = await fetch(TLA_JAR.url);
  if (!response.ok) throw new Error(`TLC download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== TLA_JAR.sha256) throw new Error('TLC jar checksum did not match the pin.');
  await writeFile(dest, bytes);
  return dest;
}

function pin(format: DownloadPin['format'], bytes: Uint8Array): DownloadPin {
  return { url: 'https://example.test/file', sha256: createHash('sha256').update(bytes).digest('hex'), format };
}

function archiveJava(): { bytes: Uint8Array } {
  const dir = mkdtempSync(join(tmpdir(), 'jre-src-'));
  mkdirSync(join(dir, 'demo', 'bin'), { recursive: true });
  writeFileSync(join(dir, 'demo', 'bin', 'java'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'demo', 'bin', 'java'), 0o755);
  const archive = `${dir}.tar.gz`;
  execFileSync('tar', ['-czf', archive, '-C', dir, 'demo']);
  return { bytes: new Uint8Array(readFileSync(archive)) };
}
