// Local standards-message test host. This is NOT ChatGPT/Codex verification.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { connectDocs, sampleFiles } from './mcp-protocol.mjs';
console.error('MCP browser: connect');
const client = await connectDocs(true);
const files = await sampleFiles();
let shown;
const calls = [];
const host = `<!doctype html><html><body style="margin:0"><iframe title="Nessa Docs app" sandbox="allow-scripts" src="/app" style="width:100%;height:850px;border:0"></iframe><script>
window.messages=[];
const frame=document.querySelector('iframe');
window.pushResult=(result)=>frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result},'*');
window.addEventListener('message',async(event)=>{
 if(event.source!==frame.contentWindow)return;
 const m=event.data;window.messages.push(m);
 const reply=(result)=>frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
 if(m.method==='ui/initialize')reply({protocolVersion:'2026-01-26',hostInfo:{name:'local-test-host',version:'1'},hostCapabilities:{serverTools:{},openLinks:{},updateModelContext:{text:{}}},hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:['inline']}});
 else if(m.method==='ui/notifications/initialized')window.pushResult(await(await fetch('/shown')).json());
 else if(m.method==='tools/call')reply(await(await fetch('/call',{method:'POST',body:JSON.stringify(m.params)})).json());
 else if(m.method==='ui/open-link')reply({isError:true});
 else if(m.id!==undefined)reply({});
});</script></body></html>`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/app') {
      const resource = await client.readResource({ uri: 'ui://nessa-docs/explorer-v1.html' });
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
      res.end(resource.contents[0].text);
    } else if (req.url === '/shown') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(shown)); }
    else if (req.url === '/call' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error('Request too large'); }
      const params = JSON.parse(body); calls.push(params.name);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(params.name === 'read_docs' ? await client.callTool(params) : { isError: true, content: [{type:'text',text:'App may only read documents.'}] }));
    } else { res.setHeader('Content-Type', 'text/html'); res.end(host); }
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
try {
  console.error('MCP browser: create');
  const created = await client.callTool({ name: 'replace_docs', arguments: { expectedRevision: 0, files } });
  assert(!created.isError, JSON.stringify(created));
  shown = await client.callTool({ name: 'show_docs', arguments: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const outcomes = [];
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    console.error('MCP browser: launch', name);
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      const externalResponses = [];
      page.on('response', response => { if (new URL(response.url()).origin !== url) externalResponses.push(response.url()); });
      page.on('pageerror', (error) => errors.push(String(error)));
      console.error('MCP browser: goto', url);
      await page.goto(url);
      console.error('MCP browser: loaded');
      const frame = page.frameLocator('iframe');
      await frame.getByRole('heading', {name:'Example store',exact:true}).waitFor().catch(async(error)=>{ console.error(errors, await page.evaluate(()=>window.messages)); throw error; });
      await frame.locator('figure[data-state=rendered] svg').first().waitFor();
      assert.equal(await page.frames()[1].evaluate(() => {try { return parent.document.title; } catch { return 'blocked'; }}), 'blocked');
      assert.equal(await page.frames()[1].evaluate(async (url) => {try { await fetch(url); return true; } catch { return false; }}, url + '/shown'), false);
      await frame.getByRole('button', {name:'Zoom in',exact:true}).first().click();
      await frame.getByRole('link', {name:'Open Submit or cancel an order',exact:true}).click();
      await frame.getByRole('heading', {name:'Submit or cancel an order',exact:true}).waitFor();
      assert(await page.evaluate(() => window.messages.some(message => message.method === 'ui/update-model-context' && JSON.parse(message.params.content[0].text).documentId === 'order-lifecycle')));
      await frame.getByRole('button', {name:'Details: Draft',exact:true}).waitFor();
      await frame.getByRole('button', {name:'Details: Draft',exact:true}).click();
      await frame.getByRole('dialog', {name:'Diagram details'}).waitFor();
      await frame.getByRole('button', {name:'Close details',exact:true}).click();
      await mkdir(new URL('./results/screenshots/',import.meta.url),{recursive:true});
      await page.screenshot({path:new URL(`./results/screenshots/mcp-demo-${name}.png`,import.meta.url).pathname,fullPage:true});
      await frame.getByRole('button',{name:'Example store',exact:true}).click();
      await frame.getByRole('button',{name:'Details',exact:true}).click();
      await frame.getByText('The order code asks a payment provider for a reply.',{exact:false}).waitFor();
      const revision = (await client.callTool({name:'read_docs',arguments:{}})).structuredContent.snapshot.revision;
      const malicious = files.map((file, i) => i ? file : {...file, markdown:file.markdown + "\n<script>window.__injected=1</script>\n\n<img src=\"https://evil.invalid/x\" onerror=\"window.__injected=2\">\n\n[bad](javascript:alert(1))\n\n[External](https://example.com)\n\n```mermaid\n%%{init: {\"securityLevel\": \"loose\"}}%%\nflowchart LR\n A[\"<img src='https://evil.invalid/chart' onerror='window.__injected=3'>\"] --> B\n```\n"});
      const changed = await client.callTool({name:'replace_docs',arguments:{expectedRevision:revision,files:malicious}});
      assert(!changed.isError);
      await frame.getByRole('button',{name:'Refresh',exact:true}).click();
      await frame.getByText(`Revision ${revision+1} · session only`,{exact:true}).waitFor();
      assert.equal(await frame.locator('script').count(), 1, 'Only the bundled script exists');
      await page.frames()[1].waitForFunction(() => [...document.querySelectorAll('figure.diagram')].every(figure => figure.dataset.state !== 'rendering'));
      assert.equal(await frame.locator('.prose > img, img[onerror], img[onload]').count(), 0, 'Markdown cannot create images; Mermaid sanitizer removes executable image handlers');
      assert.deepEqual(externalResponses, [], 'CSP prevents external image and data connections');
      assert.equal(await page.frames()[1].evaluate(() => window.__injected), undefined);
      await frame.getByRole('link',{name:/External/}).click();
      await frame.getByRole('alert').filter({hasText:'host refused'}).waitFor();
      // Old notifications must not undo an accepted refresh.
      await page.evaluate((result) => window.pushResult(result), shown);
      assert(await frame.getByText(`Revision ${revision+1} · session only`,{exact:true}).isVisible());
      const forged = structuredClone(changed); forged.structuredContent.snapshot.scope = '00000000-0000-4000-8000-000000000000';
      await page.evaluate((result) => window.pushResult(result), forged);
      await frame.getByRole('alert').filter({hasText:'different document session'}).waitFor();
      await page.setViewportSize({width:390,height:850});
      assert(await page.frames()[1].evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await mkdir(new URL('./results/screenshots/',import.meta.url),{recursive:true});
      await page.screenshot({path:new URL(`./results/screenshots/mcp-${name}.png`,import.meta.url).pathname,fullPage:true});
      assert.deepEqual(errors, []);
      outcomes.push({engine:name,ok:true,checks:['opaque sandbox handshake','parent DOM and network denied','model selection context','chart render/zoom/navigation','details','chart explanation','refresh','HTML injection','host refusal','stale result','cross-session refusal','mobile width']});
    } finally { await browser.close(); }
  }
  assert(calls.every((name)=>name==='read_docs'));
  await writeFile(new URL('./results/mcp-browser.json',import.meta.url), JSON.stringify(outcomes,null,2));
  console.log(JSON.stringify(outcomes));
} finally { server.closeAllConnections(); await new Promise((resolve)=>server.close(resolve)); await client.close(); }
