// The diagram reader's worker (started by server/diagram-reader.ts). Mermaid's
// label handling passes text through DOMPurify, which needs a DOM. This worker
// gives it a real one: a jsdom window, installed as this worker's own `window`
// before Mermaid and DOMPurify load, so DOMPurify binds to it and runs
// unmodified. The server's main thread never sees these globals.
//
// Request: { source }. Reply: a DiagramReading (see diagram-reader.ts) for a
// state diagram or a flowchart, read from Mermaid's own database. Mermaid keeps
// global state, so requests are answered one at a time.

import { parentPort } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import { diagramReading, firstLine } from './diagram-reading.mjs';

const { window } = new JSDOM('');
globalThis.window = window;
const { default: mermaid } = await import('mermaid');
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
const read = diagramReading({ mermaid, document: window.document });

let queue = Promise.resolve();
parentPort.on('message', ({ source }) => {
  queue = queue.then(async () => {
    let reading;
    try {
      reading = typeof source === 'string' ? await read(source) : { kind: 'unsupported', reason: 'no diagram source was given' };
    } catch (error) {
      reading = { kind: 'unsupported', reason: `Mermaid could not read it (${firstLine(error)})` };
    }
    parentPort.postMessage(reading);
  });
});
