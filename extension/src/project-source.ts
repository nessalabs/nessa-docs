// The reader's ProjectSource (src/project-opening/read-port.ts) for one docs
// folder on GitHub. The local app asks its server; here the same server code
// (catalog, responses) runs in the page over files read from GitHub, so a page
// looks and checks exactly as it does in the app. There is one project, and
// nothing that needs the local machine: no folder opening, no rule checker.

import type { Catalog } from '../../server/catalog';
import { loadCatalog } from '../../server/catalog';
import type { RepositoryFiles } from '../../server/files';
import { catalogResponse, documentResponse, searchResponse } from '../../server/responses';
import type { Fetched, ProjectSource } from '../../src/project-opening/read-port';
import type { DiagramReader } from '../../server/diagram-reader';
import { readDiagramInPage } from './diagram-reader';
import { REPO_ROOT } from './repo-files';

export const PROJECT_ID = 'github';
const LOCAL_ONLY = 'Rule checks run in the Nessa Docs app on your computer.';

export interface GithubProject {
  readonly source: ProjectSource;
  /** The catalog, read once and kept: every read is pinned to one commit. */
  catalog(): Promise<Catalog>;
}

export function githubProject(files: RepositoryFiles, title: string, readDiagram: DiagramReader = readDiagramInPage): GithubProject {
  let loading: Promise<Catalog> | null = null;
  const catalog = () => {
    loading ??= loadCatalog(files, REPO_ROOT, undefined, readDiagram);
    loading.catch(() => { loading = null; });
    return loading;
  };
  const ok = <T,>(value: T): Fetched<T> => ({ kind: 'ok', value });
  const failed = (error: unknown): Fetched<never> => ({ kind: 'failed', message: error instanceof Error ? error.message : 'GitHub did not answer.' });
  const localOnly = async (): Promise<Fetched<never>> => ({ kind: 'failed', message: LOCAL_ONLY });
  const source: ProjectSource = {
    current: async () => ({ kind: 'opened', project: { id: PROJECT_ID, title } }),
    open: async () => ({ kind: 'refused', error: 'project-unavailable', message: 'This reader shows the docs folder on this GitHub page.', issues: [] }),
    pickerStatus: async () => ({ kind: 'unsupported', message: 'Opening folders needs the Nessa Docs app.' }),
    chooseFolder: async () => ({ kind: 'unsupported', message: 'Opening folders needs the Nessa Docs app.' }),
    checker: localOnly,
    installChecker: localOnly,
    reads: () => ({
      catalog: () => catalog().then((value) => ok(catalogResponse(value)), failed),
      async document(id) {
        try {
          const response = await documentResponse(await catalog(), id, files);
          return 'error' in response ? { kind: 'unknown-document', value: response } : ok(response);
        } catch (error) {
          return failed(error);
        }
      },
      search: (query) => catalog().then((value) => ok(searchResponse(value, query)), failed),
      checker: localOnly,
      installChecker: localOnly,
      startModelCheck: localOnly,
      modelCheckRun: localOnly,
      cancelModelCheck: localOnly,
    }),
  };
  return { source, catalog };
}
