// Glossary terms, hover cards, node overviews and closing the side panel, on
// the bundled example store (its docs/state/glossary.md). Screenshots go to
// verification/results for a person to look at.
import { fileURLToPath } from 'node:url';
import { startVerificationServer } from './server.mjs';
import { checks, loadPlaywright, openPage, waitForDiagrams, waitForDocument, writeResult } from './lib.mjs';

const STORE = fileURLToPath(new URL('../examples/store', import.meta.url));
const SHOTS = fileURLToPath(new URL('./results/', import.meta.url));

export async function runGlossary(engine) {
  const server = await startVerificationServer(STORE);
  let browser;
  const c = checks();
  const pageErrors = [];
  try {
    browser = await loadPlaywright()[engine].launch();
    const { page, context, errors } = await openPage(browser, { width: 1440, height: 900 });

    // A term reads as a word, shows its meaning on hover, and opens its entry.
    await page.goto(`${server.url}/docs/sdk?view=details`);
    await waitForDocument(page, 'sdk');
    const term = page.locator('.prose [data-ref-rule="glossary"]', { hasText: 'SDK' }).first();
    c.check('a glossary term is linked', (await term.count()) === 1);
    await term.hover();
    const card = page.locator('.ref-hover:hover > .ref-card');
    await card.waitFor({ state: 'visible' });
    await page.waitForTimeout(450);
    c.check('hover shows the meaning', (await card.innerText()).includes('Software development kit'));
    const box = await card.boundingBox();
    c.check('the hover card stays on screen', box !== null && box.x >= 0 && box.x + box.width <= 1440, { box });
    await page.screenshot({ path: `${SHOTS}glossary-hover-${engine}.png` });
    await term.click();
    const peek = page.locator('dialog.reference-peek[open]');
    await peek.waitFor();
    c.check('click opens the entry beside the page', (await peek.innerText()).includes('small client library'));
    await page.locator('#doc-title').click();
    await peek.waitFor({ state: 'detached', timeout: 2000 }).catch(() => undefined);
    c.check('a click outside closes it', (await page.locator('dialog.reference-peek[open]').count()) === 0);

    // A node that links to a page shows that page's overview, with a way to open it.
    await page.goto(`${server.url}/docs/example-store`);
    await waitForDocument(page, 'example-store');
    await waitForDiagrams(page);
    const node = page.locator('figure.diagram svg [data-target-id="order-lifecycle"]').first();
    c.check('the linked node is a button for its overview', (await node.getAttribute('role')) === 'button' && (await node.getAttribute('aria-label'))?.startsWith('Overview of'));
    await node.click();
    await peek.waitFor();
    const overview = await peek.innerText();
    // "This example does not create" is in the page's opening, not its summary: the opening is what shows.
    c.check('the overview shows the linked page\'s opening, without its chart', /overview/i.test(overview) && overview.includes('This example does not create') && !overview.includes('A chart is here'), { overview: overview.slice(0, 300) });
    c.check('the page did not change', new URL(page.url()).pathname === '/docs/example-store');
    await page.screenshot({ path: `${SHOTS}node-overview-${engine}.png` });
    await page.locator('dialog.reference-peek[open] .inspector-open a').click();
    await waitForDocument(page, 'order-lifecycle');
    c.check('Open page goes to it', new URL(page.url()).pathname === '/docs/order-lifecycle');

    // The details inspector closes on an outside click too.
    await page.goto(`${server.url}/docs/order-lifecycle`);
    await waitForDocument(page, 'order-lifecycle');
    await waitForDiagrams(page);
    const detail = page.locator('figure.diagram svg [data-detail-key][role="button"]').first();
    c.check('the page has an explained element to open', (await detail.count()) > 0);
    await detail.focus();
    await page.keyboard.press('Enter');
    await page.locator('dialog.detail-inspector[open]:not(.reference-peek)').waitFor();
    await page.locator('#doc-title').click();
    await page.waitForTimeout(200);
    c.check('the details panel closes on an outside click', (await page.locator('dialog.detail-inspector[open]:not(.reference-peek)').count()) === 0);
    pageErrors.push(...errors.page);
    await context.close();

    // Near the right edge of a narrow window the card opens leftward and stays on screen; Escape hides it.
    const narrow = await openPage(browser, { width: 420, height: 800 });
    await narrow.page.goto(`${server.url}/docs/payment-contract?view=details`);
    await waitForDocument(narrow.page, 'payment-contract');
    const id = narrow.page.locator('.prose [data-ref-rule="glossary"]', { hasText: 'ID' }).first();
    await id.hover();
    const narrowCard = narrow.page.locator('.ref-hover:hover > .ref-card');
    await narrowCard.waitFor({ state: 'visible' });
    await narrow.page.waitForTimeout(450);
    const narrowBox = await narrowCard.boundingBox();
    c.check('420 px: the hover card stays on screen', narrowBox !== null && narrowBox.x >= 0 && narrowBox.x + narrowBox.width <= 420, { narrowBox });
    c.check('420 px: no horizontal overflow', await narrow.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await id.focus();
    await narrow.page.keyboard.press('Escape');
    c.check('Escape hides the hover card', (await narrow.page.locator('.ref-hover:hover > .ref-card').isVisible()) === false);
    pageErrors.push(...narrow.errors.page);
    await narrow.context.close();
    c.check('no page errors', pageErrors.length === 0, { pageErrors });
    const result = { engine, script: 'glossary', ok: c.ok, passed: c.list.filter((x) => x.pass).length, total: c.list.length, checks: c.list };
    writeResult(`glossary-${engine}`, result);
    return result;
  } finally {
    await browser?.close();
    server.stop();
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runGlossary(process.argv[2] || 'chromium');
  console.log(JSON.stringify(result, null, 1));
  process.exitCode = result.ok ? 0 : 1;
}
