// Diagram node ids a counterexample can mark. Words that are Mermaid keywords
// are skipped; a hit still has to equal a value TLC printed.

import { lexMarkdown, markdownDiagrams } from '../../shared/markdown.js';

const SKIP = new Set([
  'stateDiagram', 'stateDiagram-v2', 'flowchart', 'graph', 'state', 'note', 'direction',
  'LR', 'TD', 'TB', 'RL', 'BT', 'participant', 'as', 'left', 'right', 'of', 'and',
]);

export function diagramNodeIds(body: string): string[] {
  const ids = new Set<string>();
  for (const diagram of markdownDiagrams(lexMarkdown(body))) {
    for (const match of diagram.source.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\b/g)) {
      const word = match[1];
      if (word && !SKIP.has(word)) ids.add(word);
    }
  }
  return [...ids];
}
