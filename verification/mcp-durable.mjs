// Restart + standalone compatibility through the built real stdio server.
// All content is synthetic; every store is under an owned temporary directory.
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startVerificationServer } from './server.mjs';
import { loadPlaywright, waitForDocument } from './lib.mjs';
import { connectDocs, sampleFiles } from './mcp-protocol.mjs';

const directory = await mkdtemp(join(tmpdir(), 'nessa-docs-mcp-durable-'));
const store = join(directory, 'store');
let client;
async function runNode(args, env = {}) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stdout.on('data', value => { out += value; }); child.stderr.on('data', value => { err += value; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 0, err || out); return out;
}
try {
  const files = await sampleFiles();
  client = await connectDocs(true, undefined, store);
  const first = await client.callTool({ name: 'replace_docs', arguments: { expectedRevision: 0, files } });
  assert(!first.isError, JSON.stringify(first));
  const before = first.structuredContent.snapshot;
  await assert.rejects(connectDocs(true, undefined, store), 'A second real MCP process must not acquire the same store');
  assert.equal(before.storage.kind, 'durable'); assert.equal(before.storage.status, 'synced');
  await client.close(); client = undefined;
  client = await connectDocs(true, undefined, store);
  const read = await client.callTool({ name: 'read_docs', arguments: {} });
  assert(!read.isError, JSON.stringify(read));
  assert.equal(read.structuredContent.snapshot.scope, before.scope);
  assert.equal(read.structuredContent.snapshot.revision, 1);
  assert.deepEqual(read.structuredContent.snapshot.files, files);
  const stale = await client.callTool({ name: 'replace_docs', arguments: { expectedRevision: 0, files } }); assert(stale.isError);
  const second = await client.callTool({ name: 'replace_docs', arguments: { expectedRevision: 1, files: files.map((file, i) => i ? file : { ...file, markdown: file.markdown + '\nSynthetic restart update.\n' }) } });
  assert(!second.isError, JSON.stringify(second));
  const snapshot = second.structuredContent.snapshot;
  const validation = JSON.parse(await runNode(['dist/server/server/project-opening/validate-cli.js', '--project', snapshot.storage.projectPath]));
  assert(validation);
  assert.equal((await readdir(join(store, 'generations'))).length, 2);
  await client.close(); client = undefined;
  const standalone = await startVerificationServer(snapshot.storage.projectPath);
  try {
    for (const engine of ['chromium','webkit']) {
      const browser = await loadPlaywright()[engine].launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${standalone.url}/docs/example-store`);
        await waitForDocument(page,'example-store');
        await page.locator('figure[data-state=rendered] svg').first().waitFor();
        await page.getByRole('link',{name:'Open Submit or cancel an order',exact:true}).click();
        await waitForDocument(page,'order-lifecycle');
        await page.locator('figure[data-state=rendered] svg').first().waitFor();
      } finally { await browser.close(); }
    }
  } finally { const exit=new Promise(resolve=>standalone.child.once('exit',resolve)); standalone.stop(); await exit; }
  // The browser suite starts with a different fresh store and restarts no user host.
  await runNode(['verification/mcp-browser.mjs'], { NESSA_DOCS_TEST_STORE: join(directory, 'browser-store') });
  const result = { ok: true, checks: ['real stdio restart restores scope/revision/raw Markdown', 'stale update refusal after restart', 'durable update', 'standalone validator accepts saved generation','standalone Chromium/WebKit charts work after MCP process stops', 'bounded generations', 'durable UI in Chromium/WebKit'] };
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(new URL('./results/mcp-durable.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await client?.close(); await rm(directory, { recursive: true, force: true }); }
