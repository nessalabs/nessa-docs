// Binds a document's `diagramDetails` entries to its charts and sections. An
// entry is published only when its chart (a state diagram or a flowchart), its
// element and its section are each found exactly once, and an edge's Mermaid
// identity names no other element of the chart; every other entry becomes a
// warning with the reason, and has no action in the browser (an unbound
// selector is never guessed).

import type { DiagramDetail, DiagramDetailTarget, DiagramFamily, IssueCode } from '../shared/api.js';
import { diagramFits, lexMarkdown, MERMAID_MAX_TEXT_SIZE, markdownDiagrams, markdownSections } from '../shared/markdown.js';
import type { AuthoredDiagramDetail, DetailSelector } from './document.js';
import type { DiagramReader, DiagramReading } from './diagram-reader.js';

export interface DetailProblem {
  readonly code: IssueCode;
  readonly message: string;
}

export interface DetailResolution {
  readonly details: readonly DiagramDetail[];
  readonly problems: readonly DetailProblem[];
}

export async function resolveDiagramDetails(
  entries: readonly AuthoredDiagramDetail[],
  body: string,
  read: DiagramReader,
): Promise<DetailResolution> {
  if (entries.length === 0) return { details: [], problems: [] };
  const tokens = lexMarkdown(body);
  const diagrams = markdownDiagrams(tokens);
  const sections = markdownSections(tokens);
  const details: DiagramDetail[] = [];
  const problems: DetailProblem[] = [];
  const problem = (code: IssueCode, entry: AuthoredDiagramDetail, index: number, reason: string) =>
    problems.push({ code, message: `diagramDetails[${index}] (diagram ${entry.diagram}, ${describe(entry.selector)}): ${reason}` });

  // The same element named twice: neither entry is bound, so the page never picks one.
  const count = new Map<string, number>();
  for (const entry of entries) count.set(selectorKey(entry), (count.get(selectorKey(entry)) ?? 0) + 1);

  const readings = new Map<number, Promise<DiagramReading>>();
  for (const [index, entry] of entries.entries()) {
    const repeats = count.get(selectorKey(entry)) ?? 0;
    if (repeats > 1) {
      problem('duplicate-detail-selector', entry, index, `this element is named by ${repeats} entries; name it once`);
      continue;
    }
    const diagram = diagrams[entry.diagram];
    if (diagram === undefined) {
      problem('unknown-detail-diagram', entry, index, `the document has ${diagrams.length} Mermaid diagram${diagrams.length === 1 ? '' : 's'} (counted from 0)`);
      continue;
    }
    const matching = sections.flatMap((section, at) => (section.title === entry.section ? [at] : []));
    if (matching.length !== 1) {
      problem(
        matching.length === 0 ? 'unknown-detail-section' : 'ambiguous-detail-section',
        entry,
        index,
        matching.length === 0
          ? `no heading reads exactly "${entry.section}"`
          : `${matching.length} headings read "${entry.section}"; a section heading must be unique`,
      );
      continue;
    }
    if (!diagramFits(diagram.source)) {
      problem(
        'unsupported-detail-diagram',
        entry,
        index,
        `diagram ${entry.diagram} cannot carry details: it is ${diagram.source.length.toLocaleString('en')} characters long, and charts over ${MERMAID_MAX_TEXT_SIZE.toLocaleString('en')} are not drawn`,
      );
      continue;
    }
    if (!readings.has(entry.diagram)) readings.set(entry.diagram, read(diagram.source));
    const reading = await (readings.get(entry.diagram) as Promise<DiagramReading>);
    if (reading.kind === 'unsupported') {
      problem('unsupported-detail-diagram', entry, index, `diagram ${entry.diagram} cannot carry details: ${reading.reason}`);
      continue;
    }
    const section = { title: entry.section, index: matching[0] as number };
    const found = findElement(reading, entry.selector);
    if (found.kind === 'missing') {
      problem(found.code, entry, index, found.reason);
      continue;
    }
    details.push({ diagram: entry.diagram, family: reading.family, target: found.target, section });
  }
  return { details, problems };
}

