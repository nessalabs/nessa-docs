import { readFile } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createDocsMcpServer } from './server.js';
import { DocumentBundle } from './bundle.js';
import { DurableBundleStore } from './durable-store.js';

// Authority is selected once by the operator. Signal handling starts before
// startup I/O, so graceful shutdown drains initialization and storage work too.
const configured = process.env.NESSA_DOCS_STORE;
let store: DurableBundleStore | undefined;
let server: ReturnType<typeof createDocsMcpServer> | undefined;
let stopping = false;
let stopped!: () => void;
const closed = new Promise<void>((resolve) => { stopped = resolve; });
const stop = () => { stopping = true; if (server) void server.close().then(stopped, stopped); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
async function run() {
  const html = await readFile(new URL('../../../mcp/mcp.html', import.meta.url), 'utf8');
  if (stopping) return;
  store = configured === undefined ? undefined : await DurableBundleStore.open(configured);
  if (stopping) return;
  const bundle = store ? await DocumentBundle.open(store) : new DocumentBundle();
  if (stopping) return;
  server = createDocsMcpServer(html, bundle);
  server.server.onclose = stopped;
  await server.connect(new StdioServerTransport());
  if (stopping) await server.close(); else await closed;
}
try { await run(); }
catch (error) { if (!stopping) throw error; }
finally {
  try { try { await server?.close(); } finally { await store?.close(); } }
  finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
}
