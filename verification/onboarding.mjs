// Project opening P1–P10, portable example, identity, ordering and visible geometry.
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeElement, baseUrl, checks, geometry, loadPlaywright, openPage, waitForDocument, waitForDiagrams, writeResult } from './lib.mjs';
import { S } from './selectors.mjs';

export async function runOnboarding(engine) {
  const BASE = baseUrl('http://127.0.0.1:4321');
  const temporary = mkdtempSync(join(tmpdir(), 'nessa-docs-onboarding-'));
  const example = fileURLToPath(new URL('../examples/store', import.meta.url));
  const projects = {};
  for (const name of ['A', 'B']) {
    const folder = join(temporary, name); cpSync(example, folder, { recursive: true });
    const root = join(folder, 'docs/state/README.md');
    writeFileSync(root, readFileSync(root, 'utf8').replaceAll('Example store', `Project ${name}`));
    projects[name] = folder;
  }
  mkdirSync(join(temporary, 'empty'));
  mkdirSync(join(temporary, 'invalid', 'docs/state'), { recursive: true });
  writeFileSync(join(temporary, 'invalid', 'docs/state/README.md'), 'No frontmatter');
  const browser = await loadPlaywright()[engine].launch();
  const { page, context, errors } = await openPage(browser, { width: 1280, height: 800 });
  const c = checks(); const facts = {};
  const handle = () => new URL(page.url()).searchParams.get('project');
  const form = () => page.locator(S.projectFolder);
  const submit = () => page.getByRole('button', { name: 'Open project', exact: true }).click();
  const openForm = async () => {
    await page.locator(S.settingsLink).click(); await page.locator(S.settingsPage).waitFor();
    await page.locator(S.settingsTab('general')).click(); await page.locator(S.openProjectLink).click(); await form().waitFor();
  };
  const switchTo = async (folder) => {
    await openForm(); await form().fill(folder); await submit();
    await waitForDocument(page, 'example-store');
  };
  try {
    await page.route('**/api/projects/picker', (route) => route.fulfill({ json: { kind: 'available' } }));
    await context.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copiedPrompt = text; } } }); });
    await page.goto(BASE); await form().waitFor();
    c.check('P1 first start shows project form and honest authoring guidance', handle() === null && (await page.locator(S.projectWelcome).innerText()).includes('$nessa-docs') && (await page.locator(S.projectWelcome).innerText()).includes('docs/state'));
    await page.getByRole('button', { name: 'Copy agent prompt' }).click();
    c.check('P1 Copy agent prompt names skill, evidence and validation', await page.evaluate(() => window.copiedPrompt?.includes('$nessa-docs') && window.copiedPrompt?.includes('actual code') && window.copiedPrompt?.includes('Validate')));
    await page.locator(S.settingsLink).click(); await page.locator(S.settingsPage).waitFor();
    await page.locator(S.appearanceOption('light')).click();
    c.check('P1 General settings works before opening a project', await page.evaluate(() => !document.documentElement.classList.contains('dark')));
    await openForm();
    for (const [name, path] of [['relative', 'relative'], ['missing', join(temporary, 'missing')], ['no docs/state', join(temporary, 'empty')], ['invalid root', join(temporary, 'invalid')]]) {
      await form().fill(path); await submit(); await page.locator(S.projectOpeningError).waitFor();
      c.check(`P3 ${name} has actionable refusal without selected identity`, handle() === null && (await page.locator(S.projectOpeningError).innerText()).length > 30);
    }
    // Native adapter outcomes are injected; headless journeys never open OS dialogs.
    const picked = join(temporary, 'Picker space café '); cpSync(example, picked, { recursive: true });
    let pickerResult = { kind: 'selected', path: picked + '/' };
    await page.route('**/api/projects/pick-folder', (route) => route.fulfill({ json: pickerResult }));
    await page.getByRole('button', { name: 'Browse…', exact: true }).click();
    await page.waitForFunction((path) => document.getElementById('project-folder').value === path, picked + '/');
    c.check('F3 chosen path fills exactly, clears prior error, focuses field without opening', (await form().inputValue()) === picked + '/' && handle() === null && (await page.locator(S.projectOpeningError).count()) === 0 && (await activeElement(page))?.id === 'project-folder');
    pickerResult = { kind: 'cancelled' };
    await page.getByRole('button', { name: 'Browse…', exact: true }).click();
    await page.getByRole('button', { name: 'Browse…', exact: true }).waitFor();
    c.check('F4 cancelled picker preserves path and selection, restoring focus', (await form().inputValue()) === picked + '/' && handle() === null && (await activeElement(page))?.id === 'project-folder');
    pickerResult = { kind: 'busy', message: 'A folder chooser is already open.' };
    await page.getByRole('button', { name: 'Browse…', exact: true }).click(); await page.locator(S.projectOpeningError).waitFor();
    c.check('F6 competing-tab busy is visible and leaves path entry intact', (await page.locator(S.projectOpeningError).innerText()).includes('already open') && (await form().inputValue()) === picked + '/');
    for (const kind of ['timed-out', 'failed']) {
      pickerResult = { kind, message: 'Try again or paste the path.' };
      await page.getByRole('button', { name: 'Browse…', exact: true }).click(); await page.locator(S.projectOpeningError).waitFor();
      c.check(`F7 ${kind} restores retry and keeps path entry`, (await page.locator(S.projectOpeningError).innerText()).includes('Try again') && await page.getByRole('button', { name: 'Browse…' }).isEnabled() && await page.getByRole('button', { name: 'Open project', exact: true }).isEnabled() && (await form().inputValue()) === picked + '/');
    }
    await page.unroute('**/api/projects/pick-folder');
    let pickerStarted; const pickerStart = new Promise((resolve) => { pickerStarted = resolve; });
    let releasePicker; const pickerGate = new Promise((resolve) => { releasePicker = resolve; });
    await page.route('**/api/projects/pick-folder', async (route) => { pickerStarted(); await pickerGate; try { await route.fulfill({ json: { kind: 'selected', path: '/late-selection' } }); } catch {} });
    await page.getByRole('button', { name: 'Browse…', exact: true }).click(); await pickerStart;
    c.check('F2 pending chooser disables Browse and Open, preserving field', (await page.getByRole('button', { name: 'Choosing…' }).isDisabled()) && (await page.getByRole('button', { name: 'Open project', exact: true }).isDisabled()) && (await form().inputValue()) === picked + '/');
    await form().fill(projects.A); await form().fill(picked + '/'); releasePicker(); await page.unroute('**/api/projects/pick-folder');
    c.check('F5 editing aborts authority; a late chooser answer cannot replace the field', (await form().inputValue()) === picked + '/' && (await page.getByRole('button', { name: 'Browse…' }).isEnabled()));
    await submit(); await waitForDocument(page, 'example-store');
    c.check('F9 explicitly Open accepts picked space/Unicode/filename-whitespace folder', Boolean(handle()) && (await page.title()) === 'Example store · Example store Docs');
    await openForm();
    await page.getByRole('button', { name: 'Browse example' }).click();
    await waitForDocument(page, 'example-store'); await waitForDiagrams(page);
    facts.exampleHandle = handle();
    c.check('P2 bundled example: arbitrary root ID, authored title, two working links', (await page.title()) === 'Example store · Example store Docs' && Boolean(handle()) && (await page.locator(S.diagramNodes).count()) === 2);
    await page.locator(S.diagramNode('order-lifecycle')).click(); await waitForDocument(page, 'order-lifecycle'); await waitForDiagrams(page);
    c.check('project handle stays on chart navigation and sidebar hrefs', handle() === facts.exampleHandle && new URL(await page.locator(S.treeLink('example-store')).getAttribute('href'), BASE).searchParams.get('project') === facts.exampleHandle);
    c.check('Diagrams label has no count', (await page.locator(S.viewDiagrams).innerText()).trim() === 'Diagrams');
    await page.locator(S.detailControl(0)).first().click(); await page.locator(S.inspectorTitle).waitFor();
    c.check('example has authored node explanation and inspector focus', (await page.locator(S.inspectorTitle).innerText()) === 'Draft order' && (await activeElement(page))?.text === 'Draft order');
    await switchTo(projects.A);
    const a = handle();
    c.check('P5 switching removes inspector and old document content', (await page.locator(`${S.inspector}[open]`).count()) === 0 && (await page.locator(S.title).innerText()) === 'Project A' && (await page.locator(S.search).inputValue()) === '');
    await switchTo(projects.B); const b = handle();
    c.check('P5 colliding IDs select a different immutable identity', a !== b && (await page.locator(S.title).innerText()) === 'Project B');
    await page.goBack(); await form().waitFor();
    c.check('P6 Back returns to opening screen in A context', handle() === a && (await page.locator(S.treeLink('example-store')).innerText()) === 'Project A');
    await page.goBack(); await page.locator(S.settingsPage).waitFor();
    await page.goBack(); await waitForDocument(page, 'example-store');
    c.check('P6 Back restores A document', handle() === a && (await page.locator(S.title).innerText()) === 'Project A');
    await page.goForward(); await page.locator(S.settingsPage).waitFor(); await page.goForward(); await form().waitFor(); await page.goForward(); await waitForDocument(page, 'example-store');
    c.check('P6 Forward restores B document', handle() === b && (await page.locator(S.title).innerText()) === 'Project B');
    const second = await context.newPage(); await second.goto(`${BASE}/?project=${a}`); await waitForDocument(second, 'example-store');
    await switchTo(projects.A); await switchTo(projects.B);
    c.check('P7 two tabs keep independent identity with colliding docs', new URL(second.url()).searchParams.get('project') === a && (await second.locator(S.title).innerText()) === 'Project A' && (await page.locator(S.title).innerText()) === 'Project B');
    await second.reload(); await waitForDocument(second, 'example-store');
    c.check('P7 other tab reload still reads A', (await second.locator(S.title).innerText()) === 'Project A'); await second.close();

    // A held search must not populate B after a switch.
    await switchTo(projects.A);
    let searchStarted; const started = new Promise((resolve) => { searchStarted = resolve; });
    let releaseSearch; const searchGate = new Promise((resolve) => { releaseSearch = resolve; });
    await page.route('**/api/search*', async (route) => { const response = await route.fetch(); searchStarted(); await searchGate; try { await route.fulfill({ response }); } catch {} });
    await page.locator(S.search).fill('Draft'); await started;
    await switchTo(projects.B); releaseSearch(); await page.unroute('**/api/search*');
    c.check('P5 delayed A search cannot leak into B', (await page.locator(S.search).inputValue()) === '' && (await page.locator(S.searchResults).count()) === 0 && (await page.locator(S.title).innerText()) === 'Project B');

    // An abandoned A document answer must not overwrite a colliding B document.
    await switchTo(projects.A);
    let docStarted; const docStart = new Promise((resolve) => { docStarted = resolve; });
    let releaseDoc; const docGate = new Promise((resolve) => { releaseDoc = resolve; });
    await page.route('**/api/documents/order-lifecycle*', async (route) => { const response = await route.fetch(); docStarted(); await docGate; try { await route.fulfill({ response }); } catch {} });
    await page.locator(S.treeLink('order-lifecycle')).click(); await docStart;
    await switchTo(projects.B); releaseDoc(); await page.unroute('**/api/documents/order-lifecycle*');
    c.check('P5 delayed A document cannot overwrite B root', (await page.locator(S.title).innerText()) === 'Project B' && (await page.locator(S.documentLayout).getAttribute('data-doc-id')) === 'example-store');

    // Editing an in-flight opening cancels its browser authority before another answer.
    await openForm();
    let openStarted; const openStart = new Promise((resolve) => { openStarted = resolve; });
    let releaseOpen; const openGate = new Promise((resolve) => { releaseOpen = resolve; }); let opens = 0;
    await page.route('**/api/projects', async (route) => { if (++opens === 1) { const response = await route.fetch(); openStarted(); await openGate; try { await route.fulfill({ response }); } catch {} } else await route.continue(); });
    await form().fill(projects.A); await submit(); await openStart;
    await form().fill(projects.B); await submit(); await waitForDocument(page, 'example-store'); releaseOpen(); await page.unroute('**/api/projects');
    c.check('P8 abandoned opening answer does not navigate over latest selection', handle() === b && (await page.locator(S.title).innerText()) === 'Project B');

    await page.goto(`${BASE}/docs/example-store?project=previous-server-handle`); await form().waitFor();
    c.check('P9 expired handle does not fallback to an open folder', (await page.locator(S.projectOpeningError).innerText()).includes('server may have restarted') && (await page.locator(S.documentLayout).count()) === 0);
    await form().fill(projects.A); await submit(); await waitForDocument(page, 'example-store');
    c.check('P9 explicit reopening recovers expired selection', handle() === a && (await page.locator(S.title).innerText()) === 'Project A');

    if (process.env.REAL_PROJECT) {
      await openForm(); await form().fill(process.env.REAL_PROJECT); await submit(); await page.locator(S.documentLayout).waitFor();
      const catalog = await (await page.request.get(`${BASE}/api/catalog?project=${handle()}`)).json();
      facts.real = { rootId: catalog.rootId, documents: catalog.documents.length, issues: catalog.issues.length };
      c.check('actual project opens with catalog-authored identity', catalog.rootId !== null && catalog.documents.length > 0 && (await page.locator(S.documentLayout).getAttribute('data-doc-id')) === catalog.rootId, facts.real);
    }
    const unsupported = await context.newPage();
    await unsupported.route('**/api/projects/picker', (route) => route.fulfill({ json: { kind: 'unsupported', message: 'Folder browsing is available on macOS. Paste the folder path here.' } }));
    await unsupported.goto(BASE); await unsupported.locator(S.projectFolder).waitFor();
    await unsupported.locator('#folder-picker-hint.picker-hint').waitFor();
    c.check('F1 unsupported Browse is disabled with accessible path-entry guidance', await unsupported.getByRole('button', { name: 'Browse…' }).isDisabled() && (await unsupported.locator('#folder-picker-hint').innerText()).includes('Paste'));
    await unsupported.locator(S.projectFolder).fill(projects.A); await unsupported.getByRole('button', { name: 'Open project', exact: true }).click(); await waitForDocument(unsupported, 'example-store');
    c.check('F1 unsupported picker still permits explicit Open project', (await unsupported.locator(S.title).innerText()) === 'Project A'); await unsupported.close();
    for (const width of [390, 820, 1280, 1440]) for (const appearance of ['light', 'dark']) {
      const { page: mobile, context: mc } = await openPage(browser, { width, height: 900 });
      await mc.addInitScript((value) => localStorage.setItem('nessa-state-browser:appearance', value), appearance);
      await mobile.goto(BASE); await mobile.locator(S.projectFolder).waitFor();
      const g = await geometry(mobile); c.check(`welcome ${width} ${appearance}: no overflow`, g.horizontalOverflow === 0 && g.overflowingElements.length === 0 && await mobile.locator('.open-project p code').first().evaluate((el) => getComputedStyle(el).whiteSpace === 'nowrap' && el.getClientRects().length === 1), g);
      await mc.close();
    }
    c.check('onboarding has no page errors', errors.page.length === 0, errors);
    facts.errors = errors;
  } catch (error) { c.check('onboarding completed', false, { error: String(error), stack: error.stack }); }
  finally { await browser.close(); rmSync(temporary, { recursive: true, force: true }); }
  const result = { script: 'onboarding', engine, baseUrl: BASE, ok: c.ok, passed: c.list.filter((x) => x.pass).length, total: c.list.length, facts, checks: c.list };
  writeResult(`${engine}-onboarding`, result); return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runOnboarding(process.argv[2] || 'chromium'); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1;
}
