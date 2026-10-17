// Mixed authored list directions and child navigation in both UI languages.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadPlaywright} from './lib.mjs';
import {startVerificationServer} from './server.mjs';
const server=await startVerificationServer(fileURLToPath(new URL('../fixtures/details-repo',import.meta.url)));
let browser;
try {
 browser=await loadPlaywright().chromium.launch();
 for(const language of ['ar','en']) for(const width of [718,390]) {
  const page=await browser.newPage({locale:language,viewport:{width,height:988},reducedMotion:'reduce'});
  await page.route('**/api/documents/**',async route=>{
   const response=await route.fetch();
   if(!response.headers()['content-type']?.includes('application/json'))return route.fulfill({response});
   const data=await response.json();
   if(typeof data.body==='string')data.body+='\n\n- English item\n- عنصر عربي\n  - Nested English item\n  - عنصر متداخل\n\n1. Ordered item\n2. عنصر مرتب\n\n- [ ] English task\n- [x] مهمة عربية\n';
   await route.fulfill({response,json:data});
  });
  await page.goto(server.url+'/?view=details');await page.locator('article.document').waitFor();

  const lists=await page.locator('.prose ul,.prose ol').evaluateAll(elements=>elements.map(e=>{
   const s=getComputedStyle(e),r=e.getBoundingClientRect();
   return {left:parseFloat(s.paddingLeft),right:parseFloat(s.paddingRight),items:[...e.children].map(li=>{const b=li.getBoundingClientRect();return {direction:getComputedStyle(li).direction,left:b.left-r.left,right:r.right-b.right}})};
  }));
  assert.ok(lists.length>=4);
  for(const list of lists){assert.ok(list.left>=22&&list.right>=22);for(const item of list.items)assert.ok(item.left>=21&&item.right>=21);}
  assert.ok(lists.some(list=>list.items.some(item=>item.direction==='rtl')));
  assert.ok(lists.some(list=>list.items.some(item=>item.direction==='ltr')));
  const arrow=page.locator('.child-chevron').first();
  assert.equal(await arrow.evaluate(e=>getComputedStyle(e).transform),language==='ar'?'matrix(-1, 0, 0, 1, 0, 0)':'none');
  const link=page.locator('.child-row').first();await page.keyboard.press('Tab');await link.focus();
  await page.waitForFunction(({rtl})=>getComputedStyle(document.querySelector('.child-chevron')).transform===(rtl?'matrix(-1, 0, 0, 1, -2, 0)':'matrix(1, 0, 0, 1, 2, 0)'),{rtl:language==='ar'},{timeout:5000});
  const target=await link.getAttribute('href');const title=await link.locator('.child-title').innerText();await page.keyboard.press('Enter');await page.waitForURL(url=>url.pathname===new URL(target,server.url).pathname,{timeout:10000});
  await page.getByRole('heading',{name:title,exact:true,level:1}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
  console.log(`PASS lists, arrow, keyboard child navigation: ${language}, ${width}`);await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
 }
}finally{try{await browser?.close()}finally{await server.stop()}}
