// The reader page, shown in an iframe over GitHub's file view. It waits for the
// content script to hand it a port and the docs root, reads the catalog from
// GitHub through that port, then draws the same App the local reader draws.
// The address bar of the GitHub tab follows the page shown here.

import { StrictMode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Github } from 'lucide-react';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../../src/styles.css';
import './reader.css';
import { App } from '../../src/app';
import { applyAppearance, readAppearance } from '../../src/appearance';
import { ReaderHostContext, type ReaderHost } from '../../src/host';
import { documentPath, navigate, parseRoute, usePathname } from '../../src/router';
import type { Catalog } from '../../server/catalog';
import { type DocsRoot, githubUrl, STATE_DIRECTORY } from './github-location';
import { portClient, type RepoPort } from './port-client';
import { READY, type OpenFile, type ReaderInit } from './protocol';
import { githubProject, PROJECT_ID } from './project-source';
import { repoFiles } from './repo-files';

const GITHUB_ORIGIN = 'https://github.com';
applyAppearance(readAppearance());

const container = document.getElementById('root') as HTMLElement;
const reactRoot = createRoot(container);
showStatus('Reading docs/state from GitHub…');

function showStatus(message: string, failed = false) {
  reactRoot.render(<div className="ext-status" role={failed ? 'alert' : 'status'} aria-busy={failed ? undefined : true}><span className="brand-name">nessa</span><span className="brand-product">Docs</span><p>{message}</p></div>);
}

function idForFile(catalog: Catalog, file: string | null): string | null {
  if (file === null) return null;
  for (const document of catalog.documents.values()) if (document.summary.file === file) return document.summary.id;
  return null;
}

function fileForId(catalog: Catalog, id: string): string | null {
  return catalog.documents.get(id)?.summary.file ?? null;
}

/** Tells the content script which page is shown, so the GitHub address follows it. */
function RouteReporter({ catalog, port }: { catalog: Catalog; port: RepoPort }) {
  const pathname = usePathname();
  useEffect(() => {
    const route = parseRoute(pathname);
    const file = route.kind === 'home' ? `${STATE_DIRECTORY}/README.md` : route.kind === 'document' ? fileForId(catalog, route.id) : null;
    port.tell({ type: 'route', file });
  }, [pathname, catalog, port]);
  return null;
}

function Reader({ root, catalog, port, source }: { root: DocsRoot; catalog: Catalog; port: RepoPort; source: Parameters<typeof App>[0]['source'] }) {
  const host = useMemo<ReaderHost>(() => ({
    localProject: false,
    repoFileHref: (path, fragment) => githubUrl(root, `${root.prefix}${path}`, 'blob', fragment),
    sidebarFooter: (
      <button type="button" className="row ext-github-view" onClick={() => port.tell({ type: 'show-github' })} title={`${root.owner}/${root.repo} at ${root.ref}`}>
        <span className="row-icon" aria-hidden="true"><Github /></span>
        <span className="row-label">GitHub view</span>
        <span className="ext-ref">{root.ref}</span>
      </button>
    ),
  }), [root, port]);
  return (
    <ReaderHostContext.Provider value={host}>
      <App source={source} />
      <RouteReporter catalog={catalog} port={port} />
    </ReaderHostContext.Provider>
  );
}

async function start(init: ReaderInit, messagePort: MessagePort) {
  let catalog: Catalog | null = null;
  const port = portClient(messagePort, (message) => {
    const open = message as Partial<OpenFile> | null;
    if (open?.type !== 'open' || catalog === null) return;
    const id = idForFile(catalog, open.file ?? null) ?? catalog.rootId;
    if (id === null) return;
    const to = documentPath(id);
    if (window.location.pathname !== to) navigate(to);
  });
  const { root } = init;
  const project = githubProject(repoFiles(port, root.prefix), `${root.owner}/${root.repo}`);
  try {
    catalog = await project.catalog();
  } catch (error) {
    showStatus(`GitHub did not answer: ${error instanceof Error ? error.message : 'unknown error'}`, true);
    return;
  }
  // The reader's router reads the address: start on the page GitHub's address names.
  const id = idForFile(catalog, init.file);
  const path = id && id !== catalog.rootId ? documentPath(id) : '/';
  window.history.replaceState({ index: 0 }, '', `${path}?project=${PROJECT_ID}`);
  document.title = `${root.owner}/${root.repo} · Nessa Docs`;
  reactRoot.render(
    <StrictMode>
      <Reader root={root} catalog={catalog} port={port} source={project.source} />
    </StrictMode>,
  );
}

let started = false;
window.addEventListener('message', (event) => {
  if (started || event.source !== window.parent || event.origin !== GITHUB_ORIGIN) return;
  const init = event.data as Partial<ReaderInit> | null;
  const port = event.ports[0];
  if (init?.type !== 'init' || !init.root || !port) return;
  started = true;
  void start(init as ReaderInit, port);
});
window.parent.postMessage(READY, GITHUB_ORIGIN);
