/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentResponse, DocumentSummary } from '../shared/api';
import type { Fetched, ProjectReads } from './project-opening/read-port';
import { ProjectContext } from './project-opening/project-context';
import { DocumentPage } from './document-page';

function summary(id: string, title: string): DocumentSummary {
  return {
    id,
    title,
    kind: 'guide',
    status: 'fixture',
    summary: title,
    parent: null,
    children: [],
    file: `docs/state/${id}.md`,
  };
}

function page(id: string, title: string, version = 'catalog'): DocumentResponse {
  return {
    version,
    document: summary(id, title),
    body: `# ${title}\n\nBody of ${title}.\n`,
    links: {},
    sources: [],
    diagramLinks: {},
    linkedOverviews: {},
    diagramDetails: [],
    breadcrumbs: [{ id, title }],
    children: [],
    issues: [],
    referenceRules: [],
    references: {},
    cards: {},
    work: null,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function reads(respond: (id: string, signal: AbortSignal | undefined) => Promise<Fetched<DocumentResponse>>): ProjectReads {
  return {
    catalog: () => Promise.reject(new Error('unused')),
    document: respond,
    search: () => Promise.reject(new Error('unused')),
    checker: () => Promise.reject(new Error('unused')),
    installChecker: () => Promise.reject(new Error('unused')),
    startModelCheck: () => Promise.reject(new Error('unused')),
    modelCheckRun: () => Promise.reject(new Error('unused')),
    cancelModelCheck: () => Promise.reject(new Error('unused')),
  };
}

describe('sidebar document navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
    }));
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });

  async function show(id: string, source: ProjectReads, catalogVersion: string) {
    await act(async () => {
      root.render(
        <ProjectContext.Provider value={source}>
          <DocumentPage id={id} catalogVersion={catalogVersion} onStaleCatalog={() => undefined} focusOnLoad={false} />
        </ProjectContext.Provider>,
      );
    });
  }

  it('keeps the open page visible until the next page is ready', async () => {
    const alpha = page('alpha', 'Alpha', 'keep');
    const beta = deferred<Fetched<DocumentResponse>>();
    const calls: string[] = [];
    const source = reads((id, signal) => {
      calls.push(id);
      if (id === 'alpha') return Promise.resolve({ kind: 'ok', value: alpha });
      return beta.promise.then((value) => {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        return value;
      });
    });
    await show('alpha', source, 'keep');
    expect(container.querySelector('#doc-title')?.textContent).toBe('Alpha');

    await show('beta', source, 'keep');
    expect(container.querySelector('[data-page-state="loading"]')).toBeNull();
    expect(container.querySelector('#doc-title')?.textContent).toBe('Alpha');
    expect(container.querySelector('.document-layout')?.getAttribute('aria-busy')).toBe('true');

    await act(async () => { beta.resolve({ kind: 'ok', value: page('beta', 'Beta', 'keep') }); });
    expect(container.querySelector('#doc-title')?.textContent).toBe('Beta');
    expect(container.querySelector('.document-layout')?.getAttribute('aria-busy')).toBeNull();
    expect(calls.filter((id) => id === 'alpha')).toEqual(['alpha']);
  });

  it('drops a slow answer once a newer page was chosen', async () => {
    const gates = new Map<string, ReturnType<typeof deferred<Fetched<DocumentResponse>>>>();
    const source = reads((id) => {
      const gate = deferred<Fetched<DocumentResponse>>();
      gates.set(id, gate);
      return gate.promise;
    });
    await show('alpha', source, 'race');
    await act(async () => { gates.get('alpha')?.resolve({ kind: 'ok', value: page('alpha', 'Alpha', 'race') }); });
    await show('beta', source, 'race');
    await show('gamma', source, 'race');
    await act(async () => { gates.get('gamma')?.resolve({ kind: 'ok', value: page('gamma', 'Gamma', 'race') }); });
    await act(async () => { gates.get('beta')?.resolve({ kind: 'ok', value: page('beta', 'Beta', 'race') }); });
    expect(container.querySelector('#doc-title')?.textContent).toBe('Gamma');
    expect(container.querySelector('.document-layout')?.getAttribute('data-doc-id')).toBe('gamma');
  });

  it('shows a page again without a loading gap or another read', async () => {
    let readsOfAlpha = 0;
    const beta = deferred<Fetched<DocumentResponse>>();
    const source = reads((id) => {
      if (id === 'alpha') {
        readsOfAlpha += 1;
        return Promise.resolve({ kind: 'ok', value: page('alpha', 'Alpha', 'return') });
      }
      return beta.promise;
    });
    await show('alpha', source, 'return');
    await show('beta', source, 'return');
    await act(async () => { beta.resolve({ kind: 'ok', value: page('beta', 'Beta', 'return') }); });
    const held = deferred<Fetched<DocumentResponse>>();
    const blocked = reads((id) => {
      if (id === 'alpha') {
        readsOfAlpha += 1;
        return held.promise;
      }
      return Promise.resolve({ kind: 'ok', value: page('beta', 'Beta', 'return') });
    });
    await show('alpha', blocked, 'return');
    expect(container.querySelector('[data-page-state="loading"]')).toBeNull();
    expect(container.querySelector('#doc-title')?.textContent).toBe('Alpha');
    expect(readsOfAlpha).toBe(1);
  });

  it('still says Loading when nothing has been shown yet', async () => {
    const gate = deferred<Fetched<DocumentResponse>>();
    await show('alpha', reads(() => gate.promise), 'first');
    expect(container.querySelector('[data-page-state="loading"]')?.textContent).toContain('Loading');
    expect(container.querySelector('#doc-title')).toBeNull();
  });
});

