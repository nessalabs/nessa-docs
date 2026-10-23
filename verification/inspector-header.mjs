// Authored inspector text uses its own direction and shares the body's
// content edges. Title and close share row one; subtitle and Badge share row two.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';
import {loadPlaywright, waitForDiagrams} from './lib.mjs';
import {startVerificationServer} from './server.mjs';
const server = await startVerificationServer(fileURLToPath(new URL('../fixtures/details-repo', import.meta.url)));
let browser;
const failures = [];
const output = process.env.EVIDENCE_DIR;
if (output) mkdirSync(output, {recursive: true});
try {
  browser = await loadPlaywright().chromium.launch();
  for (const language of (process.env.WITH_ARABIC ? ['ar', 'en'] : ['en'])) {
    for (const width of [1440, 390]) {
     for (const authored of ['en', 'ar']) {
      const context = await browser.newContext({locale: language, viewport: {width, height: 1000}, reducedMotion: 'reduce'});
      try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      // Deliberately long authored text from a fixture response. It is never
      // written into the fixture or the user's project.
      await page.route('**/api/**', async route => {
        const response = await route.fetch();
        if (!response.headers()['content-type']?.includes('json')) return route.fulfill({response});
        const data = await response.json();
        if (typeof data.body === 'string') data.body = data.body.replace('Admission refusal rules', authored === 'ar'
          ? 'قواعد رفض الطلبات التي تقع خارج النطاق المسموح به للمشروع'
          : 'Admission refusal rules for a request outside the permitted origin and scope');
        if (authored === 'ar' && data.diagramDetails) {
          data.diagramDetails = data.diagramDetails.map(detail => detail.target.kind === 'edge'
            ? {...detail, target: {...detail.target, label: 'رُفض الطلب لأن المصدر أو النطاق غير مسموح به'}} : detail);
        }
        await route.fulfill({response, json: data});
      });
      await page.goto(server.url);
      await page.locator('article.document').waitFor();
      await waitForDiagrams(page);
      await page.locator('[data-target-id="gate"]').first().click();
      await waitForDiagrams(page);
      const edge = page.locator('.diagram-edge-detail').first();
      await edge.click();
      const dialog = page.locator('.detail-inspector');
      await dialog.waitFor();
      const facts = await dialog.evaluate(element => {
        const rect = selector => {
          const e = element.querySelector(selector), r = e.getBoundingClientRect(), style = getComputedStyle(e);
          return {x:r.x, right:r.right, y:r.y, bottom:r.bottom, direction:style.direction, radius:style.borderRadius, background:style.backgroundColor};
        };
        const body = element.querySelector('.inspector-body');
        const box = body.getBoundingClientRect(), style = getComputedStyle(body);
        const close = element.querySelector('.inspector-close'), c = close.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element.querySelector('.inspector-title'));
        const firstLine = range.getClientRects()[0];
        const icon = close.querySelector('svg').getBoundingClientRect();
        return {titleTextCenter:(firstLine.top+firstLine.bottom)/2, closeIconCenter:(icon.top+icon.bottom)/2, title:rect('.inspector-title'), relation:rect('.inspector-relation'), label:rect('.inspector-label'), badge:rect('.inspector-kind'),
          bodyLeft:box.left+parseFloat(style.paddingLeft), bodyRight:box.right-parseFloat(style.paddingRight),
          close:rect('.inspector-close'), closeReachable:close.contains(document.elementFromPoint(c.x+c.width/2,c.y+c.height/2)),
          pageOverflow:document.documentElement.scrollWidth-innerWidth};
      });
      try {
        assert.ok(Math.abs(Math.min(facts.title.x,facts.close.x)-facts.bodyLeft)<2, JSON.stringify(facts));
        assert.ok(Math.abs(Math.max(facts.title.right,facts.close.right)-facts.bodyRight)<2);
        assert.ok(facts.title.right<=facts.close.x || facts.close.right<=facts.title.x);
        assert.ok(Math.abs(facts.title.y-facts.close.y)<2);
        assert.ok(Math.abs(facts.titleTextCenter-facts.closeIconCenter)<1.5, `First title line and close icon differ by ${Math.abs(facts.titleTextCenter-facts.closeIconCenter)}px`);
        assert.ok(Math.abs((facts.badge.y+facts.badge.bottom)/2-(facts.relation.y+facts.relation.bottom)/2)<2);
        assert.ok(Math.abs(facts.badge.right-facts.bodyRight)<2);
        assert.ok(parseFloat(facts.badge.radius)>100);
        assert.notEqual(facts.badge.background,'rgba(0, 0, 0, 0)');
        assert.ok(Math.abs(facts.relation.x-facts.bodyLeft)<2);
        assert.ok(Math.abs(facts.label.x-facts.bodyLeft)<2);
        assert.equal(facts.title.direction, authored === 'ar' ? 'rtl' : 'ltr');
        assert.equal(facts.label.direction, authored === 'ar' ? 'rtl' : 'ltr');
        assert.ok(facts.relation.y >= Math.max(facts.title.bottom,facts.close.bottom));
        assert.equal(facts.closeReachable,true);
        assert.equal(facts.pageOverflow,0);
        assert.deepEqual(errors,[]);
        console.log(`PASS ${authored} header in ${language} UI at ${width}px`);
      } catch (error) {
        failures.push(`${authored}-${language}-${width}`);console.error(`FAIL ${authored}-${language}-${width}: ${error.message}`);
      }
      if (output) await page.screenshot({path:`${output}/inspector-header-${authored}-${language}-${width}.png`});
      try {
        await page.locator('[data-action="close-details"]').click();
        assert.equal(await edge.evaluate(e=>e===document.activeElement),true);
      } catch (error) {
        failures.push(`focus-${authored}-${language}-${width}`);
        console.error(`FAIL focus-${authored}-${language}-${width}: ${error.message}`);
      }
      } catch (error) {
        failures.push(`case-${authored}-${language}-${width}`);
        console.error(`FAIL case-${authored}-${language}-${width}: ${error.message}`);
      } finally {
        await context.close();
      }
     }
    }
  }
  assert.deepEqual(failures,[]);
} finally {
  try {await browser?.close();} finally {server.stop();}
}
