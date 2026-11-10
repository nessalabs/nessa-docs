// Verifies the browser against whatever docs/state currently holds (default
// BASE_URL http://127.0.0.1:4311, the real repository). Discovers IDs from the
// catalog instead of assuming them, then:
//  - if the root is accepted: root → service by diagram node → deeper by
//    sidebar → back/breadcrumbs; renders every accepted document's diagrams
//    and requires one rendered SVG per Mermaid block in its Markdown (no
//    failed, too-large or outdated fallback); the root's component map has
//    its 13 linked services; search for a real title; unknown ID 404;
//  - always: Settings › Health shows exactly the issues the API reports, and a
//    rejected file's ID gets a 404 that explains why.
//
// Usage: BASE_URL=http://127.0.0.1:4311 node verification/real-data.mjs [chromium|webkit]
// Needs `npm run build` first: what counts as a Mermaid block is asked of its
// owner, shared/markdown.ts, as built into dist/server.

import { join } from 'node:path';
import {
  baseUrl,
  contrastOf,
  firstDiagramPlacement,
  nodeLinkFacts,
  provenanceFacts,
  checks,
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
import { lexMarkdown, markdownDiagrams, plainText } from '../dist/server/shared/markdown.js';

/** The root section whose chart is the component map (docs/state/README.md). */
const COMPONENT_MAP_SECTION = 'System overview';

/** The Mermaid blocks in a document's Markdown body, as the site itself finds them. */
const mermaidBlocks = (body) => markdownDiagrams(lexMarkdown(body));

export async function runRealData(engine) {
  const BASE = baseUrl('http://127.0.0.1:4311');
  const catalog = await (await fetch(`${BASE}/api/catalog`)).json();
  const byId = new Map(catalog.documents.map((d) => [d.id, d]));
  const playwright = loadPlaywright();
  const browser = await playwright[engine].launch();
  const { page, errors, context } = await openPage(browser, { width: 1440, height: 900 });
  const c = checks();
  const path = () => new URL(page.url()).pathname;
  const facts = {
    documents: catalog.documents.length,
    services: catalog.documents.filter((d) => d.kind === 'service').map((d) => d.id),
    errors: catalog.issues.filter((i) => i.severity === 'error').length,
    warnings: catalog.issues.filter((i) => i.severity === 'warning').length,
    rootId: catalog.rootId,
  };
  try {
    // Settings › Health mirrors the API exactly.
    await page.goto(`${BASE}/settings?tab=health`);
    await page.locator(`${S.health}[data-health-state="loaded"]`).waitFor();
    const shown = await page.locator('[data-issue-code]').count();
    c.check('settings health: every API issue is listed', shown === catalog.issues.length, { shown, api: catalog.issues.length });
    await page.screenshot({ path: join(SCREENSHOTS, `${engine}-real-settings-health.png`) });

    const rejected = catalog.issues.find((i) => i.severity === 'error' && i.documentId && !byId.has(i.documentId));
    if (rejected) {
      await page.goto(`${BASE}/docs/${rejected.documentId}`);
      await page.locator(S.notFound).waitFor();
      c.check('rejected ID: 404 explains the rejection', (await page.locator(S.issue(rejected.code)).count()) >= 1, { id: rejected.documentId, code: rejected.code });
    }
    await page.goto(`${BASE}/docs/no-such-document-id`);
    await page.locator(S.notFound).waitFor();
    c.check('unknown ID: explicit 404', (await page.locator(S.documentLayout).count()) === 0);

    if (!catalog.rootId) {
      await page.goto(`${BASE}/`);
      await page.locator('h1').filter({ hasText: 'No system document' }).waitFor();
      c.check('home without accepted root explains why', true);
      await page.screenshot({ path: join(SCREENSHOTS, `${engine}-real-home.png`) });
    } else {
      const root = byId.get(catalog.rootId);
      await page.goto(`${BASE}/`);
      await waitForDocument(page, root.id);
      await waitForDiagrams(page);
      facts.root = await svgFacts(page);
      await page.screenshot({ path: join(SCREENSHOTS, `${engine}-real-root.png`) });
      c.check('root: a row for every child', (await page.locator(S.childRows).count()) === root.children.length);
      const linked = await page.locator(S.diagramNodes).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-target-id')));
      c.check('root: diagram has linked nodes', linked.length > 0, { linked: [...new Set(linked)] });

      // Diagram drilldown into a service, then sidebar into its descendants.
      const service = linked.find((id) => byId.get(id)?.children.length) ?? linked[0];
      if (service) {
        await page.locator(S.diagramNode(service)).first().click();
        await page.locator('dialog.reference-peek[open] .inspector-open a').click();
        await waitForDocument(page, service);
        c.check(`diagram → ${service}`, path() === `/docs/${service}`);
        let current = byId.get(service);
        const trail = [service];
        while (current?.children.length) {
          const next = current.children[0];
          await page.locator(S.treeLink(next)).click();
          await waitForDocument(page, next);
          trail.push(next);
          current = byId.get(next);
        }
        await waitForDiagrams(page);
        await page.screenshot({ path: join(SCREENSHOTS, `${engine}-real-leaf.png`) });
        const crumbs = await page.locator(`${S.breadcrumbs} li`).count();
        c.check('sidebar descent: breadcrumbs match depth', crumbs === trail.length + 1, { trail, crumbs });
        if (trail.length > 1) {
          await page.goBack();
          await waitForDocument(page, trail[trail.length - 2]);
          c.check('back returns to previous document', path() === `/docs/${trail[trail.length - 2]}`);
          await page.locator(`${S.breadcrumbs} a`).first().click();
          await waitForDocument(page, root.id);
          c.check('breadcrumb returns to root', path() === `/docs/${root.id}`);
        }
      }

      // Every accepted document: render its diagrams, count outcomes, check overflow.
      const perDoc = [];
      for (const doc of catalog.documents) {
        await page.goto(`${BASE}/docs/${doc.id}`);
        await waitForDocument(page, doc.id);
        await waitForDiagrams(page);
        const svgs = await svgFacts(page);
        const figures = await page.locator(S.diagram).evaluateAll((all) => all.map((f) => ({ index: Number(f.dataset.diagramIndex), state: f.dataset.state })));
        const expected = mermaidBlocks((await (await fetch(`${BASE}/api/documents/${doc.id}`)).json()).body).length;
        const g = await geometry(page);
        const view = await page.evaluate(() =>
          [...document.querySelectorAll('figure.diagram[data-state="rendered"]')].map((figure) => {
            const svg = figure.querySelector('.diagram-svg svg');
            const handlers = svg ? [...svg.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length : 0;
            const scripts = svg ? svg.querySelectorAll('script, iframe, object, embed').length : 0;
            const jsLinks = svg ? [...svg.querySelectorAll('a')].filter((a) => /^\s*javascript:/i.test(a.getAttribute('href') || a.getAttribute('xlink:href') || '')).length : 0;
            return {
              scale: Number.parseInt(figure.querySelector('[data-testid="diagram-scale"]')?.textContent || '0', 10),
              fits: figure.querySelector('.diagram-stage')?.hasAttribute('data-fits') ?? false,
              unsafe: handlers + scripts + jsLinks,
            };
          }),
        );
        perDoc.push({
          id: doc.id,
          expected,
          diagrams: svgs.length,
          rendered: svgs.filter((s) => s.state === 'rendered' && s.svgElements > 0).length,
          renderedIndexes: figures.filter((f, i) => f.state === 'rendered' && svgs[i].svgElements > 0).map((f) => f.index),
          failed: svgs.filter((s) => s.state === 'failed').length,
          fallbacks: figures.filter((f) => f.state !== 'rendered'),
          linkedNodes: svgs.reduce((n, s) => n + s.linkedNodes, 0),
          horizontalOverflow: g.horizontalOverflow,
          minScale: view.length ? Math.min(...view.map((v) => v.scale)) : null,
          belowReadable: view.filter((v) => v.scale < 82 && !v.fits).length,
          unsafeSvgNodes: view.reduce((n, v) => n + v.unsafe, 0),
        });
      }
      facts.perDocument = perDoc;
      facts.diagramTotals = perDoc.reduce(
        (t, d) => ({ mermaidBlocks: t.mermaidBlocks + d.expected, diagrams: t.diagrams + d.diagrams, rendered: t.rendered + d.rendered, failed: t.failed + d.failed, fallbacks: t.fallbacks + d.fallbacks.length }),
        { mermaidBlocks: 0, diagrams: 0, rendered: 0, failed: 0, fallbacks: 0 },
      );
      // Diagram i of the Markdown is figure i, drawn: a fallback (failed, too-large, outdated) is a failure here.
      const allDrawn = (d) => d.diagrams === d.expected && d.fallbacks.length === 0 && d.renderedIndexes.join() === Array.from({ length: d.expected }, (_, i) => i).join();
      c.check('all documents: every Mermaid block in the Markdown renders as SVG, none falls back', perDoc.every(allDrawn), {
        ...facts.diagramTotals,
        failing: perDoc.filter((d) => !allDrawn(d)).map((d) => ({ id: d.id, expected: d.expected, renderedIndexes: d.renderedIndexes, fallbacks: d.fallbacks })),
      });
      c.check('all documents: no horizontal overflow at 1440', perDoc.every((d) => d.horizontalOverflow === 0));
      c.check('all diagrams: first view is the whole diagram or ≥ 82% (text ≥ ~11.5px)', perDoc.every((d) => d.belowReadable === 0), {
        smallestScale: Math.min(...perDoc.filter((d) => d.minScale !== null).map((d) => d.minScale)),
      });
      c.check('all diagrams: strict SVG has no handlers, scripts or javascript: links', perDoc.every((d) => d.unsafeSvgNodes === 0));

      // 1280×800, every document: diagrams first, and Details holds the same diagrams inline.
      const laptop = await openPage(browser, { width: 1280, height: 800 });
      const placements = [];
      for (const doc of catalog.documents) {
        await laptop.page.goto(`${BASE}/docs/${doc.id}`);
        await waitForDocument(laptop.page, doc.id);
        await waitForDiagrams(laptop.page);
        const diagramsView = await laptop.page.locator('.diagram-view figure.diagram').count();
        const placement = diagramsView > 0 ? await firstDiagramPlacement(laptop.page) : null;
        const footer = await provenanceFacts(laptop.page);
        const apiLinks = Object.values((await (await fetch(`${BASE}/api/documents/${doc.id}`)).json()).diagramLinks).map((crumb) => crumb.id);
        const nodesFacts = await nodeLinkFacts(laptop.page);
        await laptop.page.goto(`${BASE}/docs/${doc.id}?view=details`);
        await waitForDocument(laptop.page, doc.id);
        const inline = await laptop.page.locator('.prose figure.diagram').count();
        const proseChars = await laptop.page.locator('.prose').evaluate((el) => el.textContent.length).catch(() => 0);
        placements.push({
          id: doc.id,
          kind: doc.kind,
          diagramsView,
          inline,
          proseChars,
          footerClosedLast: footer.exists && !footer.open && !footer.bodyVisible && footer.isLastChild,
          linkedNodes: nodesFacts.linked,
          linkMarks: nodesFacts.linkedWithMark,
          insetCues: nodesFacts.insetCues,
          linksHonest:
            nodesFacts.linkedWithRole === nodesFacts.linked &&
            nodesFacts.unlinkedInert === nodesFacts.unlinked &&
            nodesFacts.targets.every((id) => apiLinks.includes(id)),
          markProblems: nodesFacts.markProblems,
          opensLists: nodesFacts.opensLists,
          ...(placement ?? {}),
        });
      }
      await laptop.context.close();
      facts.placements1280 = placements;
      const withDiagrams = placements.filter((p) => p.diagramsView > 0);
      facts.placementSummary = {
        documentsWithDiagrams: withDiagrams.length,
        readOnly: placements.length - withDiagrams.length,
        maxFigureTop: Math.max(...withDiagrams.map((p) => p.figureTop)),
        minWidth: Math.min(...withDiagrams.map((p) => p.width)),
        minVisibleOrWhole: Math.min(...withDiagrams.map((p) => Math.min(p.visibleHeight, 9999))),
      };
      c.check('1280×800: every document with diagrams opens on one ≤ 180px from the top', withDiagrams.every((p) => p.figureTop <= 180), facts.placementSummary);
      c.check('1280×800: first diagram spans the reading column', withDiagrams.every((p) => p.width >= p.columnWidth - 2));
      c.check('1280×800: all of the first diagram, or ≥ 450px of it, is visible', withDiagrams.every((p) => p.visibleHeight >= Math.min(450, p.stageHeight)), {
        failing: withDiagrams.filter((p) => p.visibleHeight < Math.min(450, p.stageHeight)).map((p) => p.id),
      });
      c.check('Details holds every diagram inline, and the prose', placements.every((p) => p.inline === p.diagramsView && p.proseChars > 0), {
        failing: placements.filter((p) => p.inline !== p.diagramsView || p.proseChars === 0).map((p) => p.id),
      });

      facts.nodeLinks = {
        linkedNodes: placements.reduce((n, p) => n + p.linkedNodes, 0),
        withCue: placements.reduce((n, p) => n + p.linkMarks, 0),
        insetCues: placements.reduce((n, p) => n + p.insetCues, 0),
        documentsWithLinks: placements.filter((p) => p.linkedNodes > 0).length,
      };
      c.check('every document: only diagramLinks targets are links; all other nodes inert', placements.every((p) => p.linksHonest), {
        failing: placements.filter((p) => !p.linksHonest).map((p) => p.id),
      });
      c.check('every document: link marks sit inside their node and clear of its label', placements.every((p) => p.markProblems === 0), {
        failing: placements.filter((p) => p.markProblems > 0).map((p) => p.id),
      });
      c.check('every document: no "Opens" destination list under any diagram', placements.every((p) => p.opensLists === 0));
      c.check('every document: every linked node shows an at-rest shape cue (+ mark, or inset outline where the label leaves no room)', placements.every((p) => p.linkMarks === p.linkedNodes), facts.nodeLinks);

      // The system overview's component map: 13 linked services, the external provider runtime inert; mouse and keyboard drilldown.
      // Other root charts (the launch/send sequence) link nodes too; only the component map is counted here.
      const rootBlocks = mermaidBlocks((await (await fetch(`${BASE}/api/documents/${root.id}`)).json()).body);
      const mapIndexes = rootBlocks.flatMap((block, i) => (plainText(block.heading?.tokens) === COMPONENT_MAP_SECTION ? [i] : []));
      const mapIndex = mapIndexes.length === 1 ? mapIndexes[0] : -1;
      const componentMap = S.diagramAt(mapIndex);
      const nav = await openPage(browser, { width: 1440, height: 900 });
      await nav.page.goto(`${BASE}/docs/${root.id}`);
      await waitForDocument(nav.page, root.id);
      await waitForDiagrams(nav.page);
      const mapCaption = await nav.page.locator(`${componentMap} .diagram-caption-text`).textContent().catch(() => null);
      c.check(`root: one component map chart, under "${COMPONENT_MAP_SECTION}"`, mapIndexes.length === 1 && mapCaption === COMPONENT_MAP_SECTION, { mapIndexes, mapCaption, rootBlocks: rootBlocks.length });
      const rootLinks = await nodeLinkFacts(nav.page, componentMap);
      const allRootLinks = await nodeLinkFacts(nav.page);
      const provider = nav.page.locator(`${componentMap} .diagram-svg g.node`, { hasText: 'External provider runtime' });
      const providerFacts = (await provider.count())
        ? await provider.first().evaluate((n) => ({ role: n.getAttribute('role'), tabindex: n.getAttribute('tabindex'), target: n.getAttribute('data-target-id'), mark: Boolean(n.querySelector('.diagram-depth-mark')), cursor: getComputedStyle(n).cursor }))
        : null;
      if (providerFacts) await provider.first().click({ force: true });
      await nav.page.waitForTimeout(300);
      const stayed = new URL(nav.page.url()).pathname === `/docs/${root.id}`;
      facts.rootLinks = { componentMapIndex: mapIndex, linkedInAllRootCharts: allRootLinks.linked, linked: rootLinks.linked, withMark: rootLinks.linkedWithMark, unlinked: rootLinks.unlinked, provider: providerFacts, linkedStyle: rootLinks.linkedStyle, unlinkedStyle: rootLinks.unlinkedStyle };
      await nav.page.screenshot({ path: join(SCREENSHOTS, `${engine}-real-root-links.png`) });
      c.check('root component map: 13 linked service nodes, each marked; tint and border differ from unlinked', rootLinks.linked === 13 && rootLinks.linkedWithMark === 13 && rootLinks.insetCues === 0 && rootLinks.linkedStyle?.fill !== rootLinks.unlinkedStyle?.fill && rootLinks.linkedStyle?.stroke !== rootLinks.unlinkedStyle?.stroke, facts.rootLinks);
      c.check('root: External provider runtime is not a link and clicking it goes nowhere', providerFacts !== null && providerFacts.role === null && providerFacts.tabindex === null && providerFacts.target === null && !providerFacts.mark && providerFacts.cursor !== 'pointer' && stayed, providerFacts);
      await nav.page.locator(S.diagramNode('mcp')).first().focus();
      await nav.page.keyboard.press('Enter');
      await nav.page.locator('dialog.reference-peek[open] .inspector-open a').click();
      await waitForDocument(nav.page, 'mcp');
      c.check('root → MCP by keyboard (Enter on the focused node)', new URL(nav.page.url()).pathname === '/docs/mcp');
      await waitForDiagrams(nav.page);
      const mcpLinks = await nodeLinkFacts(nav.page);
      const mcpTarget = mcpLinks.targets[0];
      if (mcpTarget) {
        await nav.page.locator(S.diagramNode(mcpTarget)).first().click();
        await nav.page.locator('dialog.reference-peek[open] .inspector-open a').click();
        await waitForDocument(nav.page, mcpTarget);
      }
      c.check('MCP service → leaf by mouse on a linked node', Boolean(mcpTarget) && new URL(nav.page.url()).pathname === `/docs/${mcpTarget}`, { mcpTargets: mcpLinks.targets });
      await nav.page.goto(`${BASE}/docs/${root.id}`);
      await waitForDocument(nav.page, root.id);
      await waitForDiagrams(nav.page);
      await nav.page.locator(S.diagramNode('gateway')).first().click();
      await nav.page.locator('dialog.reference-peek[open] .inspector-open a').click();
      await waitForDocument(nav.page, 'gateway');
      c.check('root → Local gateway by mouse', new URL(nav.page.url()).pathname === '/docs/gateway');
      await nav.context.close();

      c.check('every document: Sources and provenance is closed at load and last on the page', placements.every((p) => p.footerClosedLast), {
        failing: placements.filter((p) => !p.footerClosedLast).map((p) => p.id),
      });

      // The reported page, a service and a second leaf: closed, below, complete when opened, never moving the chart.
      const footerPages = ['gateway-attachments-drop-files-folders-text-or-a-web-image', 'host', 'storage-publication'].filter((id) => byId.has(id));
      const footerFacts = {};
      const desk = await openPage(browser, { width: 1280, height: 800 });
      for (const id of footerPages) {
        const api = await (await fetch(`${BASE}/api/documents/${id}`)).json();
        for (const view of ['diagrams', 'details']) {
          await desk.page.goto(`${BASE}/docs/${id}?view=${view}`);
          await waitForDocument(desk.page, id);
          await waitForDiagrams(desk.page);
          const closed = await provenanceFacts(desk.page);
          const placement = view === 'diagrams' ? await firstDiagramPlacement(desk.page) : null;
          await desk.page.locator(S.provenanceSummary).focus();
          await desk.page.keyboard.press('Enter');
          const open = await provenanceFacts(desk.page);
          const sourcesShown = await desk.page.locator('details.provenance .source-list li').count();
          footerFacts[`${id}:${view}`] = {
            closedAtLoad: !closed.open && !closed.bodyVisible,
            belowContent: closed.isLastChild && closed.top >= closed.contentBottom,
            figureTop: placement?.figureTop ?? null,
            summary: closed.summary,
            apiSources: api.sources.length,
            sourcesShown,
            showsFileAndId: open.text.includes(api.document.file) && open.text.includes(id),
            chartUnmoved: closed.firstFigureDocTop === open.firstFigureDocTop,
          };
          await desk.page.keyboard.press('Enter');
          footerFacts[`${id}:${view}`].keyboardCloses = !(await provenanceFacts(desk.page)).open;
          if (view === 'diagrams') await desk.page.screenshot({ path: join(SCREENSHOTS, `${engine}-real-footer-${id}.png`) });
        }
      }
      // Opened on one page, then a sidebar move to the next: closed there; and closed again on Back.
      await desk.page.goto(`${BASE}/docs/${footerPages[0]}`);
      await waitForDocument(desk.page, footerPages[0]);
      await desk.page.locator(S.provenanceSummary).click();
      await desk.page.locator(S.treeLink(footerPages[1])).click();
      await waitForDocument(desk.page, footerPages[1]);
      const nextClosed = !(await provenanceFacts(desk.page)).open;
      await desk.page.goBack();
      await waitForDocument(desk.page, footerPages[0]);
      const backClosed = !(await provenanceFacts(desk.page)).open;
      await desk.context.close();
      facts.footer = { pages: footerFacts, nextClosed, backClosed };
      const rows = Object.values(footerFacts);
      c.check('footer pages: closed at load, below the content, in both views', rows.length === footerPages.length * 2 && rows.every((r) => r.closedAtLoad && r.belowContent), footerFacts);
      c.check('footer pages: chart still begins ≤ 180px with the footer present', rows.filter((r) => r.figureTop !== null).every((r) => r.figureTop <= 180));
      c.check('footer pages: opening shows every source, the file and the ID, and leaves the chart in place', rows.every((r) => r.sourcesShown === r.apiSources && r.showsFileAndId && r.chartUnmoved));
      c.check('footer pages: keyboard opens and closes it', rows.every((r) => r.keyboardCloses));
      c.check('footer: the next document starts closed, and Back arrives closed', nextClosed && backClosed, { nextClosed, backClosed });

      // Contrast in both appearances, measured on rendered pixels' colours.
      const sample = catalog.documents.find((d) => d.kind === 'service' && d.children.length > 0) ?? root;
      facts.contrast = {};
      for (const appearance of ['dark', 'light']) {
        await page.evaluate((a) => localStorage.setItem('nessa-state-browser:appearance', a), appearance);
        // Details view: the prose and its links are what is measured.
        await page.goto(`${BASE}/docs/${sample.id}?view=details`);
        await waitForDocument(page, sample.id);
        await page.locator('.prose').waitFor();
        await page.locator('#main').evaluate((main) => main.scrollTo(0, 400));
        const measured = {};
        for (const [name, selector] of Object.entries({
          prose: '.prose p',
          title: '#doc-title',
          meta: '.document-meta .document-kind',
          childSummary: '.child-summary',
          breadcrumb: '.breadcrumbs a',
          sidebarRow: '.tree .row:not([aria-current])',
          sectionLabel: '.section-toggle',
          proseLink: '.prose a.doc-link',
          // Hidden at rest; this is the colour it shows on heading hover and keyboard focus.
          headingAnchor: '.prose a.heading-anchor',
          searchPlaceholderBox: '#doc-search',
        })) {
          measured[name] = await contrastOf(page, selector);
        }
        facts.contrast[appearance] = measured;
        await page.screenshot({ path: join(SCREENSHOTS, `${engine}-real-${appearance}-service.png`) });
        const text = Object.entries(measured);
        c.check(`contrast ${appearance}: every listed text measured and ≥ 4.5:1`, text.every(([, v]) => v !== null && v >= 4.5), measured);
      }
      await page.evaluate(() => localStorage.removeItem('nessa-state-browser:appearance'));

      // Search a real title word.
      const word = (catalog.documents.find((d) => d.kind !== 'system') ?? root).title.split(/\s+/).find((w) => w.length > 3) ?? root.title;
      await page.goto(`${BASE}/`);
      await page.locator(S.search).fill(word);
      await page.locator(S.searchResults).first().waitFor({ timeout: 5000 });
      c.check(`search "${word}" finds documents`, (await page.locator(S.searchResults).count()) > 0);
    }
    c.check('no page errors', errors.page.length === 0, { pageErrors: errors.page });
    const unexpected = errors.console.filter((e) => !/status of 404/.test(e.text));
    c.check('no console errors besides expected 404 lookups', unexpected.length === 0, { unexpected });
    facts.consoleErrors = errors.console.length;
  } catch (error) {
    c.check('real-data run completed without exception', false, { error: String(error), url: page.url() });
  } finally {
    await context.close();
    await browser.close();
  }
  const result = { engine, script: 'real-data', baseUrl: BASE, ok: c.ok, passed: c.list.filter((x) => x.pass).length, total: c.list.length, checks: c.list, facts };
  writeResult(`real-data-${engine}`, result);
  log(engine, JSON.stringify({ script: result.script, ok: result.ok, passed: result.passed, total: result.total, documents: facts.documents, errors: facts.errors, warnings: facts.warnings, diagramTotals: facts.diagramTotals }));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runRealData(process.argv[2] || 'chromium');
  console.log(JSON.stringify({ engine: result.engine, ok: result.ok, passed: result.passed, total: result.total }));
  process.exit(result.ok ? 0 : 1);
}
