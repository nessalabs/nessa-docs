// The browser extension (extension/, built by `npm run build:extension`) on a
// stand-in github.com: Playwright answers github.com and raw.githubusercontent.com
// from the bundled example store, the way GitHub answers for a repository, so
// the run needs no network and no account. Chromium only: Playwright cannot load
// extensions into Firefox or WebKit.
//
// What it checks: a docs folder opens in the reader; a page's own address opens
// that page; moving in the reader moves GitHub's address; repository evidence
// links to GitHub; "GitHub view" takes the cover off and the corner button puts
// it back; moving out of the folder (GitHub's own soft navigation) removes it;
// a folder without docs/state/README.md is left alone.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checks, loadPlaywright, writeResult, SCREENSHOTS } from './lib.mjs';

const EXTENSION = fileURLToPath(new URL('../dist/extension/chrome', import.meta.url));
const STORE = fileURLToPath(new URL('../examples/store', import.meta.url));
const OWNER = 'example';
const REPO = 'store';
const BRANCH = 'release/1.0'; // a slash, so the reader must take GitHub's word for where the branch ends
const COMMIT = 'c0ffee'.padEnd(40, '0');
const BASE = `https://github.com/${OWNER}/${REPO}`;

/** GitHub's tree JSON for a folder of the example, or null when there is no such folder. */
function treeJson(path) {
  const local = join(STORE, path);
  if (!existsSync(local) || !statSync(local).isDirectory()) return null;
  const items = readdirSync(local, { withFileTypes: true }).map((entry) => ({ name: entry.name, path: path ? `${path}/${entry.name}` : entry.name, contentType: entry.isDirectory() ? 'directory' : 'file' }));
  return { payload: { codeViewTreeRoute: { path, refInfo: { name: BRANCH, currentOid: COMMIT, refType: 'branch' }, tree: { items, totalCount: items.length } } } };
}

/** The ref and path in a tree or blob address, as GitHub splits them. */
function split(rest) {
  for (const ref of [BRANCH, COMMIT]) {
    if (rest === ref) return '';
    if (rest.startsWith(`${ref}/`)) return rest.slice(ref.length + 1);
  }
  return null;
}

