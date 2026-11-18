// Reads the nodes and edges of a chart details can bind to (a state diagram's
// states and transitions, or a flowchart's plain nodes and edges) with Mermaid's
// own parser and database, so the edge identity the server publishes is the one
// Mermaid draws in the browser: the `data-id` on the edge's path and label in
// the SVG. Nothing here re-implements Mermaid's grammar.
//
// Mermaid runs in a worker thread of its own (diagram-reader-worker.mjs), inside
// a jsdom window, because its label handling uses DOMPurify, which needs a DOM.
// This module owns that worker: started on the first read, one read at a time,
// each read bounded by READ_DEADLINE_MS; a worker that fails, exits or overruns
// is discarded and the next read starts a new one. The worker does not keep the
// process alive.

import { Worker } from 'node:worker_threads';
import type { DiagramFamily } from '../shared/api.js';

/** A state diagram's transition, or a flowchart's edge. */
export interface ChartEdge {
  /**
   * Mermaid's identity for the edge (its SVG `data-id`); null when it is not a
   * short word, so it is never published. Mermaid can give two elements the same
   * identity (flowchart `A_B --> C` and `A --> B_C`); `identities` shows it.
   */
  readonly element: string | null;
  readonly from: string;
  readonly to: string;
  /**
   * The label as a reader sees it, when it is plain text written as is; null when
   * the source writes it with Mermaid entity codes (`#quot;`), HTML or (in a
   * flowchart) a Markdown string, which are drawn differently from their source.
   */
  readonly label: string | null;
}

export type DiagramReading =
  | {
      readonly kind: 'chart';
      readonly family: DiagramFamily;
      /** State IDs (notes excluded), or flowchart node IDs (subgraphs excluded). */
      readonly nodes: ReadonlySet<string>;
      /** Every edge between two of those nodes, in Mermaid's order. */
      readonly edges: readonly ChartEdge[];
      /** Every identity Mermaid gave an element of the chart (subgraphs, notes and their edges too), repeats kept. */
      readonly identities: readonly string[];
    }
  | { readonly kind: 'unsupported'; readonly reason: string };

export type DiagramReader = (source: string) => Promise<DiagramReading>;

const WORKER_FILE = new URL('./diagram-reader-worker.mjs', import.meta.url);
const READ_DEADLINE_MS = 15_000;
const CACHE_LIMIT = 256;

let worker: Worker | null = null;
let queue: Promise<unknown> = Promise.resolve();
// Only Mermaid's own answers are kept; a failed or overrun worker is asked again next time.
const cache = new Map<string, DiagramReading>();

/** Mermaid's reading of one diagram source; the same source is read once per process (bounded cache). */
export const readDiagram: DiagramReader = (source) => {
  const cached = cache.get(source);
  if (cached) return Promise.resolve(cached);
  const job = queue.then(async () => {
    const { reading, answered } = await ask(source);
    if (answered) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(source, reading);
    }
    return reading;
  });
  queue = job.catch(() => undefined);
  return job;
};

function ask(source: string): Promise<{ reading: DiagramReading; answered: boolean }> {
  return new Promise((resolve) => {
    let current: Worker;
    try {
      current = worker ?? start();
    } catch (error) {
      resolve({ reading: unsupported(`the diagram reader could not start (${firstLine(error)})`), answered: false });
      return;
    }
    worker = current;
    const finish = (reading: DiagramReading, answered: boolean) => {
      clearTimeout(timer);
      current.off('message', onMessage);
      current.off('error', onError);
      current.off('exit', onExit);
      if (!answered) {
        if (worker === current) worker = null;
        void current.terminate();
      }
      resolve({ reading, answered });
    };
    const onMessage = (message: unknown) => {
      const reading = toReading(message);
      finish(reading ?? unsupported('the diagram reader answered in an unexpected shape'), reading !== null);
    };
    const onError = (error: unknown) => finish(unsupported(`the diagram reader failed (${firstLine(error)})`), false);
    const onExit = (code: number) => finish(unsupported(`the diagram reader stopped (exit code ${code})`), false);
    const timer = setTimeout(
      () => finish(unsupported(`Mermaid did not finish reading it within ${READ_DEADLINE_MS / 1000} s`), false),
      READ_DEADLINE_MS,
    );
    current.on('message', onMessage);
    current.on('error', onError);
    current.on('exit', onExit);
    current.postMessage({ source });
  });
}

function start(): Worker {
  const started = new Worker(WORKER_FILE);
  started.unref();
  return started;
}

/** The worker's answer, checked at this boundary; null if it is not a reading. */
export function toReading(message: unknown): DiagramReading | null {
  if (message === null || typeof message !== 'object') return null;
  const value = message as { kind?: unknown; reason?: unknown; family?: unknown; nodes?: unknown; edges?: unknown; identities?: unknown };
  if (value.kind === 'unsupported') return typeof value.reason === 'string' ? unsupported(value.reason) : null;
  if (value.kind !== 'chart' || (value.family !== 'state' && value.family !== 'flowchart')) return null;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.identities)) return null;
  if (!value.nodes.every((node): node is string => typeof node === 'string')) return null;
  if (!value.identities.every((id): id is string => typeof id === 'string')) return null;
  const edges: ChartEdge[] = [];
  for (const entry of value.edges as { element?: unknown; from?: unknown; to?: unknown; label?: unknown }[]) {
    const { element, from, to, label } = entry ?? {};
    if ((element !== null && typeof element !== 'string') || typeof from !== 'string' || typeof to !== 'string') return null;
    if (label !== null && typeof label !== 'string') return null;
    edges.push({ element, from, to, label });
  }
  return { kind: 'chart', family: value.family, nodes: new Set(value.nodes), edges, identities: value.identities };
}

function unsupported(reason: string): DiagramReading {
  return { kind: 'unsupported', reason };
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split('\n')[0] ?? '';
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}