describe('reference peek', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
      dispatchEvent: () => false, onchange: null, addListener: () => undefined, removeListener: () => undefined,
    }));
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
    // jsdom has no dialog methods; these do what the browser does to `open`.
    for (const name of ['show', 'showModal'] as const) {
      HTMLDialogElement.prototype[name] ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    }
    Element.prototype.scrollTo ??= () => undefined;
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('shows a glossary term\'s meaning on hover, opens its entry on click, and closes when you click outside', async () => {
    const entry = { title: 'SDK', body: '## SDK\n\nSoftware development kit.\n', truncated: false, links: {}, file: 'docs/state/glossary.md', gist: 'Software development kit.' };
    const value: DocumentResponse = {
      ...page('alpha', 'Alpha', 'peek'),
      body: '# Alpha\n\nThe SDK sends.\n',
      referenceRules: [{ name: 'glossary', terms: ['SDK'] }],
      references: { 'glossary\u0000SDK': { rule: 'glossary', label: 'SDK', target: { kind: 'document', id: 'glossary', fragment: 'sdk' }, preview: entry } },
    };
    await act(async () => {
      root.render(
        <ProjectContext.Provider value={reads(() => Promise.resolve({ kind: 'ok', value }))}>
          <DocumentPage id="alpha" catalogVersion="peek" onStaleCatalog={() => undefined} focusOnLoad={false} />
        </ProjectContext.Provider>,
      );
    });
    const pill = container.querySelector<HTMLButtonElement>('[data-ref-rule="glossary"]');
    expect(pill?.textContent).toBe('SDK');
    const card = document.getElementById(pill?.getAttribute('aria-describedby') ?? '');
    expect(card?.getAttribute('role')).toBe('tooltip');
    expect(card?.textContent).toContain('Software development kit.');

    await act(async () => { pill?.click(); });
    const peek = container.querySelector<HTMLDialogElement>('dialog.reference-peek');
    expect(peek?.open).toBe(true);
    expect(peek?.textContent).toContain('Software development kit.');

    // A click inside the peek keeps it; a click on the page outside it closes it.
    const click = async (element: Element | null | undefined, dx = 0) => act(async () => {
      element?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
      element?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 10 + dx, clientY: 10 }));
    });
    await click(peek?.querySelector('.inspector-body'));
    expect(peek?.open).toBe(true);
    await click(container.querySelector('.prose p'), 30);
    expect(peek?.open).toBe(true);
    await click(container.querySelector('.prose p'));
    expect(peek?.open).toBe(false);
  });
});
