import { ProjectTitleContext, useDocsName } from './project-brand';
// Application chrome: loads the catalog, owns the sidebar (docked beside the
// reading pane on wide windows, resizable there; a drawer on narrow ones), and
// chooses the page for the current route.

import { type CSSProperties, useCallback, useEffect, useMemo, useContext, useRef, useState } from 'react';
import type { CatalogResponse } from '../shared/api';
import type { ProjectOutcome } from '../shared/projects';
import { ProjectContext } from './project-opening/project-context';
import { loadProjectSelection } from './project-opening/selection';
import type { ProjectSource } from './project-opening/read-port';
import { OpenProject } from './project-opening/open-project';
import { DocumentPage, IssueList } from './document-page';
import { AppLink, parseRoute, selectProject, type Route, usePathname, useSearch } from './router';
import { SettingsPage } from './settings-page';
import { AppBar, Titlebar } from './shell';
import { Sidebar, SidebarFooter } from './sidebar';
import { SidebarResizer } from './sidebar-resize';
import { clampSidebarWidth, readSidebarWidth, storeSidebarWidth } from './sidebar-width';
import { QuietButton } from './ui';
import { useEscapeLayer } from './layers';
import { useNarrow } from './viewport';

/**
 * The one catalog read (verification/CHECKLIST.md, "Settings and the catalog
 * read", S1–S9). `reloading`: a newer read is in flight; what is shown is the
 * last answer until it arrives. `readAt`: when that answer arrived.
 */
export type CatalogState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly catalog: CatalogResponse; readonly reloading: boolean; readonly readAt: number }
  | { readonly kind: 'failed'; readonly message: string; readonly reloading: boolean };

const SIDEBAR_KEY = 'nessa-state-browser:sidebar';

export function App({ source }: { source: ProjectSource }) {
  const search = useSearch();
  const id = new URLSearchParams(search).get('project');
  return <ProjectSelection key={id ?? 'welcome'} id={id} source={source} />;
}

function ProjectSelection({ id, source }: { id: string | null; source: ProjectSource }) {
  const [state, setState] = useState<ProjectOutcome | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadProjectSelection(source, id, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      if (next.kind === 'opened' && id === null) selectProject(next.project.id, true);
      else setState(next);
    }, () => undefined);
    return () => controller.abort();
  }, [id, source]);
  const reads = useMemo(() => id === null ? null : source.reads(id), [id, source]);
  return reads !== null && state?.kind === 'opened'
    ? <ProjectContext.Provider value={reads}><ProjectApp source={source} projectTitle={state.project.title} /></ProjectContext.Provider>
    : <ProjectApp key="unselected" source={source} unselected={state} />;
}

