import { t, useLanguage, setLanguage } from './i18n';
import { Tooltip } from 'radix-ui';
// The document tree and search, and the footer's way to Settings. The tree is
// drawn from the catalog the app loaded; search asks the server and drops
// answers to an older query.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Network, Search, Settings, Languages } from 'lucide-react';
import type { CatalogResponse, DocumentSummary, SearchResult } from '../shared/api';
import { useProjectReads } from './project-opening/project-context';
import { byKind, KIND_NAME } from './kinds';
import { AppLink, documentPath, settingsPath } from './router';
import { Input, QuietButton } from './ui';

interface SidebarProps {
  catalog: CatalogResponse;
  currentId: string | null;
  onNavigate: () => void;
}

export function Sidebar({ catalog, currentId, onNavigate }: SidebarProps) {
  const byId = useMemo(() => new Map(catalog.documents.map((document) => [document.id, document])), [catalog]);
  const [query, setQuery] = useState('');
  const root = catalog.rootId ? byId.get(catalog.rootId) : undefined;
  const top = root ? byKind(root.children.flatMap((id) => byId.get(id) ?? [])) : [];
  const structural = top.filter((document) => document.kind !== 'guide');
  const guides = top.filter((document) => document.kind === 'guide');

  return (
    <div className="sidebar-inner">
      <SearchBox query={query} onQuery={setQuery} onNavigate={onNavigate} />
      {query.trim() === '' ? (
        <nav className="tree" aria-label={t("Documents")}>
          {root ? (
            <>
              <ul className="tree-level" data-level={0}>
                <li className="tree-item">
                  <Row document={root} current={root.id === currentId} depth={0} onNavigate={onNavigate} icon={<Network />} />
                </li>
              </ul>
              <Section title={t(KIND_NAME.service)}>
                {structural.map((document) => (
                  <TreeNode key={document.id} document={document} byId={byId} currentId={currentId} onNavigate={onNavigate} depth={0} />
                ))}
              </Section>
              {guides.length > 0 ? (
                <Section title={t(KIND_NAME.guide)}>
                  {guides.map((document) => (
                    <TreeNode key={document.id} document={document} byId={byId} currentId={currentId} onNavigate={onNavigate} depth={0} />
                  ))}
                </Section>
              ) : null}
            </>
          ) : (
            <p className="tree-empty">{t("No system document was accepted. See Settings › Health.")}</p>
          )}
        </nav>
      ) : null}
    </div>
  );
}

/**
 * Drawn in every catalog state (loading, failed, loaded), so Settings — and
 * through it Health and Reload documentation — stays reachable when the
 * catalog does not (verification/settings.mjs opens it in each state).
 */
export function SidebarFooter({ current, onNavigate, onEscape }: { current: boolean; onNavigate: () => void; onEscape?: () => void }) {
  const language = useLanguage();
  return (
    <div className="sidebar-footer">
      <Tooltip.Provider delayDuration={200}><Tooltip.Root><Tooltip.Trigger asChild>
        <AppLink to={settingsPath()} onClick={onNavigate} className="row settings-link" aria-current={current ? 'page' : undefined}>
          <span className="row-icon" aria-hidden="true"><Settings /></span>
          <span className="row-label" dir="auto">{t("Settings")}</span>
        </AppLink>
      </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content onEscapeKeyDown={onEscape} className="chrome-tooltip" side="top" sideOffset={8} collisionPadding={12}>
        {t('Appearance, language and document health')}<Tooltip.Arrow />
      </Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider>
      <QuietButton className="language-switch" onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')} aria-label={language === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}>
        <Languages aria-hidden="true" /><span lang={language === 'ar' ? 'en' : 'ar'} dir={language === 'ar' ? 'ltr' : 'rtl'}>{language === 'ar' ? 'English' : 'العربية'}</span>
      </QuietButton>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="tree-section" data-collapsed={open ? undefined : ''}>
      <button type="button" className="section-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{title}</span>
        <ChevronRight aria-hidden="true" />
      </button>
      {open ? <ul className="tree-level" data-level={0}>{children}</ul> : null}
    </div>
  );
}

function containsDocument(document: DocumentSummary, id: string | null, byId: Map<string, DocumentSummary>): boolean {
  if (id === null) return false;
  for (let current = byId.get(id); current; current = current.parent ? byId.get(current.parent) : undefined) {
    if (current.id === document.id) return true;
  }
  return false;
}

