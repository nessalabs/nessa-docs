// CLI composition: catalog owns validation; stdout is one JSON result.
import { DEFAULT_LIMITS, loadCatalog } from '../catalog.js';
import { readDiagram as readWithMermaid } from '../diagram-reader.js';
import { cachedHistory } from '../source-history.js';
import { nodeRepositoryFiles } from '../files.js';
import { projectPath } from '../../shared/projects.js';
import { catalogResponse } from '../responses.js';

const args = process.argv.slice(2);
const root = args.length === 2 && args[0] === '--project' ? projectPath(args[1]) : null;
if (root === null) {
  console.log(JSON.stringify({ ok: false, error: 'invalid-arguments', message: 'Usage: npm run validate:docs -- --project /absolute/project/path' }));
  process.exitCode = 2;
} else {
  try {
    const result = catalogResponse(await loadCatalog(nodeRepositoryFiles(), root, DEFAULT_LIMITS, readWithMermaid, { history: cachedHistory() }));
    const ok = result.rootId !== null && result.issues.every((issue) => issue.severity !== 'error');
    console.log(JSON.stringify({ ok, rootId: result.rootId, documents: result.documents.length, issues: result.issues }));
    process.exitCode = ok ? 0 : 1;
  } catch {
    console.log(JSON.stringify({ ok: false, error: 'project-read-failed', message: 'The project could not be read. Check folder permissions.' }));
    process.exitCode = 1;
  }
}
