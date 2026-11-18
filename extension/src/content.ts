// The content script on github.com. It watches the address (GitHub moves
// between pages without reloading). On a page inside a Nessa Docs folder it
// leaves GitHub's view in place, shows an "Open in Docs" button, and starts the
// reader out of sight: the extension's own page in an iframe, which asks this
// script for the repository's files and reads them while the person is still
// on GitHub's view. The button then only uncovers it. "GitHub view" in the
// reader covers it again. An option opens docs folders in the reader at once.

import { docsPageOf, type DocsPage, type DocsRoot, pageUrl, sameRoot, STATE_DIRECTORY } from './github-location';
import { resolveDocs, type RepoReader } from './github-source';
import type { Answer, OpenFile, ReaderEvent, ReaderInit, Request } from './protocol';
import { READY } from './protocol';
import { readSettings } from './settings';
import { extensionApi } from './extension-api';

const api = extensionApi();
const READER_URL = api.runtime.getURL('reader.html');
const READER_ORIGIN = new URL(READER_URL).origin;
const OPEN_CLASS = 'nessa-docs-open';
const PREPARING_CLASS = 'nessa-docs-preparing';
/** Per tab: which view the person last chose for each docs root. */
const VIEW_KEY = 'nessa-docs:view';
type View = 'reader' | 'github';

interface Mounted {
  readonly reader: RepoReader;
  readonly frame: HTMLIFrameElement;
  readonly overlay: HTMLElement;
  port: MessagePort | null;
  /** False while the reader prepares out of sight behind GitHub's view. */
  shown: boolean;
}

let mounted: Mounted | null = null;
/** The docs root found for the current address, shown or not. */
let found: RepoReader | null = null;
let generation = 0;
let lastHref = '';
/** An address this script wrote itself, so the watcher does not treat it as navigation. */
let ownHref: string | null = null;

function rootKey(root: Pick<DocsRoot, 'owner' | 'repo' | 'prefix'>): string {
  return `${root.owner}/${root.repo}/${root.prefix}`.toLowerCase();
}

function readViews(): Record<string, View> {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, View] => entry[1] === 'reader' || entry[1] === 'github'));
  } catch {
    return {};
  }
}

function chosenView(root: DocsRoot): View | null {
  return readViews()[rootKey(root)] ?? null;
}

function chooseView(root: DocsRoot, view: View) {
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ ...readViews(), [rootKey(root)]: view }));
  } catch {
    // Storage blocked: the choice lasts until the next page.
  }
}

/** The page file an address inside this root shows, or undefined when the address is outside it. */
function fileAt(root: DocsRoot, page: DocsPage): string | null | undefined {
  if (!sameRoot(root, page)) return undefined;
  if (page.folderRest !== `${root.ref}/${root.prefix}${STATE_DIRECTORY}`) return undefined;
  if (!page.inside) return null;
  return page.inside.toLowerCase().endsWith('.md') ? `${STATE_DIRECTORY}/${page.inside}` : `${STATE_DIRECTORY}/${page.inside}/README.md`;
}

// ---------------------------------------------------------------- styles

function installStyles() {
  if (document.getElementById('nessa-docs-styles')) return;
  const style = document.createElement('style');
  style.id = 'nessa-docs-styles';
  style.textContent = `
    html.${OPEN_CLASS}, html.${OPEN_CLASS} body { overflow: hidden !important; }
    #nessa-docs-overlay { position: fixed; inset: 0; z-index: 2147483646; background: #f7f7f8; }
    /* Laid out (charts measure text) but unseen and untouchable. */
    #nessa-docs-overlay.${PREPARING_CLASS} { visibility: hidden; pointer-events: none; }
    @media (prefers-color-scheme: dark) { #nessa-docs-overlay { background: #111113; } }
    #nessa-docs-overlay iframe { display: block; width: 100%; height: 100%; border: 0; color-scheme: normal; }
    #nessa-docs-launcher {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483645;
      display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px;
      border: 0; border-radius: 999px; cursor: pointer;
      font: 500 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #18181b; color: #fafafa; box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
    }
    #nessa-docs-launcher:hover { background: #27272a; }
    #nessa-docs-launcher:focus-visible { outline: 2px solid #8b8bf5; outline-offset: 2px; }
    #nessa-docs-launcher b { font-weight: 650; letter-spacing: -0.01em; }
  `;
  (document.head ?? document.documentElement).append(style);
}

// ---------------------------------------------------------------- launcher

function showLauncher(reader: RepoReader | null) {
  document.getElementById('nessa-docs-launcher')?.remove();
  if (!reader) return;
  installStyles();
  const button = document.createElement('button');
  button.id = 'nessa-docs-launcher';
  button.type = 'button';
  button.title = 'Read this folder in Nessa Docs';
  const name = document.createElement('b');
  name.textContent = 'nessa';
  button.append(name, document.createTextNode('Open in Docs'));
  button.addEventListener('click', () => {
    chooseView(reader.root, 'reader');
    if (mounted?.reader === reader) show(mounted);
    else show(mount(reader, fileFromAddress(reader.root)));
  });
  // On <html>, not <body>: GitHub replaces <body> on some navigations.
  document.documentElement.append(button);
}

/** The page the address points at now, or `fallback` when it points outside this root. */
function currentFile(root: DocsRoot, fallback: string | null): string | null {
  const page = docsPageOf(location.pathname);
  const file = page ? fileAt(root, page) : undefined;
  return file === undefined ? fallback : file;
}

function fileFromAddress(root: DocsRoot): string | null {
  const page = docsPageOf(location.pathname);
  return page ? fileAt(root, page) ?? null : null;
}

