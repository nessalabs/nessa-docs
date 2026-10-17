// Mixed-language reading, persisted UI selection, RTL layout and English fallback.
// Uses installed Playwright browsers only. Set PLAYWRIGHT_PATH to reuse a local launcher.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';
import {loadPlaywright, waitForDiagrams} from './lib.mjs';
import {startVerificationServer} from './server.mjs';
const server=await startVerificationServer(fileURLToPath(new URL('../fixtures/arabic-repo',import.meta.url)));
const browser=await loadPlaywright().chromium.launch();
const output=process.env.EVIDENCE_DIR;
if(output)mkdirSync(output,{recursive:true});
const errors=[];
try {
 const context=await browser.newContext({locale:'ar',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const page=await context.newPage(); page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(server.url); await page.locator('article.document').waitFor(); await waitForDiagrams(page);
 assert.equal(await page.locator('html').getAttribute('lang'),'ar');
 assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
 assert.ok(await page.locator('#sidebar').evaluate(e=>e.getBoundingClientRect().x>innerWidth/2));
 await page.locator('[data-view="details"]').first().click();
 const paragraphs=page.locator('.prose > p');
 assert.equal(await paragraphs.first().evaluate(e=>getComputedStyle(e).direction),'rtl');
 assert.equal(await paragraphs.nth(1).evaluate(e=>getComputedStyle(e).direction),'ltr');
 assert.equal(await page.locator('pre.code-block').evaluate(e=>getComputedStyle(e).direction),'ltr');
 assert.equal(await page.locator('pre.code-block').innerText(),'const endpoint = "https://example.com/api";\nconsole.log(endpoint);');
 assert.equal(await page.locator('th').first().getAttribute('dir'),'auto');
 // The outline must remain inside the viewport in both reading directions.
 async function checkOutline() {
  await page.locator('[data-action="outline"]').click();
  const menu=page.locator('.popover.outline');
  const bounds=await menu.evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}});
  assert.ok(bounds.left>=0 && bounds.right<=bounds.width,JSON.stringify(bounds));
  assert.equal(await menu.locator('a').first().evaluate(e=>e===document.activeElement),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-action="outline"]').evaluate(e=>e===document.activeElement),true);
 }
 await checkOutline();
 assert.match(await page.locator('.provenance-count').innerText(),/0 مصادر/);
 if(output)await page.screenshot({path:output+'/arabic-desktop.png'});
 const search=page.locator('#doc-search');await search.fill('قراءة');await page.locator('.search-result').first().waitFor();await search.press('Escape');
 await page.locator('.settings-link').click();await page.locator('[data-language-option="en"]').click();
 await page.reload();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
 assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
 await page.locator('.brand').click();await page.locator('article.document').waitFor();await checkOutline();
 await page.locator('.settings-link').click();
 await page.locator('[data-language-option="ar"]').click();
 assert.equal(await page.locator('[role="group"][aria-label="اللغة"]').getAttribute('aria-label'),'اللغة');
 await page.reload();await page.locator('[data-language-option="ar"]').waitFor();
 assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
 await page.locator('[data-settings-tab=general]').focus(); await page.keyboard.press('ArrowLeft'); await page.locator('[data-settings-tab=health][data-state=active]').waitFor(); await page.keyboard.press('ArrowRight'); await page.locator('[data-settings-tab=general][data-state=active]').waitFor();
 const settingsUrl=page.url();const homeUrl=await page.locator('.brand').getAttribute('href');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
 if(output)await page.screenshot({path:output+'/arabic-phone.png'});
 await page.goto(new URL(homeUrl,server.url).href);await page.locator('article.document').waitFor();await checkOutline();
 await page.goto(settingsUrl);await page.locator('[data-language-option="ar"]').waitFor();
 await page.locator('[data-sidebar-toggle]').click();await page.locator('#doc-search').waitFor({state:'visible'});await page.keyboard.press('Escape');
 assert.equal(await page.locator('[data-sidebar-toggle]').getAttribute('aria-expanded'),'false');
 await page.locator('[data-language-option="en"]').click();assert.equal(await page.locator('html').getAttribute('lang'),'en');
 await page.evaluate(()=>localStorage.setItem('nessa-state-browser:language','unknown'));await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),'ar');
 assert.deepEqual(errors,[]);console.log('Arabic desktop, phone, search, mixed direction, persistence, drawer focus and English fallback passed.');
}finally{try{await browser.close()}finally{server.stop()}}
