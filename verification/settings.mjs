// Settings: the sidebar footer's one Settings link, /settings with General and
// Health tabs in the URL (Back/Forward), appearance persisted, Health equal to
// the API's catalog, Reload documentation (busy, success, failure, recovery),
// Settings reachable while the catalog loads, after it fails and with no root,
// and the page at 390 / 820 / 1280 / 1440 in dark and light.
// Rows S1–S9 in CHECKLIST.md ("Settings and the catalog read").
//
// Usage: node verification/settings.mjs [chromium|webkit] [fixture|real]
//   fixture (default): BASE_URL http://127.0.0.1:4312 (fixtures/demo-repo) — every check,
//                      including the rejected draft-notes.md by name
//   real:              BASE_URL http://127.0.0.1:4311 — footer, tabs, Health = API, responsive

import { join } from 'node:path';
import { activeElement, baseUrl, checks, geometry, loadPlaywright, openPage, SCREENSHOTS, writeResult } from './lib.mjs';
import { S } from './selectors.mjs';

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1440, height: 900 },
];
const APPEARANCE_KEY = 'nessa-state-browser:appearance';

/** Footer contents, and any leftover footer-era controls anywhere on the page. */
function footerFacts(page) {
  return page.evaluate(() => {
    const footer = document.querySelector('#sidebar .sidebar-footer');
    const controls = footer ? [...footer.querySelectorAll('a, button, [role="button"]')] : [];
    return {
      exists: Boolean(footer),
      controls: footer?.querySelectorAll('a.settings-link').length ?? 0,
      languageControls: footer?.querySelectorAll('button.language-switch').length ?? 0,
      totalControls: controls.length,
      text: footer?.querySelector('a.settings-link')?.textContent.trim() ?? null,
      href: footer?.querySelector('a.settings-link')?.getAttribute('href') ?? null,
      hasIcon: Boolean(footer?.querySelector('a.settings-link')?.querySelector('svg')),
      current: footer?.querySelector('a.settings-link')?.getAttribute('aria-current') ?? null,
      leftovers: document.querySelectorAll('[data-testid="problem-count"], .badge, button[aria-label="Use light appearance"], button[aria-label="Use dark appearance"], button[aria-label="Reload documents"]').length,
    };
  });
}

function tabFacts(page) {
  return page.evaluate(() => {
    const selected = document.querySelector('[role="tab"][aria-selected="true"]');
    const panel = document.querySelector('[role="tabpanel"]:not([hidden])');
    return {
      path: location.pathname + (() => { const params = new URLSearchParams(location.search); params.delete('project'); return params.size ? `?${params}` : ''; })(),
      selected: selected?.dataset.settingsTab ?? null,
      panelLabelledBy: panel?.getAttribute('aria-labelledby') ?? null,
      selectedId: selected?.id ?? null,
      panelHas: { theme: Boolean(panel?.querySelector('[data-appearance-option]')), health: Boolean(panel?.querySelector('.health')) },
    };
  });
}

function healthFacts(page) {
  return page.evaluate(() => {
    const health = document.querySelector('.health');
    return {
      state: health?.dataset.healthState ?? null,
      reading: health?.hasAttribute('data-reading') ?? false,
      busy: document.querySelector('button[data-action="reload-catalog"]')?.getAttribute('aria-busy') ?? null,
      summary: document.querySelector('[data-testid="health-summary"]')?.textContent ?? null,
      accepted: Number(document.querySelector('[data-testid="accepted-count"]')?.textContent ?? NaN),
      issues: document.querySelectorAll('.health [data-issue-code]').length,
      errors: document.querySelectorAll('.health .issue-error').length,
      warnings: document.querySelectorAll('.health .issue-warning').length,
      healthy: Boolean(document.querySelector('[data-health="healthy"]')),
      alert: document.querySelector('.health [role="alert"]')?.textContent ?? null,
    };
  });
}

