// Reads a TLC report, including the `-tool` message framing, into rules and paths.

import type { BrokenRule } from '../../shared/model-check.js';

export interface TraceStep {
  readonly action: string;
  readonly assignments: readonly string[];
}

const VIOLATION = /^(?:Error:\s+)?(?:Invariant|Property)\s+([A-Za-z_][A-Za-z0-9_]*)\s+is violated\b/;
const STATE_LINE = /^(?:State\s+)?(\d+):\s*<([^>]+)>/;

export function distinctStates(output: string): number {
  let max = 0;
  for (const match of output.matchAll(/(\d+)\s+distinct states found/g)) {
    max = Math.max(max, Number(match[1] ?? 0));
  }
  return max;
}

export function tlcSucceeded(output: string): boolean {
  return output.includes('Model checking completed. No error has been found.');
}

export function violatedRule(output: string): string | null {
  for (const body of messageBodies(output)) {
    const match = VIOLATION.exec(body.trim().split(/\r?\n/)[0] ?? '');
    if (match?.[1]) return match[1];
  }
  return null;
}

export function counterexample(output: string): TraceStep[] {
  const steps: TraceStep[] = [];
  for (const body of messageBodies(output)) {
    const lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
    const header = lines[0] ?? '';
    const match = STATE_LINE.exec(header);
    if (!match) continue;
    const label = match[2] ?? '';
    const action = label.startsWith('Initial predicate') ? 'Init' : (label.split(/\s+/)[0] ?? 'Next');
    const assignments = lines.slice(1).map((line) => line.replace(/^\/\\\s*/, ''));
    steps.push({ action, assignments });
  }
  return steps;
}

export function plainPath(steps: readonly TraceStep[], sentences: Readonly<Record<string, string>>): string[] {
  if (steps.length === 0) return ['The checker reported a break without a path.'];
  return steps.map((step) => {
    const sentence = sentences[step.action];
    if (sentence) return sentence;
    const values = step.assignments.map(plainAssignment).filter(Boolean);
    if (step.action === 'Init') return values.length > 0 ? `Start with ${values.join(', ')}.` : 'Start.';
    return values.length > 0 ? `${step.action}: ${values.join(', ')}.` : step.action;
  });
}

export function statesIn(step: TraceStep | undefined, nodeIds: readonly string[]): string[] {
  if (!step) return [];
  const known = new Set(nodeIds);
  const found = new Set<string>();
  for (const line of step.assignments) {
    for (const match of line.matchAll(/"([^"]+)"/g)) {
      const value = match[1];
      if (value && known.has(value)) found.add(value);
    }
    const bare = /=\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(line);
    if (bare?.[1] && known.has(bare[1])) found.add(bare[1]);
  }
  return [...found];
}

export function brokenRule(output: string, sentences: Readonly<Record<string, string>>, nodeIds: readonly string[]): BrokenRule | null {
  const rule = violatedRule(output);
  if (!rule) return null;
  const steps = counterexample(output);
  const last = steps[steps.length - 1];
  return { rule, path: plainPath(steps, sentences), states: statesIn(last, nodeIds) };
}

function plainAssignment(line: string): string {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line.trim());
  if (!match) return line.trim();
  const value = (match[2] ?? '').replace(/^"(.*)"$/, '$1').replace(/\s+$/, '');
  return `${match[1]} is ${value}`;
}

function messageBodies(output: string): string[] {
  const framed: string[] = [];
  const pattern = /@!@!@STARTMSG[^\n]*\n([\s\S]*?)\n@!@!@ENDMSG[^\n]*/g;
  for (const match of output.matchAll(pattern)) {
    if (match[1] !== undefined) framed.push(match[1]);
  }
  if (framed.length > 0) return framed;
  return output.split(/\n{2,}/);
}