function ProjectApp({ source, unselected, projectTitle = null }: { source: ProjectSource; unselected?: ProjectOutcome | null; projectTitle?: string | null }) {
  const api = useContext(ProjectContext);
  const pathname = usePathname();
  const route = parseRoute(pathname);
  const [catalogState, setCatalogState] = useState<CatalogState>({ kind: 'loading' });
  const [reloads, setReloads] = useState(0);
  const narrow = useNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [docked, setDocked] = useState(() => window.localStorage.getItem(SIDEBAR_KEY) !== 'hidden');
  const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth(window.localStorage));
  const shell = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const firstPath = useRef(pathname);
  const sidebarOpen = narrow ? drawerOpen : docked;

  useEffect(() => {
    window.history.scrollRestoration = 'manual';
  }, []);

  useEffect(() => {
    if (api === null) return;
    const controller = new AbortController();
    // S2, S5: keep the last answer on screen, marked as being read again. S6: the
    // cleanup aborts an earlier read, so only the last answer applies.
    setCatalogState((state) => (state.kind === 'loading' ? state : { ...state, reloading: true }));
    api.catalog(controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return;
        if (outcome.kind === 'ok') setCatalogState({ kind: 'loaded', catalog: outcome.value, reloading: false, readAt: Date.now() });
        else setCatalogState({ kind: 'failed', message: outcome.kind === 'failed' ? outcome.message : 'Catalog not found', reloading: false });
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [reloads, api]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);

  // The width rule is sidebar-width.ts's; every committed width passes through it once here.
  const commitSidebarWidth = useCallback((width: number) => {
    const next = clampSidebarWidth(width);
    setSidebarWidth(next);
    storeSidebarWidth(window.localStorage, next);
  }, []);

  // The toggle is in the app bar, outside the inert <main>, so it can take
  // focus while the drawer is still closing.
  const closeDrawer = useCallback((restoreFocus: boolean) => {
    setDrawerOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  const toggleSidebar = useCallback(() => {
    if (narrow) {
      setDrawerOpen((open) => !open);
      return;
    }
    setDocked((open) => {
      window.localStorage.setItem(SIDEBAR_KEY, open ? 'hidden' : 'shown');
      return !open;
    });
  }, [narrow]);

  // Drawer: focus moves in; Escape (src/layers.ts) closes and returns focus to the toggle.
  useEscapeLayer(narrow && drawerOpen, () => closeDrawer(true));
  useEffect(() => {
    if (narrow && drawerOpen) sidebar.current?.querySelector<HTMLElement>('input, a, button')?.focus();
  }, [narrow, drawerOpen]);

  // A route change closes the drawer (e.g. browser back).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const catalog = catalogState.kind === 'loaded' ? catalogState.catalog : null;
  const displayTitle = catalog?.documents.find(doc => doc.id === catalog.rootId)?.title ?? projectTitle;
  const currentId = route.kind === 'document' ? route.id : route.kind === 'home' ? (catalog?.rootId ?? null) : null;

  return (
    <ProjectTitleContext.Provider value={displayTitle}><div
      ref={shell}
      className="shell"
      data-sidebar={sidebarOpen ? 'open' : 'closed'}
      data-narrow={narrow ? '' : undefined}
      style={{ '--sidebar-w': `${sidebarWidth}px` } as CSSProperties}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AppBar ref={toggleRef} sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} onHome={() => closeDrawer(false)} />
      <aside
        id="sidebar"
        ref={sidebar}
        className="sidebar"
        aria-label="Documents and search"
        data-open={sidebarOpen}
        inert={!sidebarOpen ? true : undefined}
      >
        {catalog ? (
          <Sidebar catalog={catalog} currentId={currentId} onNavigate={() => closeDrawer(false)} />
        ) : (
          api === null ? null : <p className="sidebar-status">{catalogState.kind === 'failed' ? catalogState.message : 'Loading documents…'}</p>
        )}
        <SidebarFooter current={route.kind === 'settings'} onNavigate={() => closeDrawer(false)} />
      </aside>
      {/* R10: no separator while the sidebar is hidden or a drawer. */}
      {!narrow && docked ? <SidebarResizer shell={shell} width={sidebarWidth} onCommit={commitSidebarWidth} /> : null}
      <button
        type="button"
        className="scrim"
        aria-label="Close sidebar"
        tabIndex={-1}
        onClick={() => closeDrawer(true)}
        hidden={!(narrow && drawerOpen)}
      />
      <main id="main" className="main" inert={narrow && drawerOpen ? true : undefined}>
        {route.kind === 'settings' && api === null ? (<SettingsPage projectTitle={projectTitle} catalogState={unselected === null ? { kind: 'loading' } : { kind: 'failed', message: 'Open a project to read its documentation.', reloading: false }} onReload={reload} focusOnLoad={pathname !== firstPath.current} />) : api === null && unselected === null ? (<><Titlebar current="Loading" /><div className="page-status" aria-busy="true">Loading…</div></>) : route.kind === 'open-project' || api === null ? (<OpenProject source={source} initial={unselected ?? undefined} />) : route.kind === 'settings' ? (
          <SettingsPage projectTitle={catalog?.documents.find((doc) => doc.id === catalog.rootId)?.title ?? projectTitle} catalogState={catalogState} onReload={reload} focusOnLoad={pathname !== firstPath.current} />
        ) : catalogState.kind === 'failed' ? (
          <>
            <Titlebar current="Unavailable" />
            <div className="page-status" role="alert">
              <p>{catalogState.message}</p>
              <QuietButton onClick={reload}>Try again</QuietButton>
            </div>
          </>
        ) : catalog === null ? (
          <>
            <Titlebar current="Loading" />
            <div className="page-status" aria-busy="true">
              Loading documents…
            </div>
          </>
        ) : (
          <Page route={route} catalog={catalog} onStaleCatalog={reload} focusOnLoad={pathname !== firstPath.current} />
        )}
      </main>
    </div></ProjectTitleContext.Provider>
  );
}

function Page(props: {
  route: Exclude<Route, { kind: 'settings' | 'open-project' }>;
  catalog: CatalogResponse;
  onStaleCatalog: () => void;
  focusOnLoad: boolean;
}) {
  const { route, catalog, onStaleCatalog, focusOnLoad } = props;
  switch (route.kind) {
    case 'home':
      return catalog.rootId ? (
        <DocumentPage id={catalog.rootId} catalogVersion={catalog.version} onStaleCatalog={onStaleCatalog} focusOnLoad={focusOnLoad} />
      ) : (
        <>
          <Titlebar current="No system document" />
          <div className="page not-found">
            <h1>No system document</h1>
            <p>docs/state/README.md was not accepted, so there is no overview to show.</p>
            <IssueList title="Errors and warnings" issues={catalog.issues} />
          </div>
        </>
      );
    case 'document':
      return (
        <DocumentPage id={route.id} catalogVersion={catalog.version} onStaleCatalog={onStaleCatalog} focusOnLoad={focusOnLoad} />
      );
    case 'not-found':
      return <NotFoundPage path={route.path} />;
  }
}

function NotFoundPage({ path }: { path: string }) {
  const docsName = useDocsName();
  useEffect(() => {
    document.title = `Not found · ${docsName}`;
  }, [docsName]);
  return (
    <>
      <Titlebar current="Not found" />
      <div className="page not-found" data-page-state="not-found">
        <h1 tabIndex={-1}>Nothing at {path}</h1>
        <p>
          Documents live at <code>/docs/&lt;id&gt;</code>. <AppLink to="/">Open the system overview</AppLink>.
        </p>
      </div>
    </>
  );
}
