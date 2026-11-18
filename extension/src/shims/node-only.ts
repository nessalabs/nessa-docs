// Node modules the catalog imports for work the reader page never does: the
// diagram reader's worker thread (the page reads diagrams itself) and git
// history (GitHub pins a commit instead). Reaching one is a bug, so it throws.
function unavailable(): never {
  throw new Error('This needs Node.js and is not available in the browser extension.');
}

export class Worker {
  constructor() {
    unavailable();
  }
}
export const execFile = unavailable;
export default {};
