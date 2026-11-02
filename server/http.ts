// The request handler owns fixed project-opening and read-only document routes.
// Opening paths are admitted separately; reads carry handles, IDs and search text.
// Static files are served from a map built once at startup.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDocumentId } from './document.js';
import type { Catalog } from './catalog.js';
import type { FolderPicker } from './project-opening/folder-picker.js';
import type { Projects } from './project-opening/projects.js';
import type { RepositoryFiles } from './files.js';
import { catalogResponse, documentResponse, MAX_QUERY_LENGTH, searchResponse } from './responses.js';
import type { ModelCheckService } from './model-check/service.js';

export interface StaticAsset {
  readonly body: Uint8Array;
  readonly contentType: string;
}

export interface HandlerDependencies {
  readonly loadCatalog: (root: string) => Promise<Catalog>;
  readonly projects: Projects;
  readonly folderPicker: FolderPicker;
  readonly exampleRoot: string;
  readonly files: RepositoryFiles;
  /** URL path (e.g. `/assets/index-abc.js`) → asset. Must contain `/index.html`. */
  readonly assets: ReadonlyMap<string, StaticAsset>;
  /** Accepted Host header values; anything else is refused (DNS-rebinding guard). */
  readonly allowedHosts: ReadonlySet<string>;
  /** Optional rule checker. Absent in tests that do not exercise it. */
  readonly modelChecks?: ModelCheckService;
}

export interface Reply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array | string;
}

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
} as const;

/**
 * The built client's entry script, read from the served index.html, e.g.
 * `/assets/index-RFM0ET0L.js`. A page compares it with its own entry to learn
 * that the site was rebuilt since it loaded (its lazy chunks are gone).
 */
export function clientEntry(assets: ReadonlyMap<string, StaticAsset>): string | null {
  const index = assets.get('/index.html');
  if (index === undefined) return null;
  const match = /<script[^>]*\ssrc="(\/assets\/[^"]+\.js)"/.exec(new TextDecoder().decode(index.body));
  return match?.[1] && assets.has(match[1]) ? match[1] : null;
}