export type ElementSearch =
  | { readonly kind: 'found'; readonly target: DiagramDetailTarget }
  | { readonly kind: 'missing'; readonly code: IssueCode; readonly reason: string };

/**
 * The one chart element a selector names, as the browser will find it, or why
 * it cannot be named. Shared by `diagramDetails` and `work` anchors, so a
 * selector binds the same way wherever it is written.
 */
export function findElement(reading: Extract<DiagramReading, { kind: 'chart' }>, selector: DetailSelector): ElementSearch {
  const missing = (code: IssueCode, reason: string): ElementSearch => ({ kind: 'missing', code, reason });
  const { family } = reading;
  const { node: nodeNoun, edge: edgeNoun, edges: edgesNoun } = NOUNS[family];
  if (selector.kind === 'node') {
    if (!reading.nodes.has(selector.node)) return missing('unknown-detail-node', `the chart has no ${nodeNoun} "${selector.node}"`);
    return { kind: 'found', target: { kind: 'node', node: selector.node } };
  }
  const between = reading.edges.filter((edge) => edge.from === selector.from && edge.to === selector.to);
  const exact = between.filter((edge) => edge.label === selector.label);
  if (exact.length !== 1) {
    // Labels written with entity codes, HTML or Markdown are drawn differently from their source: never matched, never quoted.
    const plain = between.flatMap((edge) => (edge.label === null ? [] : [JSON.stringify(edge.label)]));
    const notPlain = between.length - plain.length;
    const found = plain.length > 0 ? ` (found ${plain.join(', ')})` : '';
    const notPlainHow = family === 'flowchart' ? 'Mermaid entity codes (#…;), HTML or a Markdown string' : 'Mermaid entity codes (#…;) or HTML';
    if (exact.length > 1) return missing('ambiguous-detail-edge', `${exact.length} ${edgesNoun} from ${selector.from} to ${selector.to} have this label; give each a distinct label`);
    if (between.length === 0) return missing('unknown-detail-edge', `the chart has no ${edgeNoun} from ${selector.from} to ${selector.to}`);
    if (notPlain > 0) {
      return missing(
        'unsupported-detail-label',
        `${notPlain} ${notPlain === 1 ? edgeNoun : edgesNoun} from ${selector.from} to ${selector.to} ${notPlain === 1 ? 'has a label' : 'have labels'} written with ${notPlainHow}, which ${notPlain === 1 ? 'is' : 'are'} drawn differently from the source; details bind to plain-text labels${found}`,
      );
    }
    return missing('unknown-detail-edge', `no ${edgeNoun} from ${selector.from} to ${selector.to} has exactly this label${found}`);
  }
  const { element } = exact[0] as (typeof exact)[number];
  // The browser finds the edge by this identity alone, so it must name nothing else in the chart.
  const sharing = element === null ? 0 : reading.identities.filter((id) => id === element).length - 1;
  if (element === null || sharing > 0) {
    return missing(
      'ambiguous-detail-edge',
      element === null
        ? `Mermaid's identity for this ${edgeNoun} is not one the page can find it by`
        : `Mermaid gives this ${edgeNoun} the same identity as ${sharing} other element${sharing === 1 ? '' : 's'} of the chart, so the page cannot tell them apart; rename a node or give the ${edgeNoun} its own ID`,
    );
  }
  return { kind: 'found', target: { kind: 'edge', from: selector.from, to: selector.to, label: selector.label, element } };
}

/** What each family calls its elements, in warnings. */
const NOUNS: Readonly<Record<DiagramFamily, { readonly node: string; readonly edge: string; readonly edges: string }>> = {
  state: { node: 'state', edge: 'transition', edges: 'transitions' },
  flowchart: { node: 'node', edge: 'edge', edges: 'edges' },
};

function selectorKey(entry: AuthoredDiagramDetail): string {
  const s = entry.selector;
  return JSON.stringify(s.kind === 'node' ? [entry.diagram, 'node', s.node] : [entry.diagram, 'edge', s.from, s.to, s.label]);
}

function describe(selector: DetailSelector): string {
  return selector.kind === 'node'
    ? `node ${selector.node}`
    : `edge ${selector.from} → ${selector.to} ${JSON.stringify(selector.label)}`;
}
