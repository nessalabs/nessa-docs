// Check the fragment contract after asynchronous diagrams finish their layout.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, waitForDiagrams } from './lib.mjs';
import { startVerificationServer } from './server.mjs';
const server = await startVerificationServer(fileURLToPath(new URL('../fixtures/demo-repo', import.meta.url)));
const out = 'verification/results/hash';
mkdirSync(out, { recursive: true });
let browser;
const measurements = [];
const measure = () => {
  const target = document.getElementById('decisions-and-failure-boundaries');
  const main = document.getElementById('main');
  return { top: Math.round(target.getBoundingClientRect().top),
    atEnd: Math.abs(main.scrollHeight - main.clientHeight - main.scrollTop) <= 2,
    scrollTop: Math.round(main.scrollTop),
    rendering: [...document.querySelectorAll('figure.diagram')].some(f => f.dataset.state === 'rendering') };
};
try {
  browser = await loadPlaywright().webkit.launch();
  for (let sample = 0; sample < 3; sample++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      await page.goto(`${server.url}/docs/chat-send-first#decisions-and-failure-boundaries`);
      await page.locator('#decisions-and-failure-boundaries').waitFor();
      await page.waitForTimeout(300);
      const beforeReady = await page.evaluate(measure);
      await page.screenshot({ path: `${out}/sample-${sample}-300ms.png` });
      await waitForDiagrams(page);
      await page.waitForFunction(() => {
        const h = document.getElementById('decisions-and-failure-boundaries');
        const main = document.getElementById('main');
        const top = Math.round(h.getBoundingClientRect().top);
        const atEnd = Math.abs(main.scrollHeight-main.clientHeight-main.scrollTop) <= 2;
        return top >= 40 && (top <= 160 || (atEnd && top < 900)) && main.scrollTop > 0;
      }, null, { timeout: 6000 });
      const ready = await page.evaluate(measure);
      assert.equal(ready.rendering, false);
      measurements.push({ sample, beforeReady, ready });
      writeFileSync(`${out}/measurements.json`, JSON.stringify(measurements, null, 2));
      await page.screenshot({ path: `${out}/sample-${sample}-ready.png` });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify(measurements));
} finally { try { await browser?.close(); } finally { await server.stop(); } }
