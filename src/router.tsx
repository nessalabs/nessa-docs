// A small History API router: real deep URLs, back/forward, no hash routing.

import { type AnchorHTMLAttributes, type MouseEvent, useEffect, useSyncExternalStore } from 'react';

import { stored, store } from './browser-storage';

export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'document'; readonly id: string }
  | { readonly kind: 'settings' }
  | { readonly kind: 'open-project' }
  | { readonly kind: 'not-found'; readonly path: string };

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Where this tab stands in its own history, so Back and Forward can say when
// they would do nothing. Each entry this app pushes carries its index; the
// furthest index is kept for the tab's lifetime (sessionStorage survives reload).
const FURTHEST_KEY = 'nessa-state-browser:furthest';
function entryIndex(): number {
  const state = window.history.state as { index?: unknown } | null;
  return typeof state?.index === 'number' ? state.index : 0;
}
function furthestIndex(): number {
  const value = Number(stored('sessionStorage', FURTHEST_KEY));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
/** Scrolls to the element a `#fragment` names, if it exists. */
export function scrollToHash(hash: string): boolean {
  if (!hash || hash === '#') return false;
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return false;
  }
  const target = document.getElementById(id);
  target?.scrollIntoView({ block: 'start' });
  return target !== null;
}

let lastIndex = 0;
if (typeof window !== 'undefined') {
  // A fragment navigation the app did not push (a plain #link, typed URL)
  // arrives without an index; give it the next one.
  window.addEventListener('hashchange', () => {
    if (typeof (window.history.state as { index?: unknown } | null)?.index !== 'number') {
      const index = lastIndex + 1;
      window.history.replaceState({ index }, '');
      store('sessionStorage', FURTHEST_KEY, String(index));
      notify();
    }
  });
}
if (typeof window !== 'undefined' && typeof (window.history.state as { index?: unknown } | null)?.index !== 'number') {
  window.history.replaceState({ index: 0 }, '');
  store('sessionStorage', FURTHEST_KEY, '0');
}
let historySnapshot = { canGoBack: false, canGoForward: false };
function readHistory() {
  const index = entryIndex();
  lastIndex = index;
  const next = { canGoBack: index > 0, canGoForward: index < furthestIndex() };
  if (next.canGoBack !== historySnapshot.canGoBack || next.canGoForward !== historySnapshot.canGoForward) {
    historySnapshot = next;
  }
  return historySnapshot;
}

/** Whether Back and Forward would move within this site's history in this tab. */
export function useHistoryPosition() {
  return useSyncExternalStore(subscribe, readHistory);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { kind: 'home' };
  if (pathname === '/open') return { kind: 'open-project' };
  if (pathname === '/settings') return { kind: 'settings' };
  const match = /^\/docs\/([^/]+)\/?$/.exec(pathname);
  if (match?.[1]) {
    try {
      return { kind: 'document', id: decodeURIComponent(match[1]) };
    } catch {
      return { kind: 'not-found', path: pathname };
    }
  }
  return { kind: 'not-found', path: pathname };
}

export function documentPath(id: string, fragment?: string | null): string {
  return `/docs/${encodeURIComponent(id)}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
}

export type SettingsTab = 'general' | 'health';

/** `?tab=health` is Health; anything else is General, so a stale or mistyped tab still opens Settings. */
export function parseSettingsTab(search: string): SettingsTab {
  return new URLSearchParams(search).get('tab') === 'health' ? 'health' : 'general';
}

export function settingsPath(tab: SettingsTab = 'general'): string {
  return tab === 'general' ? '/settings' : `/settings?tab=${tab}`;
}

/** Internal links inherit the selected handle; explicit handles remain explicit (P6, P7). */
export function projectHref(to: string, search = window.location.search): string {
  const url = new URL(to, window.location.href);
  const id = new URLSearchParams(search).get('project');
  if (id !== null && !url.searchParams.has('project')) url.searchParams.set('project', id);
  return url.pathname + url.search + url.hash;
}

export function selectProject(id: string, replace = false) {
  const to = replace ? window.location.pathname + window.location.search + window.location.hash : '/';
  const url = new URL(to, window.location.href);
  url.searchParams.set('project', id);
  if (replace) { window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash); notify(); }
  else navigate(url.pathname + url.search + url.hash);
}

export function navigate(to: string) {
  const url = new URL(projectHref(to), window.location.href);
  const index = entryIndex() + 1;
  if (url.pathname === window.location.pathname && url.search === window.location.search) {
    if (url.hash !== window.location.hash) {
      window.history.pushState({ index }, '', url.pathname + url.search + url.hash);
      store('sessionStorage', FURTHEST_KEY, String(index));
    }
    scrollToHash(url.hash);
    notify();
    return;
  }
  window.history.pushState({ index }, '', url.pathname + url.search + url.hash);
  store('sessionStorage', FURTHEST_KEY, String(index));
  notify();
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

/** The query string alone (Settings' tab). */
export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search);
}

/** The query string and fragment, which choose a document's view and section. */
export function useSearchAndHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.search + window.location.hash);
}

export function useNavigationListener(callback: () => void) {
  useEffect(() => subscribe(callback), [callback]);
}

export function AppLink({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };
  const search = useSearch();
  return <a href={projectHref(to, search)} onClick={handle} {...rest} />;
}
