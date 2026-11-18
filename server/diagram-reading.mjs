// How Mermaid reads one chart: its nodes, its edges and the identities it gives
// them, from Mermaid's own parser and database. Both diagram readers call this:
// the server's worker (diagram-reader-worker.mjs, inside a jsdom window) and the
// browser extension (extension/src/diagram-reader.ts, in the reader's own page).
// The caller supplies an initialised Mermaid and the document its DOMPurify uses.

/** The first line of an error, cut to 160 characters. */
export function firstLine(error) {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split('\n')[0] ?? '';
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

/**
 * @param {{ mermaid: any, document: Document }} host
 * @returns {(source: string) => Promise<unknown>} a reading with its nodes as an array; diagram-reader.ts `toReading` checks it
 */
export function diagramReading({ mermaid, document }) {
  /** Mermaid's element IDs are short words; anything else is not published. Compared as attributes, never put into a selector. */
  const ELEMENT_ID = /^[A-Za-z0-9_.-]{1,256}$/;
  const LABEL_CACHE_LIMIT = 1024;
  const roundTrips = new Map();

  /** The diagram types details bind to, by the type Mermaid reports. */
  const FAMILIES = { stateDiagram: 'state', 'flowchart-v2': 'flowchart' };

  /**
   * How each family writes `text` as an edge label, for each of Mermaid's label
   * types that is drawn as written. A label type not listed (Markdown strings) is
   * drawn differently from its source and never plain.
   */
  const LABEL_SOURCES = {
    state: { any: (text) => `stateDiagram-v2\n    a --> b: ${text}\n` },
    flowchart: {
      text: (text) => `flowchart TB\n    a -->|${text}| b\n`,
      string: (text) => `flowchart TB\n    a -->|"${text}"| b\n`,
    },
  };

  /** The text a reader sees for a label Mermaid stored as (sanitised) HTML. */
  function shownText(html) {
    const element = document.createElement('div');
    element.innerHTML = html;
    return element.textContent ?? '';
  }

  /** How Mermaid stores `text` written as a label of this family and type, or null if it cannot be one. */
  async function storedLabel(family, labelType, text) {
    const forms = LABEL_SOURCES[family];
    const form = family === 'state' ? forms.any : Object.hasOwn(forms, labelType) ? forms[labelType] : null;
    if (!form) return null;
    const key = `${family}\u0000${labelType}\u0000${text}`;
    if (roundTrips.has(key)) return roundTrips.get(key);
    let stored = null;
    try {
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(form(text));
      const edges = diagram.db.getData().edges.filter((edge) => edge.start === 'a' && edge.end === 'b');
      const edge = edges.length === 1 ? edges[0] : null;
      stored = edge && typeof edge.label === 'string' ? edge.label : null;
    } catch {
      stored = null;
    }
    if (roundTrips.size >= LABEL_CACHE_LIMIT) roundTrips.delete(roundTrips.keys().next().value);
    roundTrips.set(key, stored);
    return stored;
  }


  /** The chart's nodes: a state diagram's states (not notes), or a flowchart's plain nodes (not subgraphs). */
  function nodesOf(family, data) {
    const nodes = [];
    for (const node of data.nodes) {
      if (typeof node.id !== 'string') continue;
      if (family === 'state' && (node.shape === 'note' || node.shape === 'noteGroup')) continue;
      if (family === 'flowchart' && node.isGroup) continue;
      nodes.push(node.id);
    }
    return nodes;
  }

  async function read(source) {
    let diagram;
    try {
      diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    } catch (error) {
      return { kind: 'unsupported', reason: `Mermaid could not read it (${firstLine(error)})` };
    }
    const family = Object.hasOwn(FAMILIES, diagram.type) ? FAMILIES[diagram.type] : null;
    if (!family) {
      return { kind: 'unsupported', reason: `it is a ${diagram.type} diagram; details bind to state diagrams and flowcharts only` };
    }
    const data = diagram.db.getData?.();
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return { kind: 'unsupported', reason: 'Mermaid did not report its nodes and edges' };
    }
    const nodes = nodesOf(family, data);
    const known = new Set(nodes);
    // Every identity Mermaid gave an element of the chart (subgraphs, notes and their edges too), repeats kept.
    const identities = [...data.nodes, ...data.edges].flatMap(({ id }) => (typeof id === 'string' ? [id] : []));
    // Copied before the label round trips below, which reuse Mermaid's database.
    const copied = data.edges.map(({ id, start, end, label, labelType }) => ({ id, start, end, label, labelType }));
    const edges = [];
    for (const { id, start, end, label, labelType } of copied) {
      if (typeof start !== 'string' || typeof end !== 'string') continue;
      if (!known.has(start) || !known.has(end)) continue; // a note's connector, or an edge to a subgraph
      const stored = typeof label === 'string' ? label : '';
      // A plain label is shown as written: its text is in the source, and writing that
      // text as a label of the same type stores exactly this. Entity codes (#quot;),
      // HTML and Markdown strings are not plain.
      const text = shownText(stored);
      const plain = source.includes(text) && (await storedLabel(family, labelType, text)) === stored;
      // An identity that is not a short word is reported (so it still counts) but never published.
      const element = typeof id === 'string' && ELEMENT_ID.test(id) ? id : null;
      edges.push({ element, from: start, to: end, label: plain ? text : null });
    }
    return { kind: 'chart', family, nodes, edges, identities };
  }

  return read;
}
