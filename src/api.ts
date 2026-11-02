// The browser's port to the local API. Outcomes are typed; nothing here
// interprets document IDs or paths — the server owns those rules.

import type { ProjectOutcome, FolderPickOutcome, FolderPickerStatus } from '../shared/projects';
import type { Fetched, ProjectSource } from './project-opening/read-port';
import type { CatalogResponse, DocumentResponse, SearchResponse, UnknownDocumentResponse } from '../shared/api';
import type { CheckerStatus, ModelCheckRunView } from '../shared/model-check';

async function getJson<T>(path: string, signal: AbortSignal | undefined, request: typeof fetch): Promise<Fetched<T>> {
  let response: Response;
  try {
    response = await request(path, { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: 'failed', message: 'The local server did not answer. Is `npm start` still running?' };
  }
  if (response.status === 404) {
    const body = (await response.json().catch(() => null)) as UnknownDocumentResponse | null;
    if (body?.error === 'unknown-document') return { kind: 'unknown-document', value: body };
    return { kind: 'failed', message: `Not found: ${path}` };
  }
  if (response.status === 409) return { kind: 'failed', message: 'This project is no longer open. Open its folder again.' };
  if (!response.ok) return { kind: 'failed', message: `The server answered ${response.status} for ${path}` };
  try { return { kind: 'ok', value: (await response.json()) as T }; }
  catch (error) {
    if (signal?.aborted) throw error;
    return { kind: 'failed', message: 'The server returned an unreadable response. Try again.' };
  }
}

/** Browser HTTP adapter. Renderers consume ProjectReads without host selection. */
export function createHttpProjectSource(request: typeof fetch): ProjectSource {
  const projectRequest = async (path: string, init: RequestInit): Promise<ProjectOutcome> => {
    try {
      const response = await request(path, init);
      const value = await response.json() as ProjectOutcome;
      if (value.kind === 'opened' || value.kind === 'welcome' || value.kind === 'refused') return value;
      return { kind: 'refused', error: 'project-read-failed', message: `The server refused the request (${response.status}). Reload the page and try again.`, issues: [] };
    } catch (error) {
      if (init.signal?.aborted) throw error;
      return { kind: 'refused', error: 'project-read-failed', message: 'The local server did not answer. Is npm start still running?', issues: [] };
    }
  };
  return {
    current: (id, signal) => projectRequest(`/api/projects/current${id === null ? '' : `?project=${encodeURIComponent(id)}`}`, { signal }),
    open: (input, signal) => projectRequest('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal }),
    async pickerStatus(signal) {
      try { const response = await request('/api/projects/picker', { signal }); const value = await response.json() as FolderPickerStatus; if (value.kind === 'available' || (value.kind === 'unsupported' && typeof value.message === 'string')) return value; return { kind: 'unsupported', message: 'Folder browsing is unavailable. Paste the project folder path.' }; }
      catch (error) { if (signal?.aborted) throw error; return { kind: 'unsupported', message: 'Folder browsing is unavailable. Paste the project folder path.' }; }
    },
    async chooseFolder(signal) {
      try {
        const response = await request('/api/projects/pick-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal });
        if (!response.ok) return { kind: 'failed', message: 'The folder chooser request was refused. Reload the page or paste the path.' };
        const value = await response.json() as FolderPickOutcome;
        if (value.kind === 'cancelled' || (value.kind === 'selected' && typeof value.path === 'string') || (['busy', 'failed', 'timed-out', 'unsupported'].includes(value.kind) && 'message' in value && typeof value.message === 'string')) return value;
        return { kind: 'failed', message: 'The folder chooser returned no folder. Try again or paste the path.' };
      } catch (error) {
        if (signal?.aborted) throw error;
        return { kind: 'failed', message: 'The folder chooser could not answer. Try again or paste the path.' };
      }
    },
    reads(id) {
      const scoped = (path: string) => `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(id)}`;
      return {
        catalog: (signal) => getJson<CatalogResponse>(scoped('/api/catalog'), signal, request),
        document: (doc, signal) => getJson<DocumentResponse>(scoped(`/api/documents/${encodeURIComponent(doc)}`), signal, request),
        search: (query, signal) => getJson<SearchResponse>(scoped(`/api/search?q=${encodeURIComponent(query)}`), signal, request),
        checker: (signal) => getJson<CheckerStatus>('/api/checker', signal, request),
        installChecker: (signal) => postJson<CheckerStatus>('/api/checker/install', 'POST', signal, request),
        startModelCheck: (doc, signal) => postJson<ModelCheckRunView>(scoped(`/api/documents/${encodeURIComponent(doc)}/model-check`), 'POST', signal, request),
        modelCheckRun: (runId, signal) => getJson<ModelCheckRunView>(scoped(`/api/model-checks/${encodeURIComponent(runId)}`), signal, request),
        cancelModelCheck: (runId, signal) => postJson<ModelCheckRunView>(scoped(`/api/model-checks/${encodeURIComponent(runId)}`), 'DELETE', signal, request),
      };
    },
    checker: (signal) => getJson<CheckerStatus>('/api/checker', signal, request),
    installChecker: (signal) => postJson<CheckerStatus>('/api/checker/install', 'POST', signal, request),
  };
}

async function postJson<T>(path: string, method: 'POST' | 'DELETE', signal: AbortSignal | undefined, request: typeof fetch): Promise<Fetched<T>> {
  let response: Response;
  try {
    response = await request(path, {
      method,
      signal,
      headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: 'failed', message: 'The local server did not answer. Is `npm start` still running?' };
  }
  if (!response.ok) return { kind: 'failed', message: `The server answered ${response.status} for ${path}` };
  try { return { kind: 'ok', value: (await response.json()) as T }; }
  catch (error) {
    if (signal?.aborted) throw error;
    return { kind: 'failed', message: 'The server returned an unreadable response. Try again.' };
  }
}
