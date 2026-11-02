// The app and MCP share this service: install status, one check at a time per
// page, and a saved modelCheck only after a finished run.

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { CHECKER_ID, type CheckerStatus, type ModelCheckRecord, type ModelCheckRunView } from '../../shared/model-check.js';
import type { Catalog } from '../catalog.js';
import type { RepositoryFiles } from '../files.js';
import { checkSpec, type CommandRunner } from './run.js';
import { modelDigest, writeModelCheckFile } from './record.js';
import { diagramNodeIds } from './nodes.js';
import { posix } from 'node:path';

const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export interface ModelCheckService {
  status(): Promise<CheckerStatus>;
  install(signal: AbortSignal): Promise<CheckerStatus>;
  start(projectRoot: string, documentId: string): Promise<ModelCheckRunView>;
  read(runId: string): ModelCheckRunView | null;
  cancel(runId: string): ModelCheckRunView | null;
  /** Spec and config text, with no project write. Used by MCP when the caller passes the model directly. */
  checkText(input: { spec: string; config: string; steps: Readonly<Record<string, string>>; nodeIds: readonly string[]; sourceRevision?: string; configPath?: string }, signal: AbortSignal): Promise<ModelCheckRunView>;
}

export function createModelCheckService(options: {
  readonly files: RepositoryFiles;
  readonly loadCatalog: (root: string) => Promise<Catalog>;
  readonly runtime: () => Promise<{ java: string; jar: string } | null>;
  readonly status: () => Promise<CheckerStatus>;
  readonly install: (signal: AbortSignal) => Promise<CheckerStatus>;
  readonly run?: CommandRunner;
  readonly now?: () => Date;
  readonly gitHead?: (root: string) => Promise<string | null>;
  readonly write?: (projectRoot: string, relativeFile: string, record: ModelCheckRecord) => Promise<void>;
}): ModelCheckService {
  const runs = new Map<string, { view: ModelCheckRunView; abort?: AbortController }>();
  const now = options.now ?? (() => new Date());
  const gitHead = options.gitHead ?? repositoryHead;
  const write = options.write ?? writeModelCheckFile;

  const remember = (view: ModelCheckRunView, abort?: AbortController) => {
    runs.set(view.id, { view, abort });
    return view;
  };

  return {
    status: options.status,
    install: options.install,
    read(runId) { return runs.get(runId)?.view ?? null; },
    cancel(runId) {
      const run = runs.get(runId);
      if (!run) return null;
      run.abort?.abort();
      if (run.view.state === 'running' || run.view.state === 'downloading') {
        run.view = { ...run.view, state: 'cancelled', message: 'The rule check was cancelled. No rule was marked as held.' };
      }
      return run.view;
    },
    async start(projectRoot, documentId) {
      const catalog = await options.loadCatalog(projectRoot);
      const document = catalog.documents.get(documentId);
      if (!document?.summary.model || catalog.repoRoot === null) {
        return { id: '', state: 'failed', message: 'This page has no model, so nothing was checked.' };
      }
      const runtime = await options.runtime();
      if (!runtime) {
        const checker = await options.status();
        return {
          id: '',
          state: 'not-installed',
          message: checker.message ?? 'The rule checker is not installed. Install it to check this page. Nothing was marked as held.',
        };
      }
      const model = document.summary.model;
      const boundary = posix.join(catalog.repoRoot, 'docs/state');
      const specRead = await options.files.readText(posix.join(catalog.repoRoot, 'docs/state', model.spec), 1024 * 1024, boundary);
      const configRead = await options.files.readText(posix.join(catalog.repoRoot, 'docs/state', model.config), 1024 * 1024, boundary);
      if (specRead.kind !== 'text' || configRead.kind !== 'text') {
        return { id: '', state: 'failed', message: 'The linked model could not be read, so nothing was checked.' };
      }
      const sourceRevision = document.summary.sourceRevision ?? await gitHead(catalog.repoRoot) ?? undefined;
      const id = randomUUID();
      const abort = new AbortController();
      const view: ModelCheckRunView = { id, state: 'running', message: 'Checking rules…' };
      remember(view, abort);
      void finish({
        spec: specRead.text,
        config: configRead.text,
        steps: model.steps,
        nodeIds: diagramNodeIds(document.body),
        sourceRevision,
        configPath: model.config,
        save: (record) => write(catalog.repoRoot as string, document.summary.file, record),
      }, runtime, abort.signal, id);
      return view;
    },
    async checkText(input, signal) {
      const runtime = await options.runtime();
      if (!runtime) {
        const checker = await options.status();
        return { id: '', state: 'not-installed', message: checker.message ?? 'The rule checker is not installed. Nothing was marked as held.' };
      }
      const id = randomUUID();
      const view: ModelCheckRunView = { id, state: 'running', message: 'Checking rules…' };
      remember(view);
      await finish({
        spec: input.spec,
        config: input.config,
        steps: input.steps,
        nodeIds: input.nodeIds,
        sourceRevision: input.sourceRevision,
        configPath: input.configPath && /^tla(?:\/[A-Za-z0-9_-]+)*\/[A-Za-z0-9_-]+\.cfg$/.test(input.configPath) ? input.configPath : 'tla/inline.cfg',
      }, runtime, signal, id);
      return runs.get(id)?.view ?? view;
    },
  };

  async function finish(
    input: {
      spec: string;
      config: string;
      steps: Readonly<Record<string, string>>;
      nodeIds: readonly string[];
      sourceRevision?: string;
      configPath: string;
      save?: (record: ModelCheckRecord) => Promise<void>;
    },
    runtime: { java: string; jar: string },
    signal: AbortSignal,
    id: string,
  ): Promise<void> {
    const current = () => runs.get(id);
    const set = (view: ModelCheckRunView) => {
      const run = current();
      if (run) run.view = view;
    };
    if (signal.aborted) {
      set({ id, state: 'cancelled', message: 'The rule check was cancelled. No rule was marked as held.' });
      return;
    }
    const outcome = await checkSpec({
      spec: input.spec,
      config: input.config,
      steps: input.steps,
      nodeIds: input.nodeIds,
      java: runtime.java,
      jar: runtime.jar,
      signal,
      run: options.run,
      onProgress(message) {
        const run = current();
        if (run && run.view.state === 'running') run.view = { ...run.view, message };
      },
    });
    if (outcome.state === 'cancelled') {
      set({ id, state: 'cancelled', message: 'The rule check was cancelled. No rule was marked as held.' });
      return;
    }
    if (outcome.state === 'failed') {
      set({ id, state: 'failed', message: outcome.message });
      return;
    }
    const record: ModelCheckRecord = {
      ...(input.sourceRevision && COMMIT.test(input.sourceRevision) ? { sourceRevision: input.sourceRevision } : {}),
      checker: CHECKER_ID,
      date: now().toISOString(),
      config: input.configPath,
      modelDigest: modelDigest(input.spec, input.config),
      states: outcome.findings.states,
      held: outcome.findings.held,
      broke: outcome.findings.broke,
      unchecked: outcome.findings.unchecked,
      ...(outcome.findings.stop ? { stop: outcome.findings.stop } : {}),
    };
    try {
      await input.save?.(record);
    } catch (error) {
      set({ id, state: 'failed', message: error instanceof Error ? error.message : 'The result could not be saved.' });
      return;
    }
    const message = outcome.state === 'passed'
      ? 'Every rule held. This checks the design, not the code.'
      : outcome.state === 'broke'
        ? 'A rule broke. This checks the design, not the code.'
        : 'Some rules were not checked. They are not passes. This checks the design, not the code.';
    set({ id, state: outcome.state, message, result: record });
  }
}

function repositoryHead(root: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', root, 'rev-parse', 'HEAD'], { timeout: 5_000 }, (error, stdout) => {
      if (error) return resolve(null);
      const sha = stdout.trim();
      resolve(COMMIT.test(sha) ? sha : null);
    });
  });
}
