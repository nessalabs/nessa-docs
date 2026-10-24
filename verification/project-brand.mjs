// Project identity and history hit targets, independent of interface language.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';
import {loadPlaywright,waitForDiagrams} from './lib.mjs';
import {startVerificationServer} from './server.mjs';
const server=await startVerificationServer(fileURLToPath(new URL('../fixtures/details-repo',import.meta.url)));
let browser;
try {
 browser=await loadPlaywright().chromium.launch();
 for(const language of (process.env.WITH_ARABIC?['en','ar']:['en'])) for(const title of ['Architecture and behavior of the payment processing system','دليل النظام وشرح تفاصيل المشروع ومسار العمل']) {
  const context=await browser.newContext({locale:language,viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{localStorage.setItem('nessa-state-browser:sidebar','hidden');localStorage.setItem('nessa-state-browser:sidebar-width','350')});
  await page.route('**/api/catalog**',async route=>{const response=await route.fetch();const data=await response.json();if(data.documents)data.documents=data.documents.map(doc=>doc.parent===null?{...doc,title}:doc);await route.fulfill({response,json:data})});
  await page.goto(server.url);await page.locator('article.document').waitFor();await waitForDiagrams(page);
  assert.equal(await page.locator('.project-brand .brand-name').textContent(),title);
  assert.equal(await page.locator('.shell').getAttribute('data-sidebar'),'closed');
  assert.ok((await page.title()).endsWith(` · ${title} Docs`));
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.locator('[data-history]').evaluateAll(buttons=>buttons.every(button=>{const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
   if(process.env.EVIDENCE_DIR){mkdirSync(process.env.EVIDENCE_DIR,{recursive:true});await page.screenshot({path:`${process.env.EVIDENCE_DIR}/brand-${language}-${title.startsWith('Architecture')?'en':'ar'}-${width}.png`})}
   console.log(`PASS project title and history targets: ${language}, ${width}, ${title.slice(0,12)}`);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-target-id="gate"]').first().click();await page.locator('[data-history="back"]').click();await page.locator('.document-layout[data-doc-id="nessa"]').waitFor();await page.locator('[data-history="forward"]').click();await page.locator('.document-layout[data-doc-id="gate"]').waitFor();
  for(const path of ['/settings','/missing-route','/docs/not-present']) {
   const url=new URL(page.url());url.pathname=path;await page.goto(url.href);
   await page.waitForFunction(suffix=>document.title.endsWith(suffix),` · ${title} Docs`,{timeout:10000});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
}finally{try{await browser?.close()}finally{await server.stop()}}
