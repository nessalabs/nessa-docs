// The catalog's DiagramReader in the reader page: the same Mermaid reading the
// server's worker does (server/diagram-reading.mjs), run on this page's own DOM
// and in the renderer's Mermaid queue, since Mermaid keeps global state.

import type { DiagramReader, DiagramReading } from '../../server/diagram-reader';
import { toReading } from '../../server/diagram-reader';
import { diagramReading, firstLine } from '../../server/diagram-reading.mjs';
import { withMermaid } from '../../src/diagram';

const cache = new Map<string, DiagramReading>();
let read: ((source: string) => Promise<unknown>) | null = null;

export const readDiagramInPage: DiagramReader = async (source) => {
  const cached = cache.get(source);
  if (cached) return cached;
  const reading = await withMermaid(async (mermaid) => {
    const reader = (read ??= diagramReading({ mermaid, document }));
    try {
      return toReading(await reader(source)) ?? { kind: 'unsupported', reason: 'the diagram reader answered in an unexpected shape' } as const;
    } catch (error) {
      return { kind: 'unsupported', reason: `Mermaid could not read it (${firstLine(error)})` } as const;
    }
  });
  cache.set(source, reading);
  return reading;
};