async function fakeGithub(route) {
  const url = new URL(route.request().url());
  const parts = url.pathname.split('/').slice(1).map(decodeURIComponent);
  if (url.hostname === 'raw.githubusercontent.com') {
    const [owner, repo, commit, ...path] = parts;
    const local = join(STORE, ...path);
    if (owner === OWNER && repo === REPO && commit === COMMIT && existsSync(local) && statSync(local).isFile()) {
      return route.fulfill({ status: 200, body: readFileSync(local), headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' } });
    }
    return route.fulfill({ status: 404, body: '404: Not Found', headers: { 'access-control-allow-origin': '*' } });
  }
  if (url.hostname !== 'github.com') return route.abort();
  const [owner, repo, view, ...rest] = parts;
  const path = owner === OWNER && repo === REPO && (view === 'tree' || view === 'blob') ? split(rest.join('/')) : null;
  if (route.request().headers().accept?.includes('application/json')) {
    const tree = view === 'tree' && path !== null ? treeJson(path) : null;
    return tree ? route.fulfill({ status: 200, json: tree }) : route.fulfill({ status: 404, json: { error: 'Not Found' } });
  }
  return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>${view ?? ''} ${path ?? ''} · GitHub</title><body style="font:16px sans-serif;margin:40px"><h1 id="github-view">GitHub file view</h1><p>${path ?? url.pathname}</p></body>` });
}

export async function runExtension() {
  if (!existsSync(join(EXTENSION, 'manifest.json'))) throw new Error('Build the extension first: npm run build:extension');
  const c = checks();
  const profile = mkdtempSync(join(tmpdir(), 'nessa-docs-extension-'));
  const { chromium } = loadPlaywright();
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const pageErrors = [];
  try {
    await context.route(/^https:\/\/(github\.com|raw\.githubusercontent\.com)\//, fakeGithub);
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    const reader = async () => (await page.waitForSelector('#nessa-docs-overlay iframe', { timeout: 15000 })).contentFrame();
    const title = (frame) => frame.locator('.page h1').first().innerText({ timeout: 15000 });

    // A docs folder opens in the reader, on the overview.
    await page.goto(`${BASE}/tree/${BRANCH}/docs/state`);
    let frame = await reader();
    c.check('the folder opens on the overview', (await title(frame)) === 'Example store');
    c.check('the reader covers the page', await page.evaluate(() => document.documentElement.classList.contains('nessa-docs-open')));
    await page.screenshot({ path: join(SCREENSHOTS, 'extension-overview.png') });

    // A page's own address opens that page.
    await page.goto(`${BASE}/blob/${BRANCH}/docs/state/order-lifecycle.md`);
    frame = await reader();
    c.check("a page's address opens that page", (await title(frame)) === 'Submit or cancel an order');

    // Moving in the reader moves GitHub's address, so a copied link opens the same page.
    await frame.locator('.sidebar a.row', { hasText: 'Payment provider boundary' }).click();
    await page.waitForFunction((want) => location.pathname.endsWith(want), '/docs/state/payment-contract.md');
    c.check('the address follows the reader', page.url() === `${BASE}/blob/${BRANCH}/docs/state/payment-contract.md`, { url: page.url() });
    await frame.locator('a.brand').click();
    await page.waitForFunction((want) => location.pathname === want, `/${OWNER}/${REPO}/tree/${BRANCH}/docs/state`);
    c.check('the overview is the folder address', true);

    // Repository evidence opens the file on GitHub, at the same branch.
    const evidence = await frame.locator('a[data-evidence="repo-file"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    c.check('evidence links to GitHub', evidence.length > 0 && evidence.every((href) => href.startsWith(`${BASE}/blob/${BRANCH}/`)), { evidence });

    // Settings has nothing that needs the local app.
    await frame.locator('a.settings-link').click();
    const groups = await frame.locator('[data-slot=settings-group-title]').allInnerTexts();
    c.check('settings drop project and rule checker', !groups.includes('Project') && !groups.includes('Rule checker'), { groups });
    await frame.locator('a.brand').click();

    // GitHub view takes the cover off; the corner button puts it back on the same page.
    await frame.locator('.sidebar a.row', { hasText: 'Submit or cancel an order' }).click();
    await page.waitForFunction(() => location.pathname.endsWith('order-lifecycle.md'));
    await frame.locator('button.ext-github-view').click();
    await page.waitForSelector('#nessa-docs-launcher', { timeout: 15000 });
    c.check('GitHub view shows GitHub', (await page.locator('#nessa-docs-overlay').count()) === 0 && (await page.locator('#github-view').count()) === 1);
    c.check('GitHub view draws the address it names', (await page.locator('body').innerText()).includes('docs/state/order-lifecycle.md'));
    await page.screenshot({ path: join(SCREENSHOTS, 'extension-github-view.png') });
    await page.reload();
    await page.waitForSelector('#nessa-docs-launcher', { timeout: 15000 });
    c.check('the choice lasts for the tab', (await page.locator('#nessa-docs-overlay').count()) === 0);
    await page.locator('#nessa-docs-launcher').click();
    frame = await reader();
    c.check('the button reopens the same page', (await title(frame)) === 'Submit or cancel an order');

    // GitHub's own soft navigation out of the folder removes the reader, and back in restores it.
    await page.evaluate((to) => history.pushState({}, '', to), `/${OWNER}/${REPO}/tree/${BRANCH}/src`);
    await page.waitForFunction(() => !document.getElementById('nessa-docs-overlay'));
    c.check('leaving the folder removes the reader and its button', (await page.locator('#nessa-docs-launcher').count()) === 0);

    // A docs/state folder with no README is not a Nessa Docs folder.
    await page.goto(`${BASE}/tree/${BRANCH}/docs/state/services`);
    frame = await reader().catch(() => null);
    c.check('a subfolder of a docs folder still opens the reader', frame !== null);
    await page.goto(`https://github.com/${OWNER}/other/tree/main/docs/state`);
    await page.waitForTimeout(1500);
    c.check('a repository without one is left alone', (await page.locator('#nessa-docs-overlay, #nessa-docs-launcher').count()) === 0);

    c.check('no page errors', pageErrors.length === 0, { pageErrors });
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
  const result = { engine: 'chromium', script: 'extension', ok: c.ok, passed: c.list.filter((x) => x.pass).length, total: c.list.length, checks: c.list };
  writeResult('extension-chromium', result);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runExtension();
  console.log(JSON.stringify(result, null, 1));
  process.exitCode = result.ok ? 0 : 1;
}
