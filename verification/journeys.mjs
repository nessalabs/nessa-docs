// Desktop journeys against the TEMP fixture (or any docs/state with the same
// IDs): root → service → feature → flow by diagram and by sidebar,
// breadcrumbs, back/forward, search, unknown documents, Settings › Health, escaping,
// broken diagram fallback, navigation race, keyboard drilldown.
//
// Usage: node verification/journeys.mjs [chromium|webkit]   (BASE_URL, default http://127.0.0.1:4312)

import { join } from 'node:path';
import {
  activeElement,
  baseUrl,
  checks,
  firstDiagramPlacement,
  nodeLinkFacts,
  provenanceFacts,
  geometry,
  loadPlaywright,
  log,
  openPage,
  SCREENSHOTS,
  svgFacts,
  waitForDiagrams,
  waitForDocument,
  writeResult,
} from './lib.mjs';
import { S } from './selectors.mjs';

export async function runJourneys(engine) {
  const BASE_URL = baseUrl();
  const playwright = loadPlaywright();
  const browser = await playwright[engine].launch();
  const { page, errors, context } = await openPage(browser, { width: 1440, height: 900 });
  const c = checks();
  const shot = (name) => page.screenshot({ path: join(SCREENSHOTS, `${engine}-${name}.png`), fullPage: false });
  const path = () => new URL(page.url()).pathname;
  const title = () => page.locator(S.title).innerText();
  const facts = {};

  try {
    // 1. Root renders its system diagram live as SVG with linked service nodes.
    await page.goto(`${BASE_URL}/`);
    await waitForDocument(page, 'nessa');
    await waitForDiagrams(page);
    facts.root = await svgFacts(page);
    c.check('root: system title', (await title()) === 'Nessa system');
    c.check('root: diagram is live SVG with 3 linked nodes', facts.root[0]?.state === 'rendered' && facts.root[0].linkedNodes === 3 && facts.root[0].svgElements > 20 && !facts.root[0].hasImgFallback, facts.root[0]);
    c.check('root: service rows', (await page.locator(S.childRows).count()) === 3);
    c.check('root: every child row carries a trailing chevron', (await page.locator(`${S.childRows} .child-chevron`).count()) === 3);
    facts.rootNodes = await nodeLinkFacts(page);
    const rn = facts.rootNodes;
    c.check('root: only diagramLinks nodes are links (role, tab stop, "Open …" label)', rn.linked === 3 && rn.linkedWithRole === 3 && rn.targets.sort().join() === 'chat,desktop,gateway', rn);
    c.check('root: unlinked nodes stay inert (no role, no tab stop, no mark, no pointer)', rn.unlinked >= 2 && rn.unlinkedInert === rn.unlinked, rn);
    c.check('root: linked nodes differ at rest — mark, fill and border', rn.linkedWithMark === 3 && rn.insetCues === 0 && rn.linkedStyle.fill !== rn.unlinkedStyle.fill && rn.linkedStyle.stroke !== rn.unlinkedStyle.stroke && rn.markProblems === 0, {
      linked: rn.linkedStyle,
      unlinked: rn.unlinkedStyle,
      markProblems: rn.markProblems,
    });
    c.check('root: no "Opens" destination list; the diagram is a labelled group', rn.opensLists === 0 && !rn.opensText && rn.svgRoles[0] === 'group', rn);
    const beforeUnlinked = path();
    await page.locator('figure.diagram .diagram-svg g.node:not([data-target-id])').first().click({ force: true });
    await page.waitForTimeout(300);
    c.check('root: clicking an unlinked node goes nowhere', path() === beforeUnlinked);
    facts.rootGeometry = await geometry(page);
    c.check('root: no horizontal overflow at 1440', facts.rootGeometry.horizontalOverflow === 0, facts.rootGeometry);
    c.check('root: sidebar 260px and visible', facts.rootGeometry.sidebar?.width === 260 && facts.rootGeometry.sidebar.visible, facts.rootGeometry.sidebar);
    c.check('root: diagram spans the reading column', facts.rootGeometry.firstDiagram.width >= facts.rootGeometry.document.width - 2, {
      diagram: facts.rootGeometry.firstDiagram,
      document: facts.rootGeometry.document,
    });
    facts.rootPlacement = await firstDiagramPlacement(page);
    c.check('root: diagram first — begins ≤ 180px, spans the column, all of it or ≥ 450px visible', facts.rootPlacement.figureTop <= 180 && facts.rootPlacement.width >= facts.rootPlacement.columnWidth - 2 && facts.rootPlacement.visibleHeight >= Math.min(450, facts.rootPlacement.stageHeight), facts.rootPlacement);
    c.check('root: Back and Forward disabled on the first page', (await page.locator(S.back).getAttribute('aria-disabled')) === 'true' && (await page.locator(S.forward).getAttribute('aria-disabled')) === 'true');
    await shot('01-root');

    // 2. Diagram drilldown: system → service (flowchart node).
    await page.locator(S.diagramNode('chat')).first().click();
    await waitForDocument(page, 'chat');
    await waitForDiagrams(page);
    facts.chat = await svgFacts(page);
    c.check('diagram→service: URL /docs/chat', path() === '/docs/chat', { path: path() });
    c.check('diagram→service: title', (await title()) === 'Chat');
    c.check('diagram→service: breadcrumbs', (await page.locator(`${S.breadcrumbs} li`).evaluateAll((items) => items.map((li) => li.textContent.trim()))).join(' > ') === 'Nessa system > Chat');
    c.check('diagram→service: no stale root diagram', (await page.locator(S.diagramNode('gateway')).count()) === 0 && facts.chat[0]?.linkedNodes === 2, facts.chat);
    c.check('diagram→service: focus moved to title', (await activeElement(page))?.id === 'doc-title');
    facts.servicePlacement = await firstDiagramPlacement(page);
    c.check('service: diagram first — begins ≤ 180px, spans the column', facts.servicePlacement.figureTop <= 180 && facts.servicePlacement.width >= facts.servicePlacement.columnWidth - 2, facts.servicePlacement);
    c.check('service: prose is behind the Details switch; no "…are in Read" boilerplate', (await page.locator('.prose').count()) === 0 && (await page.locator(S.readAll).count()) === 0 && (await page.locator(S.viewDetails).count()) === 1 && !(await page.locator('article.document').innerText()).includes('every section are in'));
    c.check('service: no Markdown or Mermaid source controls', (await page.locator(S.removedSourceControls).count()) === 0 && (await page.locator('.titlebar [data-view="read"]').count()) === 0);
    await shot('02-service');
    await page.locator(S.viewDetails).click();
    await page.locator('.prose').waitFor();
    c.check('Details: URL says ?view=details', new URL(page.url()).searchParams.get('view') === 'details');
    c.check('Details: evidence present and missing flagged', (await page.locator('[data-evidence="repo-file"].evidence-missing').count()) === 1 && (await page.locator('[data-evidence="repo-file"].evidence-present').count()) >= 2);
    c.check('Details: every diagram is also inline', (await page.locator('.prose figure.diagram').count()) === facts.chat.length);
    await shot('02b-service-details');
    await page.goBack();
    await page.locator('.diagram-view').waitFor();
    c.check('Back from Details returns to Diagrams', path() === '/docs/chat' && !new URL(page.url()).searchParams.has('view') && (await page.locator('.prose').count()) === 0);
    await waitForDiagrams(page);

    // 3. Service → feature (state diagram node) → flow (flowchart node).
    await page.locator(S.diagramNode('chat-send')).first().click();
    await waitForDocument(page, 'chat-send');
    await waitForDiagrams(page);
    c.check('diagram→feature: URL', path() === '/docs/chat-send', { path: path() });
    facts.featurePlacement = await firstDiagramPlacement(page);
    c.check('feature: diagram first — begins ≤ 180px, spans the column', facts.featurePlacement.figureTop <= 180 && facts.featurePlacement.width >= facts.featurePlacement.columnWidth - 2, facts.featurePlacement);
    await page.locator(S.diagramNode('chat-send-first')).first().click();
    await waitForDocument(page, 'chat-send-first');
    await waitForDiagrams(page);
    facts.flow = await svgFacts(page);
    c.check('diagram→flow: URL', path() === '/docs/chat-send-first', { path: path() });
    c.check('diagram→flow: breadcrumbs 4 deep', (await page.locator(`${S.breadcrumbs} li`).count()) === 4);
    c.check('flow: valid diagram rendered, broken one falls back to source + error', facts.flow[0]?.state === 'rendered' && facts.flow[1]?.state === 'failed', facts.flow);
    const fallback = page.locator(`${S.failedDiagram} .diagram-source`);
    c.check('flow: fallback shows the Mermaid source', (await fallback.innerText()).includes('A[unclosed --> B'));
    c.check('flow: fallback shows the renderer error', ((await page.locator(`${S.failedDiagram} .diagram-error p`).innerText()) || '').length > 0);
    await page.locator(S.viewDetails).click();
    await page.locator('.prose').waitFor();
    await waitForDiagrams(page);
    c.check('flow Details: no "Opens" list under inline diagrams', (await nodeLinkFacts(page)).opensLists === 0);
    c.check('flow Details: both diagrams inline, broken one still explained, its source shown as the diagnostic', (await page.locator('.prose figure.diagram[data-state="failed"] .diagram-source').count()) === 1 && (await page.locator('.prose figure.diagram[data-state="rendered"] .diagram-source').count()) === 0);
    c.check('flow Details: both diagrams inline (count)', (await page.locator('.prose figure.diagram').count()) === 2 && (await page.locator('.prose figure.diagram[data-state="failed"]').count()) === 1);
    const proseText = await page.locator('.prose').innerText();
    const injected = await page.evaluate(() => ({
      scripts: document.querySelectorAll('#main script').length,
      images: document.querySelectorAll('#main img').length,
      alerted: Boolean(window.__alerted),
    }));
    c.check('flow: raw HTML shown as text, not executed', proseText.includes('<script>alert("x")</script>') && injected.scripts === 0 && injected.images === 0, injected);
    c.check('flow: no permanent outline column', (await page.locator(S.outline).count()) === 0);
    await page.locator(S.outlineButton).click();
    c.check('flow: outline popover lists headings and takes focus', (await page.locator(`${S.outline} a`).count()) >= 3 && (await activeElement(page))?.tag === 'a');
    const outlineStyle = await page.locator(S.outline).evaluate(e => ({ background: getComputedStyle(e).backgroundColor, filter: getComputedStyle(e).backdropFilter }));
    c.check('flow: outline uses an opaque surface without backdrop blur', !outlineStyle.background.includes(' / ') && !outlineStyle.background.startsWith('rgba') && outlineStyle.filter === 'none', outlineStyle);
    await page.keyboard.press('Escape');
    c.check('flow: Escape closes outline and returns focus', (await page.locator(S.outline).count()) === 0 && (await activeElement(page))?.action === 'outline');
    // Provenance (file, ID, sources) is a closed footer after the content, in Details too.
    c.check('flow: no titlebar details button above the content', (await page.locator(S.oldDetailsButton).count()) === 0);
    const readFooter = await provenanceFacts(page);
    c.check('flow Details: provenance closed and after all content', readFooter.exists && !readFooter.open && !readFooter.bodyVisible && readFooter.isLastChild && readFooter.top >= readFooter.contentBottom, readFooter);
    await page.locator(S.provenanceSummary).focus();
    await page.keyboard.press('Enter');
    const readOpen = await provenanceFacts(page);
    c.check('flow Details: Enter opens it with file, ID and sources', readOpen.open && readOpen.text.includes('docs/state/services/chat/send/first-send.md') && readOpen.text.includes('chat-send-first') && (await page.locator('details.provenance [data-evidence="repo-file"]').count()) >= 1, { summary: readOpen.summary });
    await page.keyboard.press('Enter');
    c.check('flow Details: Enter closes it', !(await provenanceFacts(page)).open);
    c.check('flow: no Markdown source control in either view (removed)', (await page.locator(S.removedSourceControls).count()) === 0);
    await page.goBack();
    await page.locator('.diagram-view').waitFor();
    c.check('flow: Back returns from Details to Diagrams', path() === '/docs/chat-send-first' && (await page.locator('.prose').count()) === 0);
    const diagramFooter = await provenanceFacts(page);
    c.check('flow Diagrams: provenance closed and after the charts and children', diagramFooter.exists && !diagramFooter.open && diagramFooter.isLastChild && diagramFooter.top >= diagramFooter.contentBottom, diagramFooter);
    await page.locator(S.provenanceSummary).focus();
    await page.keyboard.press('Space');
    const diagramOpen = await provenanceFacts(page);
    c.check('flow Diagrams: opening it leaves the first diagram where it was', diagramOpen.open && diagramOpen.bodyVisible && diagramOpen.sourceItems >= 1 && diagramOpen.firstFigureDocTop === diagramFooter.firstFigureDocTop, {
      before: diagramFooter.firstFigureDocTop,
      after: diagramOpen.firstFigureDocTop,
    });
    await shot('03-flow');

    // 4. Breadcrumbs and browser history.
    await page.locator(S.breadcrumbLink('Chat')).click();
    await waitForDocument(page, 'chat');
    c.check('breadcrumb → Chat', path() === '/docs/chat');
    c.check('next document: provenance starts closed (no leak)', (await provenanceFacts(page)).open === false);
    await page.goBack();
    await waitForDocument(page, 'chat-send-first');
    c.check('back → flow', path() === '/docs/chat-send-first' && (await title()) === 'First send lifecycle');
    c.check('back → flow: provenance closed again (closed on every arrival)', (await provenanceFacts(page)).open === false);
    await page.goBack();
    await waitForDocument(page, 'chat-send');
    c.check('back → feature', path() === '/docs/chat-send');
    await page.goForward();
    await waitForDocument(page, 'chat-send-first');
    c.check('forward → flow', path() === '/docs/chat-send-first');
    await page.locator(S.back).click();
    await waitForDocument(page, 'chat-send');
    c.check('titlebar Back → feature', path() === '/docs/chat-send');
    c.check('titlebar Forward enabled after Back', (await page.locator(S.forward).getAttribute('aria-disabled')) === null);
    await page.locator(S.forward).click();
    await waitForDocument(page, 'chat-send-first');
    c.check('titlebar Forward → flow', path() === '/docs/chat-send-first');

    // 5. Sequence diagram participant drilldown.
    await page.goto(`${BASE_URL}/docs/chat-send-retry`);
    await waitForDocument(page, 'chat-send-retry');
    await waitForDiagrams(page);
    facts.sequence = await svgFacts(page);
    c.check('sequence: participant linked', facts.sequence[0]?.linkedNodes >= 1, facts.sequence);
    await page.locator(S.diagramNode('gateway')).first().click();
    await waitForDocument(page, 'gateway');
    c.check('sequence participant → gateway', path() === '/docs/gateway');

    // 6. Sidebar: root → service → feature → flow.
    await page.goto(`${BASE_URL}/`);
    await waitForDocument(page, 'nessa');
    await page.locator(S.treeLink('chat')).click();
    await waitForDocument(page, 'chat');
    await page.locator(S.treeLink('chat-send')).click();
    await waitForDocument(page, 'chat-send');
    await page.locator(S.treeLink('chat-send-retry')).click();
    await waitForDocument(page, 'chat-send-retry');
    c.check('sidebar: root→service→feature→flow', path() === '/docs/chat-send-retry');
    c.check('sidebar: current item marked', (await page.locator(`${S.treeLink('chat-send-retry')}[aria-current="page"]`).count()) === 1);
    const chatToggle = page.locator(S.disclosure('Chat'));
    await chatToggle.click();
    c.check('sidebar: collapse hides children', (await chatToggle.getAttribute('aria-expanded')) === 'false' && (await page.locator(S.treeLink('chat-send')).count()) === 0);
    await chatToggle.click();
    c.check('sidebar: expand shows children', (await page.locator(S.treeLink('chat-send')).count()) === 1);
    await shot('04-sidebar');

    // 6b. Docked sidebar hides to give the reading pane the width, and comes back.
    const before = await geometry(page);
    await page.locator(S.menuButton).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#sidebar')).visibility === 'hidden');
    const hidden = await geometry(page);
    c.check('sidebar hide: main widens, sidebar out of reach', hidden.main.width > before.main.width + 200 && (await page.locator(S.sidebar).evaluate((el) => el.inert)), {
      before: before.main.width,
      after: hidden.main.width,
    });
    c.check('sidebar hide (keyboard): focus stays on the toggle', (await activeElement(page))?.sidebarToggle === true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#sidebar')).visibility === 'visible');
    c.check('sidebar show: restored', (await geometry(page)).main.width === before.main.width);

    // 6c. Expand a diagram to the window; Escape returns.
    await page.goto(`${BASE_URL}/docs/chat-send-first`);
    await waitForDocument(page, 'chat-send-first');
    await waitForDiagrams(page);
    await page.locator(S.expandButton).first().click();
    const expanded = await page.locator('figure.diagram[data-expanded]').boundingBox();
    c.check('expand: diagram fills the window', expanded && expanded.width >= 1440 - 20 && expanded.height >= 900 - 20, expanded);
    c.check('expand: focus moves into the dialog', (await activeElement(page))?.action === 'collapse');
    c.check('expand: no "Opens" list in the expanded diagram', (await page.locator('figure.diagram[data-expanded] .diagram-drilldown').count()) === 0 && !/\bOpens\b/.test(await page.locator('figure.diagram[data-expanded]').innerText()));
    await page.keyboard.press('Escape');
    c.check('expand: Escape closes and returns focus', (await page.locator('figure.diagram[data-expanded]').count()) === 0 && (await activeElement(page))?.action === 'expand');
    await shot('04b-flow-expanded-closed');

    // 6d. A section link opens Details at that heading; so does a caption's "In Details".
    await page.goto(`${BASE_URL}/docs/chat-send-first#decisions-and-failure-boundaries`);
    await page.locator('#decisions-and-failure-boundaries').waitFor();
    await waitForDiagrams(page);
    await page.waitForFunction(() => {
      const heading = document.getElementById('decisions-and-failure-boundaries');
      const main = document.getElementById('main');
      const top = Math.round(heading.getBoundingClientRect().top);
      const atEnd = Math.abs(main.scrollHeight - main.clientHeight - main.scrollTop) <= 2;
      return top >= 40 && (top <= 160 || (atEnd && top < 900)) && main.scrollTop > 0;
    }, null, { timeout: 6000 });
    const anchor = await page.locator('#decisions-and-failure-boundaries').evaluate((el) => {
      const main = document.getElementById('main');
      return {
        top: Math.round(el.getBoundingClientRect().top),
        atEnd: Math.abs(main.scrollHeight - main.clientHeight - main.scrollTop) <= 2,
        scrollTop: Math.round(main.scrollTop),
      };
    });
    c.check('deep link #anchor: opens Details with the heading at the top (or the pane at its end, heading visible)', (await page.locator('.prose').count()) === 1 && anchor.top >= 40 && (anchor.top <= 160 || (anchor.atEnd && anchor.top < 900)) && anchor.scrollTop > 0, anchor);
    await page.goto(`${BASE_URL}/docs/chat-send-first`);
    await waitForDocument(page, 'chat-send-first');
    await waitForDiagrams(page);
    await page.locator(S.detailsSection).first().click();
    await page.locator('#states').waitFor();
    await page.waitForTimeout(300);
    const sectionTop = await page.locator('#states').evaluate((el) => Math.round(el.getBoundingClientRect().top));
    c.check('caption "In Details": Details at that section', new URL(page.url()).searchParams.get('view') === 'details' && new URL(page.url()).hash === '#states' && sectionTop <= 160, { sectionTop, url: page.url() });

    // 7. Search over loaded documents.
    await page.locator(S.search).fill('uncertain');
    await page.locator(S.searchResults).first().waitFor({ timeout: 5000 });
    const results = await page.locator(S.searchResults).evaluateAll((links) => links.map((link) => link.dataset.docId));
    c.check('search: finds by body/summary text', results.includes('chat-send-retry'), { results });
    await shot('05-search');
    await page.locator(S.searchResult('chat-send-first')).click();
    await waitForDocument(page, 'chat-send-first');
    c.check('search: result navigates and clears', path() === '/docs/chat-send-first' && (await page.locator(S.search).inputValue()) === '');
    await page.locator(S.search).fill('zzzz-no-such-text');
    await page.locator('.search-status').filter({ hasText: 'No loaded document' }).waitFor({ timeout: 5000 });
    c.check('search: explicit empty result', true);
    await page.locator(S.search).fill('');

    // 8. Unknown routes are explicit 404s; nothing else is shown in their place.
    const consoleBefore404 = errors.console.length;
    await page.goto(`${BASE_URL}/docs/does-not-exist`);
    await page.locator(S.notFound).waitFor();
    c.check('unknown doc: explicit 404', (await page.locator(`${S.notFound} h1`).innerText()).includes('does-not-exist') && (await page.locator(S.documentLayout).count()) === 0);
    await shot('06-unknown');
    await page.goto(`${BASE_URL}/docs/..%2F..%2Fetc%2Fpasswd`);
    await page.locator(S.notFound).waitFor();
    c.check('traversal-shaped ID: 404', (await page.locator(S.documentLayout).count()) === 0);
    await page.goto(`${BASE_URL}/some/random/path`);
    await page.locator(S.notFound).waitFor();
    c.check('unknown path: 404', (await page.locator(`${S.notFound} h1`).innerText()).includes('/some/random/path'));
    const expected404Console = errors.console.slice(consoleBefore404);
    facts.expected404Console = expected404Console.length;

    // 9. Settings › Health lists the rejected fixture file by name.
    await page.goto(`${BASE_URL}/settings?tab=health`);
    await page.locator(`${S.health}[data-health-state="loaded"]`).waitFor();
    c.check('settings health: rejected file listed', (await page.locator(S.issue('missing-frontmatter')).innerText()).includes('draft-notes.md'));
    await shot('07-settings-health');

    // 10. Keyboard: Tab into a diagram node and press Enter.
    await page.goto(`${BASE_URL}/docs/nessa`);
    await waitForDocument(page, 'nessa');
    await waitForDiagrams(page);
    await page.locator(S.diagramNode('desktop')).first().focus();
    const focused = await activeElement(page);
    await page.keyboard.press('Enter');
    await waitForDocument(page, 'desktop');
    c.check('keyboard: Enter on focused diagram node navigates', path() === '/docs/desktop' && focused?.targetId === 'desktop', { focused });

    // 11. Race: a slow answer for an earlier navigation must not replace the newer page.
    await page.route('**/api/documents/chat', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.locator(S.treeLink('chat')).click();
    await page.locator(S.treeLink('gateway')).click();
    await waitForDocument(page, 'gateway');
    await page.waitForTimeout(1600);
    c.check('race: newer page stays after slow earlier answer', path() === '/docs/gateway' && (await title()) === 'Local gateway' && (await page.locator(S.diagramNodes).count()) === 0);
    await page.unroute('**/api/documents/chat');

    const unexpectedConsole = errors.console.filter((entry, index) => !(index >= consoleBefore404 && index < consoleBefore404 + expected404Console.length && /404/.test(entry.text)));
    c.check('no unexpected console errors', unexpectedConsole.length === 0, { unexpectedConsole });
    c.check('no page errors', errors.page.length === 0, { pageErrors: errors.page });
    const failedRequests = errors.requests.filter((request) => !/ERR_ABORTED|cancelled|NS_BINDING_ABORTED/i.test(request.failure));
    c.check('no failed requests', failedRequests.length === 0, { failedRequests });
    facts.consoleErrors = errors.console;
  } catch (error) {
    c.check('journey completed without exception', false, { error: String(error), url: page.url() });
    await shot('99-failure').catch(() => undefined);
  } finally {
    await context.close();
    await browser.close();
  }
  const result = { engine, script: 'journeys', baseUrl: BASE_URL, ok: c.ok, passed: c.list.filter((x) => x.pass).length, total: c.list.length, checks: c.list, facts };
  writeResult(`journeys-${engine}`, result);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runJourneys(process.argv[2] || 'chromium');
  console.log(JSON.stringify({ engine: result.engine, ok: result.ok, passed: result.passed, total: result.total }));
  process.exit(result.ok ? 0 : 1);
}
