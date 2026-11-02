// A real SDK stdio client exercises the built server, with and without Apps.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const root = new URL('../', import.meta.url);
export async function connectDocs(ui = true, supportedProtocolVersions, storeDirectory) {
  const client = new Client({ name: 'nessa-docs-verifier', version: '1.0.0' }, {
    capabilities: ui ? { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } : {},
    ...(supportedProtocolVersions ? { supportedProtocolVersions } : {}),
  });
  try { await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/server/server/mcp/main.js'], cwd: root.pathname, stderr: 'pipe', ...(storeDirectory ? { env: { NESSA_DOCS_STORE: storeDirectory } } : {}) })); } catch (error) { await client.close(); throw error; }
  return client;
}
export async function sampleFiles() {
  return Promise.all(['README.md', 'order-lifecycle.md', 'payment-contract.md'].map(async (name) => ({ path: `docs/state/${name}`, markdown: await readFile(new URL(`../examples/store/docs/state/${name}`, import.meta.url), 'utf8') })));
}
export async function verifyProtocol() {
  for (const ui of [false, true]) {
    const client = await connectDocs(ui);
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name).sort(), ['check_model', 'read_docs', 'replace_docs', 'show_docs']);
      const checker = await client.callTool({ name: 'check_model', arguments: { action: 'status' } });
      assert.equal(checker.isError, undefined, JSON.stringify(checker));
      assert.ok(['not-installed', 'ready', 'failed', 'downloading'].includes(checker.structuredContent.state));
      const missing = await client.callTool({ name: 'check_model', arguments: {} });
      assert.equal(missing.isError, true);
      const show = tools.find((tool) => tool.name === 'show_docs');
      assert.equal(show._meta?.ui?.resourceUri, 'ui://nessa-docs/explorer-v1.html');
      assert.deepEqual(show._meta?.['openai/ui']?.entrypoints, [{ type: 'thread' }]);
      assert.equal(show.title, 'Nessa Docs');
      const empty = await client.callTool({ name: 'show_docs', arguments: {} });
      assert.equal(empty.isError, undefined);
      assert.deepEqual(empty.structuredContent, { snapshot: null });
      const created = await client.callTool({ name: 'replace_docs', arguments: { expectedRevision: 0, files: await sampleFiles() } });
      assert.equal(created.isError, undefined, JSON.stringify(created));
      assert.equal(created.structuredContent.snapshot.revision, 1);
      const shown = await client.callTool({ name: 'show_docs', arguments: {} });
      assert.deepEqual(shown.structuredContent, created.structuredContent);
      const conflict = await client.callTool({ name: 'replace_docs', arguments: { expectedRevision: 0, files: await sampleFiles() } });
      assert.equal(conflict.isError, true);
      const resource = await client.readResource({ uri: show._meta.ui.resourceUri });
      assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
      assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, []);
      assert(resource.contents[0].text.includes('<script'));
    } finally { await client.close(); }
  }
  console.log(JSON.stringify({ check: 'MCP stdio: negotiation, schema, create, show, conflict, resource CSP, text fallback', ok: true }));
}
if (process.argv[1] === new URL(import.meta.url).pathname) await verifyProtocol();