function Row(props: {
  document: DocumentSummary;
  current: boolean;
  depth: number;
  onNavigate: () => void;
  icon?: ReactNode;
  disclosure?: ReactNode;
}) {
  const { document, current, depth, onNavigate, icon, disclosure } = props;
  return (
    <div className="tree-row" data-current={current ? '' : undefined} style={{ paddingInlineStart: `${depth * 14}px` }}>
      {disclosure ?? <span className="disclosure-spacer" aria-hidden="true" />}
      <AppLink
        to={documentPath(document.id)}
        className="row tree-link"
        aria-current={current ? 'page' : undefined}
        onClick={onNavigate}
        data-doc-id={document.id}
        title={document.title}
      >
        {icon ? (
          <span className="row-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="row-label" dir="auto">{document.title}</span>
      </AppLink>
    </div>
  );
}

function TreeNode(props: {
  document: DocumentSummary;
  byId: Map<string, DocumentSummary>;
  currentId: string | null;
  onNavigate: () => void;
  depth: number;
}) {
  const { document, byId, currentId, onNavigate, depth } = props;
  const onPath = containsDocument(document, currentId, byId);
  const [open, setOpen] = useState(onPath);
  useEffect(() => {
    if (onPath) setOpen(true);
  }, [onPath]);
  const children = byKind(document.children.flatMap((id) => byId.get(id) ?? []));
  const groupId = `tree-${document.id}`;
  return (
    <li className="tree-item" data-kind={document.kind}>
      <Row
        document={document}
        current={document.id === currentId}
        depth={depth}
        onNavigate={onNavigate}
        disclosure={
          children.length > 0 ? (
            <button
              type="button"
              className="disclosure"
              aria-expanded={open}
              aria-controls={groupId}
              aria-label={`${t(open ? 'Collapse' : 'Expand')} ${document.title}`}
              onClick={() => setOpen((value) => !value)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          ) : undefined
        }
      />
      {children.length > 0 && open ? (
        <ul className="tree-level" id={groupId} data-level={depth + 1}>
          {children.map((child) => (
            <TreeNode key={child.id} document={child} byId={byId} currentId={currentId} onNavigate={onNavigate} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

type SearchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'done'; readonly query: string; readonly results: readonly SearchResult[] }
  | { readonly kind: 'failed'; readonly message: string };

function SearchBox({ query, onQuery, onNavigate }: { query: string; onQuery: (q: string) => void; onNavigate: () => void }) {
  const api = useProjectReads();
  const [state, setState] = useState<SearchState>({ kind: 'idle' });

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      setState({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ kind: 'searching' });
    const timer = window.setTimeout(() => {
      api.search(trimmed, controller.signal).then(
        (outcome) => {
          if (controller.signal.aborted) return;
          if (outcome.kind === 'ok') setState({ kind: 'done', query: trimmed, results: outcome.value.results });
          else setState({ kind: 'failed', message: outcome.kind === 'failed' ? outcome.message : 'Search failed' });
        },
        () => undefined,
      );
    }, 120);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="search" role="search">
      <label htmlFor="doc-search" className="visually-hidden">{t("Search documents")}</label>
      <span className="search-icon" aria-hidden="true">
        <Search />
      </span>
      <Input
        id="doc-search"
        type="search"
        dir="auto"
        placeholder={t("Search")}
        autoComplete="off"
        value={query}
        maxLength={200}
        className="search-input"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && query !== '') {
            event.stopPropagation();
            onQuery('');
          }
        }}
      />
      {query.trim() !== '' ? (
        <div className="search-results" aria-live="polite">
          {state.kind === 'searching' ? <p className="search-status">{t("Searching…")}</p> : null}
          {state.kind === 'failed' ? <p className="search-status">{state.message}</p> : null}
          {state.kind === 'done' && state.results.length === 0 ? (
            <p className="search-status">{t("No loaded document matches")} “<bdi>{state.query}</bdi>”.</p>
          ) : null}
          {state.kind === 'done' && state.results.length > 0 ? (
            <ul aria-label={`${state.results.length} ${t("results")}`}>
              {state.results.map((result) => (
                <li key={result.id}>
                  <AppLink
                    to={documentPath(result.id)}
                    className="search-result"
                    data-doc-id={result.id}
                    onClick={() => {
                      onQuery('');
                      onNavigate();
                    }}
                  >
                    <span dir="auto" className="search-title">{result.title}</span>
                    <span dir="auto" className="search-snippet">{result.snippet}</span>
                  </AppLink>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