// ---------------------------------------------------------------- overlay

function unmount() {
  if (!mounted) return;
  mounted.port?.close();
  mounted.overlay.remove();
  document.documentElement.classList.remove(OPEN_CLASS);
  mounted = null;
}

/** Starts the reader out of sight; `show` uncovers it. */
function mount(reader: RepoReader, file: string | null): Mounted {
  unmount();
  installStyles();
  const overlay = document.createElement('div');
  overlay.id = 'nessa-docs-overlay';
  overlay.className = PREPARING_CLASS;
  overlay.inert = true;
  overlay.setAttribute('aria-hidden', 'true');
  const frame = document.createElement('iframe');
  frame.title = 'Nessa Docs';
  frame.src = READER_URL;
  frame.allow = 'clipboard-write';
  overlay.append(frame);
  document.documentElement.append(overlay);
  const current: Mounted = { reader, frame, overlay, port: null, shown: false };
  mounted = current;

  const onReady = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== READER_ORIGIN || event.data !== READY) return;
    if (current.port) return; // one port per reader
    const channel = new MessageChannel();
    current.port = channel.port1;
    channel.port1.onmessage = (message) => void answer(current, message.data as Request | ReaderEvent);
    // The address may have moved while the iframe loaded; open where it points now.
    const init: ReaderInit = { type: 'init', root: reader.root, file: currentFile(reader.root, file) };
    frame.contentWindow?.postMessage(init, READER_ORIGIN, [channel.port2]);
  };
  window.addEventListener('message', onReady);
  const stop = new MutationObserver(() => {
    if (!overlay.isConnected) { window.removeEventListener('message', onReady); stop.disconnect(); }
  });
  stop.observe(document.documentElement, { childList: true });
  return current;
}

function show(current: Mounted) {
  current.shown = true;
  current.overlay.classList.remove(PREPARING_CLASS);
  current.overlay.inert = false;
  current.overlay.removeAttribute('aria-hidden');
  document.documentElement.classList.add(OPEN_CLASS);
  document.getElementById('nessa-docs-launcher')?.remove();
  current.frame.focus();
}

function hide(current: Mounted) {
  current.shown = false;
  current.overlay.classList.add(PREPARING_CLASS);
  current.overlay.inert = true;
  current.overlay.setAttribute('aria-hidden', 'true');
  document.documentElement.classList.remove(OPEN_CLASS);
}

async function answer(current: Mounted, message: Request | ReaderEvent) {
  if ('type' in message) {
    // Out of sight the reader follows the address; it never moves it.
    if (message.type === 'route') { if (current.shown) showAddress(current.reader.root, message.file); }
    else if (message.type === 'show-github') showGithub(current);
    return;
  }
  let reply: Answer;
  try {
    const value = message.op === 'list'
      ? await current.reader.list(message.path)
      : await current.reader.read(message.path, message.maxBytes);
    reply = { id: message.id, ok: true, value };
  } catch (error) {
    reply = { id: message.id, ok: false, message: error instanceof Error ? error.message : 'GitHub did not answer.' };
  }
  if (mounted === current) current.port?.postMessage(reply);
}

/** Keeps the address on the page the reader shows, so a copied link or a reload opens it. */
function showAddress(root: DocsRoot, file: string | null) {
  if (file === null) return;
  const url = pageUrl(root, file);
  if (url === location.href) return;
  try {
    history.replaceState(history.state, '', url);
    ownHref = location.href;
    lastHref = location.href;
  } catch {
    // The page refused; the address stays where it was.
  }
}

function showGithub(current: Mounted) {
  chooseView(current.reader.root, 'github');
  // GitHub's view still shows the page it last drew; the address may have moved
  // since. A reload draws what the address says (and prepares the reader again).
  if (ownHref !== null && location.href === ownHref) {
    unmount();
    location.reload();
    return;
  }
  hide(current);
  showLauncher(current.reader);
}

// ---------------------------------------------------------------- watching the address

async function arrive() {
  const page = docsPageOf(location.pathname);
  const current = ++generation;
  if (!page) {
    found = null;
    unmount();
    showLauncher(null);
    return;
  }
  // Moving within the docs already open: the reader follows.
  if (found) {
    const file = fileAt(found.root, page);
    if (file !== undefined) {
      if (mounted && mounted.port) mounted.port.postMessage({ type: 'open', file } satisfies OpenFile);
      return;
    }
  }
  // A different root: forget the old one, so coming back to it resolves it again.
  found = null;
  unmount();
  showLauncher(null);
  const settings = await readSettings(api);
  const resolution = await resolveDocs(page, settings.token);
  if (current !== generation) return;
  if (resolution.kind !== 'docs') {
    found = null;
    if (resolution.kind === 'failed') console.info(`[Nessa Docs] ${resolution.message}`);
    return;
  }
  found = resolution.reader;
  const file = fileAt(found.root, page) ?? null;
  const view = chosenView(found.root) ?? (settings.autoOpen ? 'reader' : 'github');
  const prepared = mount(found, file);
  if (view === 'reader') show(prepared);
  else showLauncher(found);
}

function watch() {
  if (location.href === lastHref) return;
  const own = ownHref !== null && location.href === ownHref;
  lastHref = location.href;
  if (own) return;
  ownHref = null;
  void arrive();
}

watch();
// GitHub navigates with pushState from its own scripts, which a content script
// cannot hear; checking the address is cheap and catches every way of moving.
setInterval(watch, 250);
window.addEventListener('popstate', watch);
document.addEventListener('turbo:load', watch);
