// A real SDK stdio client exercises the built server, with and without Apps.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const root = new URL('../', import.meta.url);
export async function connectDocs(ui = true, supportedProtocolVersions) {
  const client = new Client({ name: 'nessa-docs-verifier', version: '1.0.0' }, {
    capabilities: ui ? { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } : {},
    ...(supportedProtocolVersions ? { supportedProtocolVersions } : {}),
  });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/server/server/mcp/main.js'], cwd: root.pathname, stderr: 'pipe' }));
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
      assert.deepEqual(tools.map((tool) => tool.name).sort(), ['read_docs', 'replace_docs', 'show_docs']);
      const show = tools.find((tool) => tool.name === 'show_docs');
      assert.equal(Boolean(show._meta?.ui?.resourceUri), ui);
      const empty = await client.callTool({ name: 'show_docs', arguments: {} });
      assert.equal(empty.isError, true);
      const created = await client.callTool({ name: 'replace_docs', arguments: { expectedRevision: 0, files: await sampleFiles() } });
      assert.equal(created.isError, undefined, JSON.stringify(created));
      assert.equal(created.structuredContent.snapshot.revision, 1);
      const shown = await client.callTool({ name: 'show_docs', arguments: {} });
      assert.deepEqual(shown.structuredContent, created.structuredContent);
      const conflict = await client.callTool({ name: 'replace_docs', arguments: { expectedRevision: 0, files: await sampleFiles() } });
      assert.equal(conflict.isError, true);
      if (ui) {
        const resource = await client.readResource({ uri: show._meta.ui.resourceUri });
        assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
        assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains, []);
        assert(resource.contents[0].text.includes('<script'));
      } else assert.equal((await client.listResources()).resources.length, 0);
    } finally { await client.close(); }
  }
  console.log(JSON.stringify({ check: 'MCP stdio: negotiation, schema, create, show, conflict, resource CSP, text fallback', ok: true }));
}
if (process.argv[1] === new URL(import.meta.url).pathname) await verifyProtocol();