export async function handleRequest(
  dependencies: HandlerDependencies,
  request: HttpRequest,
): Promise<Reply> {
  if (request.host === undefined || !dependencies.allowedHosts.has(request.host.toLowerCase())) {
    return text(421, 'Misdirected request: this server only answers on its loopback address.');
  }

  let url: URL;
  try {
    url = new URL(request.url, 'http://localhost');
  } catch {
    return text(400, 'Bad request');
  }
  const path = url.pathname;

  const modelChecks = dependencies.modelChecks;
  if (modelChecks && request.method === 'GET' && path === '/api/checker') {
    return json(200, await modelChecks.status());
  }
  if (modelChecks && request.method === 'POST' && path === '/api/checker/install') {
    const refusal = openingGuard(dependencies, request);
    if (refusal) return refusal;
    return json(200, await modelChecks.install(request.signal ?? new AbortController().signal));
  }
  if (modelChecks && path.startsWith('/api/model-checks/')) {
    const runId = path.slice('/api/model-checks/'.length);
    if (request.method === 'GET') {
      const run = modelChecks.read(runId);
      return run ? json(200, run) : json(404, { error: 'unknown-run' });
    }
    if (request.method === 'DELETE') {
      if (request.origin !== `http://${request.host?.toLowerCase()}`) return json(403, { error: 'origin-refused' });
      const run = modelChecks.cancel(runId);
      return run ? json(200, run) : json(404, { error: 'unknown-run' });
    }
  }
  const modelCheckMatch = modelChecks && request.method === 'POST' ? /^\/api\/documents\/([^/]+)\/model-check$/.exec(path) : null;
  if (modelCheckMatch && modelChecks) {
    const refusal = openingGuard(dependencies, request);
    if (refusal) return refusal;
    const projectId = url.searchParams.get('project');
    const selection = dependencies.projects.read(projectId);
    if (selection.kind !== 'selected') return json(409, { error: selection.kind === 'welcome' ? 'no-project' : 'project-unavailable' });
    let id: string;
    try { id = decodeURIComponent(modelCheckMatch[1] ?? ''); } catch { return json(404, { error: 'unknown-document' }); }
    if (!isDocumentId(id)) return json(404, { error: 'unknown-document', id });
    return json(200, await modelChecks.start(selection.root, id));
  }
  if (request.method === 'POST' && (path === '/api/projects' || path === '/api/projects/pick-folder')) {
    const refusal = openingGuard(dependencies, request);
    if (refusal) return refusal;
    if (request.body === undefined || Buffer.byteLength(request.body) > MAX_OPEN_BODY) return json(413, { error: 'body-too-large' });
    let input: unknown;
    try { input = JSON.parse(request.body); } catch { return json(400, { error: 'invalid-json' }); }
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return json(400, { error: 'invalid-request' });
    if (path === '/api/projects/pick-folder') return json(200, await dependencies.folderPicker.choose(request.signal ?? new AbortController().signal));
    const fields = input as Record<string, unknown>;
    const example = Object.hasOwn(fields, 'example') && fields.example === true;
    const outcome = await dependencies.projects.open(example ? dependencies.exampleRoot : Object.hasOwn(fields, 'path') ? fields.path : undefined);
    return json(outcome.kind === 'opened' ? 200 : 422, outcome);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');
  const projectId = url.searchParams.get('project');
  if (path === '/api/projects/picker') return json(200, dependencies.folderPicker.status);
  if (path === '/api/projects/current') return json(200, await dependencies.projects.current(projectId));
  if (path === '/api/health') return json(200, { ok: true, client: clientEntry(dependencies.assets) });
  const selection = dependencies.projects.read(projectId);
  const projectRoute = path === '/api/catalog' || path === '/api/search' || path.startsWith('/api/documents/');
  if (projectRoute && selection.kind !== 'selected') return json(409, { error: selection.kind === 'welcome' ? 'no-project' : 'project-unavailable' });
  const readCatalog = () => dependencies.loadCatalog(selection.kind === 'selected' ? selection.root : '');
  if (path === '/api/catalog') return json(200, catalogResponse(await readCatalog()));
  if (path === '/api/search') {
    const query = url.searchParams.get('q') ?? '';
    if (query.length > MAX_QUERY_LENGTH) return json(400, { error: 'query-too-long', max: MAX_QUERY_LENGTH });
    return json(200, searchResponse(await readCatalog(), query));
  }
  if (path.startsWith('/api/documents/')) {
    let id: string;
    try {
      id = decodeURIComponent(path.slice('/api/documents/'.length));
    } catch {
      return json(404, { error: 'unknown-document', id: '', rejected: [] });
    }
    if (!isDocumentId(id)) return json(404, { error: 'unknown-document', id, rejected: [] });
    const response = await documentResponse(await readCatalog(), id, dependencies.files);
    return json('error' in response ? 404 : 200, response);
  }
  if (path.startsWith('/api/')) return json(404, { error: 'unknown-endpoint' });

  const asset = dependencies.assets.get(path);
  if (asset !== undefined && path !== '/index.html') {
    return {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        'Content-Type': asset.contentType,
        'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
      body: asset.body,
    };
  }
  if (path.startsWith('/assets/')) return text(404, 'Not found');
  // Every other path is an application route; the client decides 404s for documents.
  const index = dependencies.assets.get('/index.html');
  if (index === undefined) return text(503, 'The client is not built. Run `npm run build`.');
  return {
    status: 200,
    headers: { ...SECURITY_HEADERS, 'Content-Type': index.contentType, 'Cache-Control': 'no-cache' },
    body: index.body,
  };
}

export interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly host: string | undefined;
  readonly origin?: string;
  readonly contentType?: string;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

export const MAX_OPEN_BODY = 8 * 1024;

/** P4: admission is checked before the Node adapter consumes an opening body. */
export function openingGuard(dependencies: Pick<HandlerDependencies, 'allowedHosts'>, request: HttpRequest): Reply | null {
  if (request.host === undefined || !dependencies.allowedHosts.has(request.host.toLowerCase())) return text(421, 'Misdirected request');
  if (request.origin !== `http://${request.host.toLowerCase()}`) return json(403, { error: 'origin-refused' });
  if (request.contentType?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return json(415, { error: 'json-required' });
  return null;
}

export function nodeHandler(dependencies: HandlerDependencies) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const input: HttpRequest = {
      method: request.method ?? 'GET', url: request.url ?? '/', host: request.headers.host,
      origin: typeof request.headers.origin === 'string' ? request.headers.origin : undefined,
      contentType: request.headers['content-type'],
    };
    const controller = new AbortController();
    const disconnected = () => { if (!response.writableFinished) controller.abort(); };
    request.once('aborted', disconnected); response.once('close', disconnected);
    let reply: Reply;
    try {
      const path = new URL(input.url, 'http://localhost').pathname;
      const opening = input.method === 'POST' && (path === '/api/projects' || path === '/api/projects/pick-folder' || path === '/api/checker/install' || /\/api\/documents\/[^/]+\/model-check$/.test(path));
      const refused = opening ? openingGuard(dependencies, input) : null;
      if (refused) reply = refused;
      else if (opening) {
        const body = await readOpeningBody(request);
        reply = body.kind === 'too-large' ? json(413, { error: 'body-too-large' }) : await handleRequest(dependencies, { ...input, body: body.text, signal: controller.signal });
      } else reply = await handleRequest(dependencies, input);
    } catch (error) {
      console.error('request failed', request.url, error);
      reply = json(500, { error: 'internal-error' });
    }
    request.off('aborted', disconnected); response.off('close', disconnected);
    if (controller.signal.aborted) return;
    response.writeHead(reply.status, reply.headers);
    response.end(request.method === 'HEAD' ? undefined : reply.body);
  };
}

function readOpeningBody(request: IncomingMessage): Promise<{ readonly kind: 'body'; readonly text: string } | { readonly kind: 'too-large' }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const cleanup = () => { request.off('data', data); request.off('end', end); request.off('error', error); };
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OPEN_BODY) { cleanup(); request.resume(); resolve({ kind: 'too-large' }); }
      else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve({ kind: 'body', text: Buffer.concat(chunks).toString('utf8') }); };
    const error = (cause: Error) => { cleanup(); reject(cause); };
    request.on('data', data); request.on('end', end); request.on('error', error);
  });
}

function json(status: number, value: unknown): Reply {
  return {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(value),
  };
}

function text(status: number, message: string): Reply {
  // Never cached: a missing chunk or a refusal must not outlive the build or request that caused it.
  return { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: message };
}