export async function runSettings(engine, scope = 'fixture') {
  const BASE_URL = baseUrl(scope === 'real' ? 'http://127.0.0.1:4311' : 'http://127.0.0.1:4312');
  const playwright = loadPlaywright();
  const browser = await playwright[engine].launch();
  const c = checks();
  const tag = `settings-${scope}`;
  const facts = {};
  const allErrors = { console: [], page: [] };
  // Console lines from the deliberate 500s and aborted reads are expected; nothing else is.
  const deliberate = /Failed to load resource|500|Internal Server Error|aborted|cancelled|network/i;
  const keep = (errors, allowFailedLoads = false) => {
    allErrors.console.push(...errors.console.filter((entry) => !(allowFailedLoads && deliberate.test(entry.text))));
    allErrors.page.push(...errors.page);
  };
  const api = await (await fetch(`${BASE_URL}/api/catalog`)).json();
  const apiErrors = api.issues.filter((issue) => issue.severity === 'error').length;
  const apiWarnings = api.issues.length - apiErrors;
  facts.api = { documents: api.documents.length, issues: api.issues.length, errors: apiErrors, warnings: apiWarnings };

  try {
    // 1. The footer is one quiet Settings link; tabs are in the URL; Back/Forward move between them.
    {
      const { page, errors, context } = await openPage(browser, { width: 1280, height: 800 });
      const path = () => { const url = new URL(page.url()); url.searchParams.delete('project'); return url.pathname + url.search; };
      await page.goto(`${BASE_URL}/`);
      await page.locator(S.treeLinks).first().waitFor();
      const footer = await footerFacts(page);
      facts.footer = footer;
      c.check('footer: one Settings link with a gear', footer.controls === 1 && footer.languageControls === 1 && footer.totalControls === 2 && footer.text === 'Settings' && new URL(footer.href, BASE_URL).pathname === '/settings' && footer.hasIcon, footer);
      c.check('footer: no issue count, warnings label, theme or reload buttons anywhere', footer.leftovers === 0 && !/\d|warning|error|problem/i.test(footer.text), footer);
      await page.locator(S.settingsLink).click();
      await page.locator(S.settingsPage).waitFor();
      const general = await tabFacts(page);
      c.check('Settings link opens /settings on General', general.path === '/settings' && general.selected === 'general' && general.panelHas.theme && general.panelLabelledBy === general.selectedId, general);
      c.check('Settings: link marked current, document title, focus on the heading', (await footerFacts(page)).current === 'page' && (await page.title()) === `Settings · ${await page.locator('.brand').getAttribute('aria-label')}` && (await activeElement(page))?.tag === 'h1');
      await page.locator(S.settingsTab('health')).click();
      await page.locator(S.health).waitFor();
      const health = await tabFacts(page);
      c.check('Health tab pushes /settings?tab=health', health.path === '/settings?tab=health' && health.selected === 'health' && health.panelHas.health, health);
      const h = await healthFacts(page);
      facts.health = h;
      c.check('Health: accepted count = API documents', h.state === 'loaded' && h.accepted === api.documents.length, { shown: h.accepted, api: api.documents.length });
      c.check('Health: every API issue listed, errors and warnings split as the API says', h.issues === api.issues.length && h.errors === apiErrors && h.warnings === apiWarnings, { shown: [h.issues, h.errors, h.warnings], api: facts.api });
      c.check('Health: a quiet healthy line exactly when there are no issues', h.healthy === (api.issues.length === 0), { healthy: h.healthy });
      if (scope === 'fixture') {
        c.check('Health (fixture): the rejected draft-notes.md is named with its code', (await page.locator(S.issue('missing-frontmatter')).innerText()).includes('docs/state/services/gateway/draft-notes.md'));
      }
      await page.screenshot({ path: join(SCREENSHOTS, `${engine}-${tag}-health.png`) });
      await page.goBack();
      await page.waitForFunction(() => !new URLSearchParams(location.search).has('tab'));
      const back = await tabFacts(page);
      c.check('Back → General', back.path === '/settings' && back.selected === 'general', back);
      await page.goForward();
      await page.waitForFunction(() => new URLSearchParams(location.search).get('tab') === 'health');
      const forward = await tabFacts(page);
      c.check('Forward → Health', forward.selected === 'health' && forward.panelHas.health, forward);
      // Keyboard: arrows move between tabs and push the URL; focus stays on the tab.
      await page.locator(S.settingsTab('health')).focus();
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(() => !new URLSearchParams(location.search).has('tab'));
      const arrowed = await tabFacts(page);
      const focusedTab = await page.evaluate(() => document.activeElement?.getAttribute('data-settings-tab'));
      c.check('ArrowLeft on Health selects General, URL follows, focus on the General tab', arrowed.selected === 'general' && focusedTab === 'general', { arrowed, focusedTab });
      await page.locator(S.back).click();
      await page.waitForFunction(() => new URLSearchParams(location.search).get('tab') === 'health');
      c.check('titlebar Back → Health', (await tabFacts(page)).selected === 'health');
      // Deep links.
      await page.goto(`${BASE_URL}/settings?tab=health`);
      await page.locator(S.health).waitFor();
      c.check('deep link /settings?tab=health opens Health', (await tabFacts(page)).selected === 'health');
      await page.goto(`${BASE_URL}/settings?tab=nonsense`);
      await page.locator(S.settingsPage).waitFor();
      c.check('unknown tab opens General', (await tabFacts(page)).selected === 'general');
      await page.goto(`${BASE_URL}/problems`);
      await page.locator(S.notFound).waitFor();
      c.check('/problems is an ordinary 404 now (no alias)', (await page.locator(S.settingsPage).count()) === 0 && (await page.locator(`${S.notFound} h1`).innerText()).includes('/problems'));
      keep(errors);
      await context.close();
    }

    // 2. Appearance: Dark/Light applies at once and persists.
    {
      const { page, errors, context } = await openPage(browser, { width: 1280, height: 800 });
      await page.goto(`${BASE_URL}/settings`);
      await page.locator(S.appearanceOption('dark')).waitFor();
      const appearance = () =>
        page.evaluate((key) => ({
          dark: document.documentElement.classList.contains('dark'),
          data: document.documentElement.dataset.appearance,
          stored: localStorage.getItem(key),
          darkPressed: document.querySelector('[data-appearance-option="dark"]').getAttribute('aria-pressed'),
          lightPressed: document.querySelector('[data-appearance-option="light"]').getAttribute('aria-pressed'),
        }), APPEARANCE_KEY);
      const start = await appearance();
      c.check('appearance: dark by default, Dark pressed', start.dark && start.darkPressed === 'true' && start.lightPressed === 'false', start);
      await page.locator(S.appearanceOption('light')).click();
      const light = await appearance();
      c.check('appearance: Light applies at once and is stored', !light.dark && light.data === 'light' && light.stored === 'light' && light.lightPressed === 'true', light);
      await page.reload();
      await page.locator(S.appearanceOption('light')).waitFor();
      const reloaded = await appearance();
      c.check('appearance: Light survives a reload', !reloaded.dark && reloaded.lightPressed === 'true', reloaded);
      await page.locator(S.appearanceOption('dark')).click();
      const dark = await appearance();
      c.check('appearance: Dark again', dark.dark && dark.stored === 'dark' && dark.darkPressed === 'true', dark);
      keep(errors);
      await context.close();
    }

    if (scope === 'fixture') {
      // 3. Reload documentation: busy, then the new answer (S2, S3, S8); failure (S4) and recovery (S5).
      {
        const { page, errors, context } = await openPage(browser, { width: 1280, height: 800 });
        await page.goto(`${BASE_URL}/settings?tab=health`);
        await page.locator(`${S.health}[data-health-state="loaded"]`).waitFor();
        let catalogRequests = 0;
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        await page.route('**/api/catalog*', async (route) => {
          catalogRequests += 1;
          await gate;
          const response = await route.fetch();
          const body = await response.json();
          await route.fulfill({ response, json: { ...body, issues: [] } });
        });
        await page.locator(S.reloadCatalog).click();
        await page.waitForFunction(() => document.querySelector('.health')?.hasAttribute('data-reading'));
        const busy = await healthFacts(page);
        c.check('reload: busy while in flight, the last answer still shown', busy.reading && busy.busy === 'true' && busy.summary.includes('Reading docs/state') && busy.accepted === api.documents.length && busy.issues === api.issues.length, busy);
        release();
        await page.waitForFunction(() => !document.querySelector('.health')?.hasAttribute('data-reading'));
        const done = await healthFacts(page);
        c.check('reload: exactly one catalog request; its answer replaces the issues (S3)', catalogRequests === 1 && done.state === 'loaded' && done.busy === null && done.issues === 0 && /read at/.test(done.summary), { catalogRequests, done });
        c.check('reload: zero issues shows one quiet healthy line (S8)', done.healthy && (await page.locator(`${S.health} .issues`).count()) === 0);
        await page.screenshot({ path: join(SCREENSHOTS, `${engine}-${tag}-healthy.png`) });
        await page.unroute('**/api/catalog*');
        await page.route('**/api/catalog*', (route) => route.fulfill({ status: 500, body: 'boom' }));
        await page.locator(S.reloadCatalog).click();
        await page.locator(S.healthFailure).waitFor();
        const failed = await healthFacts(page);
        const sidebarStatus = await page.locator('#sidebar .sidebar-status').innerText();
        c.check('reload failure: Health says so (role=alert, the server status), not a count (S4)', failed.state === 'failed' && failed.alert.includes('500') && Number.isNaN(failed.accepted) && failed.summary.includes('Could not be read'), failed);
        c.check('reload failure: the sidebar shows the message and keeps the Settings link', sidebarStatus.includes('500') && (await footerFacts(page)).controls === 1);
        await page.screenshot({ path: join(SCREENSHOTS, `${engine}-${tag}-failed.png`) });
        await page.unroute('**/api/catalog*');
        await page.locator(S.reloadCatalog).click();
        await page.locator(`${S.health}[data-health-state="loaded"]`).waitFor();
        const recovered = await healthFacts(page);
        c.check('reload recovers from failure (S5): count and issues = API again', recovered.accepted === api.documents.length && recovered.issues === api.issues.length && recovered.alert === null, recovered);
        // S6: a second reload aborts the first; only the last answer applies.
        let n = 0;
        await page.route('**/api/catalog*', async (route) => {
          n += 1;
          const mine = n;
          if (mine === 1) await new Promise((resolve) => setTimeout(resolve, 800));
          const response = await route.fetch().catch(() => null);
          if (!response) return route.abort().catch(() => undefined);
          const body = await response.json();
          await route.fulfill({ response, json: { ...body, issues: mine === 1 ? [] : body.issues } }).catch(() => undefined);
        });
        await page.locator(S.reloadCatalog).click();
        await page.locator(S.reloadCatalog).click();
        await page.waitForTimeout(1300);
        const last = await healthFacts(page);
        c.check('two reloads: the slower first answer does not replace the second (S6)', n === 2 && last.issues === api.issues.length && !last.reading, { requests: n, last });
        await page.unroute('**/api/catalog*');
        keep(errors, true);
        await context.close();
      }

      // 4. First read fails: Settings is reachable and recovers (S4, S5); first read slow (S1); no root (S9).
      {
        const { page, errors, context } = await openPage(browser, { width: 1280, height: 800 });
        await page.route('**/api/catalog*', (route) => route.fulfill({ status: 503, body: 'down' }));
        await page.goto(`${BASE_URL}/docs/nessa`);
        await page.locator('.page-status[role="alert"]').waitFor();
        c.check('first read failed: Settings link still in the sidebar', (await footerFacts(page)).controls === 1 && (await page.locator(S.settingsLink).isVisible()));
        await page.locator(S.settingsLink).click();
        await page.locator(S.settingsPage).waitFor();
        await page.locator(S.settingsTab('health')).click();
        await page.locator(S.healthFailure).waitFor();
        c.check('first read failed: Settings › Health explains it', (await healthFacts(page)).alert.includes('503'));
        await page.locator(S.settingsTab('general')).click();
        await page.locator(S.appearanceOption('light')).click();
        c.check('first read failed: General still works (appearance)', await page.evaluate(() => !document.documentElement.classList.contains('dark')));
        await page.locator(S.appearanceOption('dark')).click();
        await page.locator(S.settingsTab('health')).click();
        await page.unroute('**/api/catalog*');
        await page.locator(S.reloadCatalog).click();
        await page.locator(`${S.health}[data-health-state="loaded"]`).waitFor();
        await page.locator(S.treeLinks).first().waitFor();
        c.check('first read failed: Reload documentation recovers; the tree returns', (await healthFacts(page)).accepted === api.documents.length && (await page.locator(S.treeLinks).count()) > 0);
        keep(errors, true);
        await context.close();
      }
      {
        const { page, errors, context } = await openPage(browser, { width: 1280, height: 800 });
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        await page.route('**/api/catalog*', async (route) => {
          await gate;
          await route.continue();
        });
        await page.goto(`${BASE_URL}/settings?tab=health`);
        await page.locator(S.settingsPage).waitFor();
        const loading = await healthFacts(page);
        c.check('first read in flight: Settings renders, Health says it is reading (S1)', loading.state === 'loading' && loading.reading && loading.busy === 'true' && loading.summary.includes('Reading docs/state') && (await footerFacts(page)).controls === 1, loading);
        release();
        await page.locator(`${S.health}[data-health-state="loaded"]`).waitFor();
        c.check('first read answers: Health shows the count', (await healthFacts(page)).accepted === api.documents.length);
        await page.unroute('**/api/catalog*');
        await page.route('**/api/catalog*', async (route) => {
          const response = await route.fetch();
          const body = await response.json();
          await route.fulfill({ response, json: { ...body, rootId: null, documents: [] } });
        });
        await page.goto(`${BASE_URL}/`);
        await page.locator('.tree-empty').waitFor();
        c.check('no root accepted: the sidebar points to Settings › Health and keeps the link (S9)', (await page.locator('.tree-empty').innerText()).includes('Settings › Health') && (await footerFacts(page)).controls === 1);
        await page.unroute('**/api/catalog*');
        keep(errors);
        await context.close();
      }
    }

    // 5. Responsive: both tabs at four widths, dark and light; narrow reaches Settings through the drawer.
    for (const viewport of WIDTHS) {
      for (const appearance of ['dark', 'light']) {
        const { page, errors, context } = await openPage(browser, { width: viewport.width, height: viewport.height });
        await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [APPEARANCE_KEY, appearance]);
        const where = `${viewport.name} ${appearance}`;
        for (const tab of ['general', 'health']) {
          await page.goto(`${BASE_URL}/settings${tab === 'health' ? '?tab=health' : ''}`);
          await page.locator(tab === 'health' ? `${S.health}[data-health-state="loaded"]` : S.appearanceOption('dark')).waitFor();
          const g = await geometry(page);
          const inside = await page.evaluate((w) => [...document.querySelectorAll('[role="tab"], [data-appearance-option], button[data-action="reload-catalog"]')].filter((el) => el.getClientRects().length > 0).every((el) => {
            const r = el.getBoundingClientRect();
            return r.left >= 0 && r.right <= w;
          }), viewport.width);
          c.check(`${where} ${tab}: no horizontal overflow, controls inside the window`, g.horizontalOverflow === 0 && g.overflowingElements.length === 0 && inside, { horizontalOverflow: g.horizontalOverflow, overflowingElements: g.overflowingElements, inside });
          if (viewport.width < 900) {
            const heights = await page.locator('.settings-page button:visible').evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().height)));
            c.check(`${where} ${tab}: narrow: Settings controls ≥ 36px`, heights.length > 0 && heights.every((height) => height >= 36), { heights });
          }
          await page.screenshot({ path: join(SCREENSHOTS, `${engine}-${tag}-${tab}-${viewport.name}-${appearance}.png`) });
        }
        if (viewport.width < 900) {
          await page.goto(`${BASE_URL}/`);
          await page.locator(S.menuButton).click();
          await page.waitForFunction(() => getComputedStyle(document.querySelector('#sidebar')).visibility === 'visible');
          const link = await page.locator(S.settingsLink).boundingBox();
          c.check(`${where}: drawer shows the Settings link inside the window`, link && link.y + link.height <= viewport.height && link.x >= 0, { link });
          await page.locator(S.settingsLink).click();
          await page.locator(S.settingsPage).waitFor();
          c.check(`${where}: Settings link navigates and closes the drawer`, new URL(page.url()).pathname === '/settings' && (await page.locator(S.menuButton).getAttribute('aria-expanded')) === 'false');
        }
        keep(errors);
        await context.close();
      }
    }
    c.check('settings: no unexpected console errors', allErrors.console.length === 0, { console: allErrors.console });
    c.check('settings: no page errors', allErrors.page.length === 0, { page: allErrors.page });
  } catch (error) {
    c.check('settings completed without exception', false, { error: String(error) });
  } finally {
    await browser.close();
  }
  const result = { engine, script: tag, scope, baseUrl: BASE_URL, ok: c.ok, passed: c.list.filter((x) => x.pass).length, total: c.list.length, checks: c.list, facts };
  writeResult(`${tag}-${engine}`, result);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runSettings(process.argv[2] || 'chromium', process.argv[3] || 'fixture');
  console.log(JSON.stringify({ engine: result.engine, script: result.script, baseUrl: result.baseUrl, ok: result.ok, passed: result.passed, total: result.total, failed: result.checks.filter((x) => !x.pass).map((x) => x.name) }));
  process.exit(result.ok ? 0 : 1);
}
