// One TLC run, then another for each broken rule, inside a temporary directory.
// A bound, a timeout, or cancellation leaves the remaining rules not checked.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { MODEL_CHECK_LIMITS, type RuleFindings } from '../../shared/model-check.js';
import { ruleNames, withoutRule } from './config.js';
import { brokenRule, distinctStates, tlcSucceeded } from './trace.js';

export interface CommandResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(
    command: string,
    args: readonly string[],
    options: { readonly cwd: string; readonly signal: AbortSignal; readonly onOutput: (chunk: string) => void },
  ): Promise<CommandResult>;
}

export interface CheckRequest {
  readonly spec: string;
  readonly config: string;
  readonly steps: Readonly<Record<string, string>>;
  readonly nodeIds: readonly string[];
  readonly java: string;
  readonly jar: string;
  readonly signal: AbortSignal;
  readonly onProgress?: (message: string) => void;
  readonly limits?: { readonly maxDistinctStates: number; readonly timeoutMs: number };
  readonly run?: CommandRunner;
}

export type CheckRunResult =
  | { readonly state: 'passed' | 'broke' | 'not-checked'; readonly findings: RuleFindings }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'cancelled' };

export async function checkSpec(request: CheckRequest): Promise<CheckRunResult> {
  const moduleName = /----\s*MODULE\s+([A-Za-z_][A-Za-z0-9_]*)\s*----/.exec(request.spec)?.[1];
  if (!moduleName) return { state: 'failed', message: 'The spec has no TLA+ module name, so it was not checked.' };
  const limits = request.limits ?? MODEL_CHECK_LIMITS;
  const run = request.run ?? nodeCommandRunner;
  const directory = await mkdtemp(join(tmpdir(), 'nessa-docs-tlc-'));
  try {
    const rules = [...new Set(ruleNames(request.config))];
    if (rules.length === 0) return { state: 'failed', message: 'The config names no INVARIANT or PROPERTY, so there is nothing to check.' };
    const held: string[] = [];
    const broke: RuleFindings['broke'][number][] = [];
    let config = request.config;
    let remaining = [...rules];
    let states = 0;
    let unfinished: 'not-checked' | null = null;
    for (let round = 0; round < rules.length && remaining.length > 0; round += 1) {
      if (request.signal.aborted) return { state: 'cancelled' };
      await writeFile(join(directory, `${moduleName}.tla`), request.spec);
      await writeFile(join(directory, `${moduleName}.cfg`), config);
      request.onProgress?.(`Checking ${remaining.length} rule${remaining.length === 1 ? '' : 's'}…`);
      const outcome = await runTlc(run, request, directory, moduleName, limits);
      if (outcome.kind === 'cancelled') return { state: 'cancelled' };
      if (outcome.kind === 'failed') return { state: 'failed', message: outcome.message };
      states = Math.max(states, outcome.states);
      if (outcome.kind === 'bound') {
        unfinished = 'not-checked';
        break;
      }
      if (outcome.kind === 'violation') {
        if (!remaining.includes(outcome.broken.rule) || broke.some((item) => item.rule === outcome.broken.rule)) {
          return { state: 'failed', message: `TLC reported ${outcome.broken.rule}, which this run is not still checking. No new result was saved.` };
        }
        broke.push(outcome.broken);
        remaining = remaining.filter((name) => name !== outcome.broken.rule);
        config = withoutRule(config, outcome.broken.rule);
        continue;
      }
      held.push(...remaining);
      remaining = [];
      break;
    }
    const unchecked = unfinished ? remaining : [];
    const findings = { states, held, broke, unchecked };
    if (broke.length > 0) return { state: 'broke', findings };
    if (unchecked.length > 0) return { state: 'not-checked', findings };
    return { state: 'passed', findings };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

type TlcOutcome =
  | { readonly kind: 'passed'; readonly states: number }
  | { readonly kind: 'violation'; readonly states: number; readonly broken: RuleFindings['broke'][number] }
  | { readonly kind: 'bound'; readonly states: number }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string };

async function runTlc(
  run: CommandRunner,
  request: CheckRequest,
  directory: string,
  moduleName: string,
  limits: { readonly maxDistinctStates: number; readonly timeoutMs: number },
): Promise<TlcOutcome> {
  const child = new AbortController();
  let reason: 'cancel' | 'cap' | 'timeout' | null = null;
  const stop = (why: 'cancel' | 'cap' | 'timeout') => {
    if (reason === null) reason = why;
    child.abort();
  };
  const onCancel = () => stop('cancel');
  if (request.signal.aborted) return { kind: 'cancelled' };
  request.signal.addEventListener('abort', onCancel, { once: true });
  const timer = setTimeout(() => stop('timeout'), limits.timeoutMs);
  let output = '';
  try {
    const result = await run.run(request.java, [
      '-XX:+UseParallelGC',
      '-cp', request.jar,
      'tlc2.TLC',
      '-workers', '1',
      '-tool',
      '-config', `${moduleName}.cfg`,
      moduleName,
    ], {
      cwd: directory,
      signal: child.signal,
      onOutput(chunk) {
        output = `${output}${chunk}`.slice(-2_000_000);
        const states = distinctStates(output);
        request.onProgress?.(`Checking rules… ${states} distinct states`);
        if (states > limits.maxDistinctStates) stop('cap');
      },
    });
    const states = distinctStates(output);
    const report = `${output}\n${result.stderr}`;
    if (reason === 'cancel') return { kind: 'cancelled' };
    if (reason === 'cap' || reason === 'timeout') return { kind: 'bound', states };
    if (tlcSucceeded(report)) return { kind: 'passed', states };
    const broken = brokenRule(report, request.steps, request.nodeIds);
    if (broken) return { kind: 'violation', states, broken };
    const detail = firstProblem(report);
    return { kind: 'failed', message: detail ?? 'TLC stopped without a result. No rule was marked as held.' };
  } catch (error) {
    if (reason === 'cancel' || request.signal.aborted) return { kind: 'cancelled' };
    const message = error instanceof Error ? error.message : 'TLC could not be started.';
    return { kind: 'failed', message };
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', onCancel);
  }
}

function firstProblem(output: string): string | null {
  const line = output.split(/\r?\n/).map((item) => item.trim()).find((item) => item.startsWith('Error:') || item.includes('***'));
  if (!line) return null;
  return line.slice(0, 500);
}

export const nodeCommandRunner: CommandRunner = {
  run(command, args, options) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: options.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const take = (which: 'stdout' | 'stderr') => (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        if (which === 'stdout') stdout += text;
        else stderr += text;
        options.onOutput(text);
      };
      child.stdout.on('data', take('stdout'));
      child.stderr.on('data', take('stderr'));
      const kill = () => {
        if (child.pid === undefined) return;
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      };
      const onAbort = () => kill();
      if (options.signal.aborted) kill();
      else options.signal.addEventListener('abort', onAbort, { once: true });
      child.on('error', (error) => {
        options.signal.removeEventListener('abort', onAbort);
        reject(error);
      });
      child.on('exit', (code, signal) => {
        options.signal.removeEventListener('abort', onAbort);
        resolve({ code, signal, stdout, stderr });
      });
    });
  },
};
