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
    diagramDetails: [],
    breadcrumbs: [{ id, title }],
    children: [],
    issues: [],
    referenceRules: [],
    references: {},
    cards: {},
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
