// Footer placement across empty/loaded composition and docked/drawer sidebars.
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { baseUrl, checks, loadPlaywright, openPage, SCREENSHOTS, waitForDocument, writeResult } from './lib.mjs';
import { S } from './selectors.mjs';

export async function runProjectLayout(engine) {
  mkdirSync(SCREENSHOTS, { recursive: true });
  const base = baseUrl('http://127.0.0.1:4321'); const c = checks(); const browser = await loadPlaywright()[engine].launch();
  try {
    for (const width of [390,1440]) {
      const { page, context, errors } = await openPage(browser, { width, height: 900 });
      try {
        await page.goto(base); await page.locator(S.projectFolder).waitFor();
        for (const state of ['welcome','loaded']) {
          if (state === 'loaded') { await page.getByRole('button', { name: 'Browse example', exact: true }).click(); await waitForDocument(page, 'example-store'); }
          if (width < 900) { await page.locator(S.menuButton).click(); await page.waitForFunction(() => document.getElementById('sidebar')?.dataset.open === 'true'); }
          const facts = await page.locator(S.sidebar).evaluate((sidebar) => {
            const footer = sidebar.querySelector('.sidebar-footer'); const s = sidebar.getBoundingClientRect(); const f = footer.getBoundingClientRect();
            return { sidebarBottom: s.bottom, footerBottom: f.bottom, footerHeight: f.height, links: [...footer.querySelectorAll('a')].map((a) => a.textContent.trim()), overflow: document.documentElement.scrollWidth - innerWidth };
          });
          c.check(`${width} ${state}: Settings-only footer anchored at sidebar bottom`, Math.abs(facts.sidebarBottom-facts.footerBottom) <= 2 && facts.footerHeight > 0 && facts.links.length === 1 && facts.links[0] === 'Settings' && facts.overflow === 0, facts);
          await page.screenshot({ path: join(SCREENSHOTS, `${engine}-project-layout-${width}-${state}.png`) });
          if (width < 900) {
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => document.getElementById('sidebar')?.dataset.open === 'false');
            c.check(`${width} ${state}: one Escape closes the drawer and restores toggle focus`,
              await page.locator(S.menuButton).evaluate(el => el === document.activeElement));
          }
        }
        c.check(`${width}: no page errors`, errors.page.length === 0, errors.page);
      } finally { await context.close(); }
    }
  } catch (error) { c.check('project layout completed', false, { error: String(error) }); }
  finally { await browser.close(); }
  const result = { script: 'project-layout', engine, baseUrl: base, ok: c.ok, passed: c.list.filter((x) => x.pass).length, total: c.list.length, checks: c.list };
  writeResult(`${engine}-project-layout`, result); return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runProjectLayout(process.argv[2] || 'chromium'); console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1;
}
