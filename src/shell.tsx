import { ProjectBrand } from './project-brand';
import { t } from './i18n';
// The window's top-left corner (the sidebar toggle and the nessaDocs name),
// and the titlebar every page draws at the top of the reading pane: Back and
// Forward, where you are, and the page's own actions.

import { forwardRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, PanelLeft } from 'lucide-react';
import type { Crumb } from '../shared/api';
import { AppLink, documentPath, useHistoryPosition } from './router';
import { IconButton } from './ui';

/**
 * Drawn once, outside both panes, so the toggle keeps its place and its focus
 * whether the sidebar is docked, hidden or a drawer. The sidebar and the
 * titlebar leave room for it (styles.css, "App bar").
 */
export const AppBar = forwardRef<
  HTMLButtonElement,
  { sidebarOpen: boolean; onToggleSidebar: () => void; onHome: () => void }
>(function AppBar({ sidebarOpen, onToggleSidebar, onHome }, toggleRef) {
  return (
    <div className="app-bar">
      <IconButton
        ref={toggleRef}
        label={sidebarOpen ? t('Hide sidebar') : t('Show sidebar')}
        aria-expanded={sidebarOpen}
        aria-controls="sidebar"
        data-sidebar-toggle=""
        onClick={onToggleSidebar}
      >
        <PanelLeft />
      </IconButton>
      <ProjectBrand title={t("System overview")} onHome={onHome} />
    </div>
  );
});

/**
 * `currentShown` false fades the current place out of the titlebar while the
 * page's own title is on screen (it stays in the accessibility tree).
 */
export function Titlebar({
  trail,
  current,
  actions,
  currentShown = true,
}: {
  trail?: readonly Crumb[];
  current: string;
  actions?: ReactNode;
  currentShown?: boolean;
}) {
  const { canGoBack, canGoForward } = useHistoryPosition();
  return (
    <header className="titlebar">
      <div className="titlebar-controls">
        <IconButton
          label={t("Back")}
          data-history="back"
          aria-disabled={canGoBack ? undefined : true}
          onClick={() => canGoBack && window.history.back()}
        >
          <ChevronLeft />
        </IconButton>
        <IconButton
          label={t("Forward")}
          data-history="forward"
          aria-disabled={canGoForward ? undefined : true}
          onClick={() => canGoForward && window.history.forward()}
        >
          <ChevronRight />
        </IconButton>
      </div>
      <nav aria-label={t("Breadcrumb")} className="breadcrumbs">
        <ol>
          {(trail ?? []).map((crumb) => (
            <li key={crumb.id}>
              <AppLink to={documentPath(crumb.id)} title={crumb.title}>
                {crumb.title}
              </AppLink>
              <ChevronRight aria-hidden="true" className="breadcrumb-separator" />
            </li>
          ))}
          <li>
            <span aria-current="page" title={current} data-shown={currentShown ? '' : undefined}>
              {current}
            </span>
          </li>
        </ol>
      </nav>
      {actions ? <div className="titlebar-actions">{actions}</div> : null}
    </header>
  );
}
