// Navigation pass contracts, against the actual repository:
//  1. a pure-contract page (no charts) opens in Details with one introduction: the summary said once, the title
//     not repeated, no chart; a heading-first page and a controlled first paragraph that says something else keep the
//     header summary; search metadata kept; a guide without charts opens readable Details content
//  2. canvas pan/zoom: drag pans (no navigation), click/keyboard navigate, focal ctrl/⌘-wheel and pinch zoom, bounds,
//     plain wheel scrolls, buttons, expanded view, Details inline, light/dark, phone — with frame timing and SVG-mutation counts
//  3. sequence diagrams render (the system page's); a page from an older build recovers by one reload (typed, no loop);
//     a current build shows real errors
//  4. no "The description, evidence…" boilerplate and no "Opens" lists
// Usage: BASE_URL=http://127.0.0.1:4311 node verification/navigation.mjs [chromium|webkit] [--only=gestures]

import { join } from 'node:path';
import { activeElement, baseUrl, checks, loadPlaywright, log, openPage, SCREENSHOTS, waitForDiagrams, waitForDocument, writeResult } from './lib.mjs';
import { S } from './selectors.mjs';
import { lexMarkdown, plainText } from '../dist/server/shared/markdown.js';

const BOILERPLATE = 'The description, evidence and every section are in';
const CHART = 'host-startup-authenticate-reconnect-expire-or-revoke-a-surface-session';
// Pages chosen for what they are, not for their prose: a contract with no charts, a guide with no charts,
// the system page (its sequence diagram is found in its body), and the large statechart (no sequence diagram).
const CONTRACT = 'credentials-values';
const GUIDE = 'provenance';
const SEQUENCE_DOC = 'nessa';
const NO_SEQUENCE = CHART;

/** Document order of the first Mermaid block in `body` that is a sequence diagram; -1 if none. */
function sequenceIndex(body) {
  const blocks = [...body.matchAll(/^```mermaid\n([\s\S]*?)^```/gm)].map((m) => m[1].trim());
  return blocks.findIndex((source) => source.startsWith('sequenceDiagram'));
}

/** Stage scroll, scale, and the SVG point (natural units) under a client point. */
async function stageState(page, index = 0, point = null) {
  return page.evaluate(
    ({ index, point }) => {
      const figure = document.querySelectorAll('figure.diagram')[index];
      const stage = figure.querySelector('.diagram-stage');
      const svg = stage.querySelector('svg');
      const scale = Number.parseInt(figure.querySelector('[data-testid="diagram-scale"]').textContent, 10) / 100;
      const r = svg.getBoundingClientRect();
      const width = svg.viewBox.baseVal.width;
      const actual = r.width / width; // the real scale, not the rounded readout
      const s = stage.getBoundingClientRect();
      const p = point ?? { x: s.left + s.width / 2, y: s.top + s.height / 2 };
      return {
        left: stage.scrollLeft,
        top: stage.scrollTop,
        maxLeft: stage.scrollWidth - stage.clientWidth,
        maxTop: stage.scrollHeight - stage.clientHeight,
        scale,
        actual,
        natural: { x: (p.x - r.left) / actual, y: (p.y - r.top) / actual },
        stage: { x: s.left, y: s.top, width: s.width, height: s.height },
        pannable: stage.hasAttribute('data-pannable'),
        title: stage.getAttribute('title'),
      };
    },
    { index, point },
  );
}

/** Watches the SVG for re-insertion and samples frame intervals until `stop()`. */
async function startProbe(page) {
  await page.evaluate(() => {
    const host = document.querySelector('figure.diagram .diagram-svg');
    const probe = { svg: host.querySelector('svg'), mutations: 0, frames: [], running: true };
    probe.observer = new MutationObserver((records) => (probe.mutations += records.filter((r) => r.type === 'childList').length));
    probe.observer.observe(host, { childList: true });
    let last = performance.now();
    const tick = (now) => {
      probe.frames.push(now - last);
      last = now;
      if (probe.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__probe = probe;
  });
}
async function stopProbe(page) {
  return page.evaluate(() => {
    const probe = window.__probe;
    probe.running = false;
    probe.observer.disconnect();
    const frames = probe.frames.slice(1).sort((a, b) => a - b);
    const same = probe.svg === document.querySelector('figure.diagram .diagram-svg svg');
    return {
      svgReinserted: probe.mutations,
      sameSvgElement: same,
      frames: frames.length,
      medianMs: Math.round(frames[Math.floor(frames.length / 2)] * 10) / 10,
      maxMs: Math.round(frames[frames.length - 1] * 10) / 10,
      over50ms: frames.filter((f) => f > 50).length,
    };
  });
}

/** A drag paced at about one move per frame, so frame timing is sampled during it. */
async function drag(page, from, by, steps = 12, paced = false) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + (by.x * i) / steps, from.y + (by.y * i) / steps);
    if (paced) await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

/** A point inside the stage that is not on any node: sampled until elementFromPoint is the SVG or the stage. */
async function backgroundPoint(page, index = 0) {
  return page.evaluate((index) => {
    const stage = document.querySelectorAll('figure.diagram .diagram-stage')[index];
    const s = stage.getBoundingClientRect();
    for (let fy = 0.15; fy < 0.95; fy += 0.07) {
      for (let fx = 0.08; fx < 0.95; fx += 0.06) {
        const x = s.left + s.width * fx;
        const y = s.top + s.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && stage.contains(hit) && !hit.closest('g.node, g.cluster, .edgeLabel, rect.actor, [data-target-id]')) return { x, y };
      }
    }
    return null;
  }, index);
}

async function nodeCenter(page, id) {
  const box = await page.locator(S.diagramNode(id)).first().boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function ctrlWheel(page, point, deltaY, times) {
  await page.mouse.move(point.x, point.y);
  const modifier = 'Control';
  await page.keyboard.down(modifier);
  for (let i = 0; i < times; i += 1) await page.mouse.wheel(0, deltaY);
  await page.keyboard.up(modifier);
  await page.waitForTimeout(120); // two frames for the rAF-batched zoom
}

/** Synthetic two-finger pinch: touch pointer events through the stage's own handlers. */
async function pinch(page, center, from, to) {
  await page.evaluate(
    async ({ center, from, to }) => {
      const stage = document.querySelector('figure.diagram .diagram-stage');
      const fire = (type, id, x) =>
        stage.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: center.y, bubbles: true, isPrimary: id === 11 }));
      fire('pointerdown', 11, center.x - from / 2);
      fire('pointerdown', 12, center.x + from / 2);
      for (let i = 1; i <= 8; i += 1) {
        const d = from + ((to - from) * i) / 8;
        fire('pointermove', 11, center.x - d / 2);
        fire('pointermove', 12, center.x + d / 2);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      fire('pointerup', 11, center.x - to / 2);
      fire('pointerup', 12, center.x + to / 2);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    },
    { center, from, to },
  );
}

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
/** Pointers report whole-pixel client coordinates; focal checks use the point the page actually receives. */
const px = (point) => ({ x: Math.round(point.x), y: Math.round(point.y) });

export async function runNavigation(engine, only = null) {
  const BASE = baseUrl('http://127.0.0.1:4311');
  const playwright = loadPlaywright();
  const browser = await playwright[engine].launch();
  const c = checks();
  const facts = {};
  const path = (page) => new URL(page.url()).pathname;
  const { page, errors, context } = await openPage(browser, { width: 1280, height: 800 });
  const failedRequests = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('/api/documents/no-such')) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  try {
    // The sequence chart the content and stale-build checks look at, located from the system page's body.
    const SEQ = sequenceIndex((await (await fetch(`${BASE}/api/documents/${SEQUENCE_DOC}`)).json()).body);
    const SEQ_FIGURE = `figure.diagram[data-diagram-index="${SEQ}"]`;
    c.check(`/docs/${SEQUENCE_DOC} has a sequence diagram`, SEQ >= 0, { SEQ });
    const noSequence = (await (await fetch(`${BASE}/api/documents/${NO_SEQUENCE}`)).json()).body;
    c.check(`/docs/${NO_SEQUENCE} has a chart and no sequence diagram (the stale-build start page)`, noSequence.includes('```mermaid') && sequenceIndex(noSequence) === -1);
    if (!only || only === 'content') {
      // ——— 1. One introduction on a pure-contract page ———
      const contract = await (await fetch(`${BASE}/api/documents/${CONTRACT}`)).json();
      const summary = contract.document.summary;
      c.check(`${CONTRACT} is a contract with no Mermaid chart in its body`, contract.document.kind === 'contract' && !contract.body.includes('```mermaid'), { kind: contract.document.kind });
      await page.goto(`${BASE}/docs/${CONTRACT}`);
      await waitForDocument(page, CONTRACT);
      const intro = await page.evaluate((summary) => {
        const article = document.querySelector('article.document');
        const firstBlock = document.querySelector('.prose > *');
        const title = document.querySelector('#doc-title').textContent.trim();
        return {
          view: document.querySelector('.document-layout')?.getAttribute('data-view'),
          viewSwitch: document.querySelectorAll('.view-switch').length,
          charts: article.querySelectorAll('figure.diagram, .diagram-stage, svg[id^="mmd-"]').length,
          headerSummary: document.querySelector('.document-summary')?.innerText.trim() ?? null,
          firstBlockTag: firstBlock?.tagName.toLowerCase(),
          firstBlockText: firstBlock?.innerText.trim() ?? '',
          occurrences: article.innerText.split(summary).length - 1,
          h1s: article.querySelectorAll('h1').length,
          titleHeadingsInProse: [...document.querySelectorAll('.prose h1, .prose h2')].filter((h) => h.textContent.replace('#', '').trim() === title).length,
          proseLinks: document.querySelectorAll('.prose a, .prose [data-evidence]').length,
        };
      }, summary);
      facts.intro = intro;
      c.check(`${CONTRACT}: opens in Details with no view switch and no chart (no lifecycle drawn)`, intro.view === 'details' && intro.viewSwitch === 0 && intro.charts === 0, intro);
      // Said once: in the header, or (when the introduction already says it) only there.
      const saidByIntro = intro.firstBlockText.replace(/\s+/g, ' ').startsWith(summary.replace(/\s+/g, ' ').replace(/\.$/, ''));
      c.check(`${CONTRACT}: one introduction, the summary said once (in the header, or only in the introduction when it opens with it)`, intro.firstBlockTag === 'p' && intro.firstBlockText.length > 0 && intro.occurrences === 1 && (intro.headerSummary === summary || (intro.headerSummary === null && saidByIntro)), { ...intro, saidByIntro });
      c.check(`${CONTRACT}: the title is not repeated in the body; the body after it is kept`, intro.h1s === 1 && intro.titleHeadingsInProse === 0 && intro.proseLinks > 0, intro);
      await page.screenshot({ path: join(SCREENSHOTS, `${engine}-nav-intro-once.png`) });
      // A page that opens on a heading keeps the header summary: found in the API (its first block is a heading that is
      // not its title, so Details opens on that heading, not on an introduction).
      let headingFirst = null;
      for (const entry of (await (await fetch(`${BASE}/api/catalog`)).json()).documents) {
        if (entry.summary.trim().toLowerCase() === entry.title.trim().toLowerCase()) continue;
        const blocks = lexMarkdown((await (await fetch(`${BASE}/api/documents/${entry.id}`)).json()).body).filter((token) => token.type !== 'space');
        if (blocks[0]?.type === 'heading' && blocks[0].text.trim() !== entry.title.trim()) {
          headingFirst = { id: entry.id, summary: entry.summary };
          break;
        }
      }
      c.check('a real page whose body opens on a heading other than its title exists (for the next check)', headingFirst !== null, { headingFirst });
      if (headingFirst) {
        await page.goto(`${BASE}/docs/${headingFirst.id}?view=details`);
        await waitForDocument(page, headingFirst.id);
        const kept = await page.evaluate(() => {
          const first = document.querySelector('.prose > *');
          return { summary: document.querySelector('.document-summary')?.innerText.trim() ?? null, firstBlockTag: first?.tagName.toLowerCase() ?? null, firstBlock: first?.innerText.trim().slice(0, 80) ?? null };
        });
        c.check(`${headingFirst.id} Details: a heading-first page keeps the header summary and opens on its heading`, kept.summary === headingFirst.summary && /^h[1-6]$/.test(kept.firstBlockTag ?? ''), kept);
      }

      // A first paragraph that says something else keeps the header summary. No real page has one, so the contract's
      // API response is served with its introduction replaced (this page only; the route is removed afterwards).
      const OTHER_INTRO = 'This introduction was written for the check and says something else entirely.';
      const opener = lexMarkdown(contract.body).find((token) => token.type === 'paragraph');
      const controlledBody = opener ? contract.body.replace(opener.raw.trimEnd(), OTHER_INTRO) : contract.body;
      const controlledFirst = lexMarkdown(controlledBody).find((token) => token.type === 'paragraph');
      const controlled = {
        firstParagraph: controlledFirst ? plainText(controlledFirst.tokens) : null,
        summaryInBody: controlledBody.includes(summary.replace(/\.$/, '')),
        restKept: Boolean(opener) && controlledBody.replace(OTHER_INTRO, '') === contract.body.replace(opener.raw.trimEnd(), ''),
      };
      c.check(`controlled ${CONTRACT} body: its first paragraph is the other introduction, the summary is nowhere in the body, the rest is kept`, controlled.firstParagraph === OTHER_INTRO && !controlled.summaryInBody && controlled.restKept, controlled);
      const route = `**/api/documents/${CONTRACT}*`;
      await page.route(route, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...contract, body: controlledBody }) }));
      try {
        await page.goto(`${BASE}/docs/${CONTRACT}?view=details`);
        await waitForDocument(page, CONTRACT);
        const other = await page.evaluate((summary) => {
          const article = document.querySelector('article.document');
          const first = document.querySelector('.prose > *');
          return {
            summary: document.querySelector('.document-summary')?.innerText.trim() ?? null,
            firstBlockTag: first?.tagName.toLowerCase() ?? null,
            firstBlockText: first?.innerText.trim() ?? null,
            occurrences: article.innerText.split(summary).length - 1,
            proseLinks: document.querySelectorAll('.prose a, .prose [data-evidence]').length,
          };
        }, summary);
        facts.otherIntro = other;
        c.check(`controlled ${CONTRACT} Details: a first paragraph that says something else keeps the header summary (said once) and the paragraph, as drawn`, other.summary === summary && other.firstBlockTag === 'p' && other.firstBlockText === OTHER_INTRO && other.occurrences === 1 && other.proseLinks > 0, other);
        await page.screenshot({ path: join(SCREENSHOTS, `${engine}-nav-other-intro.png`) });
      } finally {
        await page.unroute(route);
      }
      const served = await (await fetch(`${BASE}/api/documents/${CONTRACT}`)).json();
      c.check(`${CONTRACT}: the real response is unchanged (the controlled body was only ever routed in this page)`, served.body === contract.body && !served.body.includes(OTHER_INTRO));
      const summaryWords = summary.split(/\s+/).slice(0, 4).join(' ');
      const search = await (await fetch(`${BASE}/api/search?q=${encodeURIComponent(summaryWords)}`)).json();
      c.check(`search metadata unchanged: the summary still finds ${CONTRACT}`, search.results.some((r) => r.id === CONTRACT), { query: summaryWords });

      // A guide without charts opens readable Details content, even when Diagrams is asked for.
      const guide = await (await fetch(`${BASE}/api/documents/${GUIDE}`)).json();
      c.check(`${GUIDE} is a guide with no Mermaid chart in its body`, guide.document.kind === 'guide' && !guide.body.includes('```mermaid'), { kind: guide.document.kind });
      for (const query of ['', '?view=diagrams']) {
        await page.goto(`${BASE}/docs/${GUIDE}${query}`);
        await waitForDocument(page, GUIDE);
        const read = await page.evaluate(() => {
          const prose = document.querySelector('article.document .prose');
          return {
            view: document.querySelector('.document-layout')?.getAttribute('data-view'),
            charts: document.querySelectorAll('article.document figure.diagram').length,
            pending: document.querySelectorAll('.diagram-pending').length,
            paragraphs: prose?.querySelectorAll('p').length ?? 0,
            headings: prose?.querySelectorAll('h2, h3').length ?? 0,
            textLength: prose?.innerText.trim().length ?? 0,
          };
        });
        facts[`guide${query || 'Default'}`] = read;
        c.check(`/docs/${GUIDE}${query}: opens Details with readable sections (paragraphs and headings), no chart and nothing waiting to render`, read.view === 'details' && read.charts === 0 && read.pending === 0 && read.paragraphs > 0 && read.headings > 0 && read.textLength > 200, read);
      }

      // ——— 4. No boilerplate, no Opens ———
      const sample = ['nessa', 'host', 'mcp', CONTRACT, GUIDE, CHART];
      const leftovers = [];
      for (const id of sample) {
        for (const view of ['diagrams', 'details']) {
          await page.goto(`${BASE}/docs/${id}?view=${view}`);
          await waitForDocument(page, id);
          const found = await page.evaluate((text) => ({
            boilerplate: document.querySelector('article.document').innerText.includes(text),
            readAll: document.querySelectorAll('[data-action="read-all"]').length,
            opens: document.querySelectorAll('.diagram-drilldown').length,
            readSwitch: document.querySelectorAll('[data-view="read"]').length,
            sourceControls: document.querySelectorAll('button[data-action="source"], [data-action="diagram-source"], .markdown-source').length,
          }), BOILERPLATE);
          if (found.boilerplate || found.readAll || found.opens || found.readSwitch || found.sourceControls) leftovers.push({ id, view, ...found });
        }
      }
      c.check('no "The description, evidence and every section are in Read." paragraph, no Opens list, no Read switch or source controls (6 documents × 2 views)', leftovers.length === 0, { leftovers });
      await page.goto(`${BASE}/docs/host`);
      await waitForDocument(page, 'host');
      const tail = await page.evaluate(() => {
        const article = document.querySelector('article.document');
        return { last: article.lastElementChild?.className, footerClosed: !article.querySelector('details.provenance').open };
      });
      c.check('Diagrams view ends with the closed Sources and provenance footer', tail.last === 'provenance' && tail.footerClosed, tail);

      // ——— 3. Sequence diagram on the system page ———
      await page.goto(`${BASE}/docs/${SEQUENCE_DOC}`);
      await waitForDocument(page, SEQUENCE_DOC);
      await waitForDiagrams(page);
      const sequence = await page.evaluate(() =>
        [...document.querySelectorAll('figure.diagram')].map((f) => ({
          index: f.dataset.diagramIndex,
          state: f.dataset.state,
          actors: f.querySelectorAll('svg rect.actor, svg g.actor-man').length,
          messages: f.querySelectorAll('svg .messageText').length,
        })),
      );
      facts.sequence = { index: SEQ, figures: sequence };
      const seqFigure = sequence.find((d) => d.index === String(SEQ));
      c.check(`/docs/${SEQUENCE_DOC}: every diagram renders, including the sequence diagram (actors and messages drawn)`, SEQ >= 0 && sequence.length > 0 && sequence.every((d) => d.state === 'rendered') && seqFigure?.actors > 0 && seqFigure?.messages > 0, facts.sequence);
      const firstParticipant = await page.evaluate((index) => {
        const stage = document.querySelector(`figure.diagram[data-diagram-index="${index}"] .diagram-stage`);
        if (!stage) return { visible: false, stage: false };
        const s = stage.getBoundingClientRect();
        const actors = [...stage.querySelectorAll('svg rect.actor')].map((r) => r.getBoundingClientRect()).sort((a, b) => a.left - b.left);
        const first = actors[0];
        return { visible: Boolean(first) && first.left >= s.left - 1 && first.right <= s.right + 1, scrollLeft: stage.scrollLeft };
      }, SEQ);
      c.check(`/docs/${SEQUENCE_DOC}: the sequence diagram opens on its first participant (fully in view)`, firstParticipant.visible, firstParticipant);
      await page.screenshot({ path: join(SCREENSHOTS, `${engine}-nav-system-sequence.png`) });
    }

    if (!only || only === 'stale') {
      // ——— 3b. A page from an older build: one reload, then the truth; a current build shows the real error ———
      const stale = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const sp = await stale.newPage();
      let loads = 0;
      sp.on('load', () => (loads += 1));
      // Start where no sequence diagram is drawn, so its renderer chunk is first asked for after the build changed.
      await sp.goto(`${BASE}/docs/${NO_SEQUENCE}`);
      await waitForDocument(sp, NO_SEQUENCE);
      await waitForDiagrams(sp);
      // The 404 is the server's own reply for a missing asset (status, headers and body), served in place of the chunk.
      const missingAsset = await fetch(`${BASE}/assets/sequenceDiagram-0000-gone.js`, { headers: { Host: new URL(BASE).host } });
      const missingHeaders = Object.fromEntries(missingAsset.headers.entries());
      const missingBody = await missingAsset.text();
      facts.missingAssetReply = { status: missingAsset.status, cacheControl: missingHeaders['cache-control'] ?? null };
      c.check('server: a missing asset is 404 and never cached', missingAsset.status === 404 && missingHeaders['cache-control'] === 'no-store', facts.missingAssetReply);
      await sp.route('**/assets/sequenceDiagram-*.js', (route) => route.fulfill({ status: 404, headers: missingHeaders, body: missingBody }));
      await sp.route('**/api/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, client: '/assets/index-NEWERBUILD.js' }) }));
      await sp.evaluate((path) => {
        window.history.pushState({ index: 1 }, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, `/docs/${SEQUENCE_DOC}`);
      // Until the one reload has happened and the reloaded page says why (the system page draws other charts
      // first); then a further moment, in which a looping reload would show as a third load.
      for (const until = Date.now() + 20000; loads < 2 && Date.now() < until; ) await sp.waitForTimeout(100);
      await sp.waitForLoadState('load');
      await waitForDocument(sp, SEQUENCE_DOC);
      await sp.waitForFunction(() => document.querySelectorAll('figure.diagram [data-outdated]').length > 0, null, { timeout: 15000 }).catch(() => undefined);
      await sp.waitForTimeout(2000);
      const afterOutdated = await sp.evaluate(() => ({
        path: location.pathname,
        reloadedFor: sessionStorage.getItem('nessa-state-browser:reloaded-for'),
        outdated: document.querySelectorAll('figure.diagram [data-outdated]').length,
        reloadButton: document.querySelectorAll('[data-action="reload-page"]').length,
        sourceShown: document.querySelectorAll('figure.diagram .diagram-source').length,
      }));
      facts.staleOutdated = { loads, ...afterOutdated };
      c.check('older build: exactly one automatic reload, then an explained "rebuilt" state with Reload and the source — no loop', loads === 2 && afterOutdated.reloadedFor === '/assets/index-NEWERBUILD.js' && afterOutdated.outdated >= 1 && afterOutdated.reloadButton >= 1 && afterOutdated.sourceShown >= 1, facts.staleOutdated);
      await sp.unroute('**/api/health');
      await sp.reload();
      await waitForDocument(sp, SEQUENCE_DOC);
      await waitForDiagrams(sp);
      const current = await sp.evaluate(() => ({
        failed: document.querySelectorAll('figure.diagram[data-state="failed"]').length,
        outdated: document.querySelectorAll('figure.diagram [data-outdated]').length,
        error: document.querySelector('figure.diagram[data-state="failed"] .diagram-error p')?.textContent.slice(0, 120) ?? null,
      }));
      facts.staleCurrent = { loads, ...current };
      c.check('current build, chunk missing: an honest render error with the source, no reload', loads === 3 && current.failed >= 1 && current.outdated === 0 && Boolean(current.error), facts.staleCurrent);
      await stale.close();

      // B3 (review P3-1): renderer chunk 404 and /api/health never answers → failed with source within the bound.
      const hung = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const hp = await hung.newPage();
      // Timed from the renderer chunk's 404, the failure the bound applies to (charts before it render first).
      let hungStart = null;
      await hp.route('**/assets/sequenceDiagram-*.js', (route) => {
        hungStart ??= Date.now();
        return route.fulfill({ status: 404, headers: missingHeaders, body: missingBody });
      });
      await hp.route('**/api/health', () => {}); // held open: never answered
      await hp.goto(`${BASE}/docs/${SEQUENCE_DOC}`);
      await waitForDocument(hp, SEQUENCE_DOC);
      await hp.waitForFunction((selector) => document.querySelector(selector)?.dataset.state !== 'rendering', SEQ_FIGURE, { timeout: 8000 }).catch(() => undefined);
      const hungFacts = await hp.evaluate((selector) => {
        const f = document.querySelector(selector);
        return { state: f.dataset.state, source: Boolean(f.querySelector('.diagram-source')), error: Boolean(f.querySelector('.diagram-error')), reloadButton: Boolean(f.querySelector('[data-action="reload-page"]')) };
      }, SEQ_FIGURE);
      facts.healthHung = { ...hungFacts, settledMs: hungStart === null ? null : Date.now() - hungStart };
      c.check('health never answers: failed with error and source within the 3 s bound of the chunk failing (B3)', hungFacts.state === 'failed' && hungFacts.source && hungFacts.error && !hungFacts.reloadButton && facts.healthHung.settledMs !== null && facts.healthHung.settledMs < 4500, facts.healthHung);
      await hung.close();

      // B4 (review P3-2): only the reload-guard key is denied → outdated with Reload and source, no automatic reload, nothing thrown.
      const denied = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await denied.addInitScript(() => {
        const get = Storage.prototype.getItem;
        const set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
          if (key === 'nessa-state-browser:reloaded-for') throw new DOMException('denied', 'SecurityError');
          return get.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
          if (key === 'nessa-state-browser:reloaded-for') throw new DOMException('denied', 'SecurityError');
          return set.call(this, key, value);
        };
      });
      const dp = await denied.newPage();
      const deniedErrors = [];
      dp.on('pageerror', (error) => deniedErrors.push(String(error)));
      let deniedLoads = 0;
      dp.on('load', () => (deniedLoads += 1));
      await dp.route('**/assets/sequenceDiagram-*.js', (route) => route.fulfill({ status: 404, headers: missingHeaders, body: missingBody }));
      await dp.route('**/api/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, client: '/assets/index-NEWERBUILD.js' }) }));
      await dp.goto(`${BASE}/docs/${SEQUENCE_DOC}`);
      await waitForDocument(dp, SEQUENCE_DOC);
      await dp.waitForFunction((selector) => document.querySelector(selector)?.dataset.state !== 'rendering', SEQ_FIGURE, { timeout: 8000 }).catch(() => undefined);
      await dp.waitForTimeout(1500);
      const deniedFacts = await dp.evaluate((selector) => {
        const f = document.querySelector(selector);
        return { state: f.dataset.state, source: Boolean(f.querySelector('.diagram-source')), reloadButton: Boolean(f.querySelector('[data-action="reload-page"]')) };
      }, SEQ_FIGURE);
      facts.storageDenied = { ...deniedFacts, loads: deniedLoads, pageErrors: deniedErrors };
      c.check('reload guard denied: outdated with Reload and source, no automatic reload, no unhandled error (B4)', deniedFacts.state === 'outdated' && deniedFacts.source && deniedFacts.reloadButton && deniedLoads === 1 && deniedErrors.length === 0, facts.storageDenied);
      await denied.close();

      // Chunk back: a new tab renders (WebKit keeps a failed module URL for the life of a tab, even across reload — see limitations).
      const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const fp = await fresh.newPage();
      await fp.goto(`${BASE}/docs/${SEQUENCE_DOC}`);
      await waitForDocument(fp, SEQUENCE_DOC);
      await waitForDiagrams(fp);
      const recovered = await fp.evaluate(() => [...document.querySelectorAll('figure.diagram')].every((f) => f.dataset.state === 'rendered'));
      c.check('chunk back: a new tab renders every diagram', recovered);
      await fresh.close();
    }

    if (!only || only === 'gestures') {
      // ——— 2. Gestures on the large statechart ———
      await page.goto(`${BASE}/docs/${CHART}`);
      await waitForDocument(page, CHART);
      await waitForDiagrams(page);
      const first = await stageState(page);
      c.check('canvas: pannable, with the gesture hint as its title', first.pannable && /Drag to pan/.test(first.title ?? '') && first.maxLeft > 200 && first.maxTop > 200, first);
      const bg = await backgroundPoint(page);
      await page.locator('#main').evaluate((main) => main.scrollTo(0, 0));
      // Room to pan both ways from the opening position.
      await page.evaluate(() => {
        const stage = document.querySelector('figure.diagram .diagram-stage');
        stage.scrollLeft = Math.min(stage.scrollWidth - stage.clientWidth, 400);
        stage.scrollTop = Math.min(stage.scrollHeight - stage.clientHeight, 300);
      });
      const before = await stageState(page);
      await startProbe(page);
      await drag(page, bg, { x: -150, y: -120 }, 30, true);
      const perf = await stopProbe(page);
      const after = await stageState(page);
      facts.drag = { from: bg, before: { left: before.left, top: before.top }, after: { left: after.left, top: after.top }, perf };
      c.check('drag on the background pans by the pointer distance (±2px)', near(after.left - before.left, Math.min(150, before.maxLeft - before.left), 2) && near(after.top - before.top, Math.min(120, before.maxTop - before.top), 2), facts.drag);
      c.check('drag: no navigation, SVG never re-inserted, frames sampled', path(page) === `/docs/${CHART}` && perf.svgReinserted === 0 && perf.sameSvgElement && perf.frames > 5, perf);
      // Row 18 (review P2-1): press 3 px inside the frame, first move 60 px outside, release there, hover back with no button.
      const edge = await stageState(page);
      const ex = Math.round(edge.stage.x + 3);
      const ey = Math.round(edge.stage.y + edge.stage.height / 2);
      await page.mouse.move(ex, ey);
      await page.mouse.down();
      await page.mouse.move(ex - 63, ey, { steps: 1 });
      await page.mouse.up();
      const released = await stageState(page);
      await page.mouse.move(edge.stage.x + edge.stage.width / 2, edge.stage.y + edge.stage.height / 2, { steps: 5 });
      await page.mouse.move(edge.stage.x + edge.stage.width / 2 + 150, edge.stage.y + edge.stage.height / 2 + 100, { steps: 5 });
      const hovered = await stageState(page);
      const grabbing = await page.evaluate(() => document.querySelector('figure.diagram .diagram-stage').hasAttribute('data-panning'));
      facts.leaveAndHover = { before: [edge.left, edge.top], released: [released.left, released.top], hovered: [hovered.left, hovered.top], grabbing };
      c.check('press at the edge, leave before 4 px, release outside, hover back: no scroll, no grabbing (row 18)', hovered.left === edge.left && hovered.top === edge.top && !grabbing, facts.leaveAndHover);

      // Drag from a linked node must not open it; a click must.
      await page.goto(`${BASE}/docs/nessa`);
      await waitForDocument(page, 'nessa');
      await waitForDiagrams(page);
      const node = await nodeCenter(page, 'host');
      const rootBefore = await stageState(page);
      await drag(page, node, { x: 0, y: -60 }, 10);
      await page.waitForTimeout(300);
      const rootAfter = await stageState(page);
      c.check('drag that starts on a linked node pans and does not navigate', path(page) === '/docs/nessa' && (await page.locator('dialog.reference-peek[open]').count()) === 0 && (rootAfter.top !== rootBefore.top || rootBefore.maxTop === 0), { before: rootBefore.top, after: rootAfter.top });
      // Leave the node and come back to it before releasing: still a pan, never a click on the node.
      const home = await nodeCenter(page, 'host');
      await page.mouse.move(home.x, home.y);
      await page.mouse.down();
      await page.mouse.move(home.x + 30, home.y + 30, { steps: 5 });
      const midDrag = await page.evaluate(() => document.querySelector('figure.diagram .diagram-stage').hasAttribute('data-panning'));
      const back = await nodeCenter(page, 'host');
      await page.mouse.move(back.x, back.y, { steps: 5 });
      const releasedOn = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-target-id]')?.getAttribute('data-target-id') ?? null, back);
      await page.mouse.up();
      await page.waitForTimeout(300);
      c.check('drag away from a linked node and back onto it: a pan, not a click (no navigation)', midDrag && releasedOn === 'host' && path(page) === '/docs/nessa' && (await page.locator('dialog.reference-peek[open]').count()) === 0, { midDrag, releasedOn, path: path(page) });
      const node2 = await nodeCenter(page, 'host');
      await page.mouse.move(node2.x, node2.y);
      await page.mouse.down();
      await page.mouse.move(node2.x + 2, node2.y + 1);
      await page.mouse.up();
      await page.locator('dialog.reference-peek[open] .inspector-open a').waitFor();
      c.check('a press that moves < 4px is a click: the linked node opens its overview', path(page) === '/docs/nessa');
      await page.locator('dialog.reference-peek[open] .inspector-open a').click();
      await waitForDocument(page, 'host');
      await page.goBack();
      await waitForDocument(page, 'nessa');
      await waitForDiagrams(page);
      await page.locator(S.diagramNode('mcp')).first().focus();
      await page.keyboard.press('Enter');
      await page.locator('dialog.reference-peek[open] .inspector-open a').waitFor();
      c.check('keyboard Enter on a focused linked node opens its overview in place', path(page) !== '/docs/mcp');
      await page.locator('dialog.reference-peek[open] .inspector-open a').click();
      await waitForDocument(page, 'mcp');
      c.check('Open page in that overview navigates', path(page) === '/docs/mcp');
      await page.goBack();
      await waitForDocument(page, 'nessa');
      await waitForDiagrams(page);
      const provider = page.locator('figure.diagram .diagram-svg g.node', { hasText: 'External provider runtime' }).first();
      await provider.click({ force: true });
      await page.waitForTimeout(300);
      c.check('an unlinked node is still inert to a click', path(page) === '/docs/nessa');

      // Focal zoom (ctrl/⌘ + wheel; macOS pinch arrives this way).
      await page.goto(`${BASE}/docs/${CHART}`);
      await waitForDocument(page, CHART);
      await waitForDiagrams(page);
      const s0 = await stageState(page);
      const focal = px({ x: s0.stage.x + s0.stage.width * 0.3, y: s0.stage.y + s0.stage.height * 0.6 });
      const z0 = await stageState(page, 0, focal);
      await startProbe(page);
      await ctrlWheel(page, focal, -60, 6);
      const zoomPerf = await stopProbe(page);
      const z1 = await stageState(page, 0, focal);
      const driftPx = Math.hypot((z1.natural.x - z0.natural.x) * z1.actual, (z1.natural.y - z0.natural.y) * z1.actual);
      facts.focalZoom = { before: z0.actual, after: z1.actual, driftPx: Math.round(driftPx * 10) / 10, perf: zoomPerf };
      c.check('ctrl/⌘ + wheel zooms in around the cursor (the point under it moves ≤ 2px)', z1.actual > z0.actual * 1.1 && driftPx <= 2 && path(page) === `/docs/${CHART}`, facts.focalZoom);
      c.check('zoom: SVG not re-inserted', zoomPerf.svgReinserted === 0 && zoomPerf.sameSvgElement, zoomPerf);
      await ctrlWheel(page, focal, 60, 4);
      const z2 = await stageState(page, 0, focal);
      const driftOut = Math.hypot((z2.natural.x - z0.natural.x) * z2.actual, (z2.natural.y - z0.natural.y) * z2.actual);
      c.check('zooming out keeps the focal point too (≤ 2px)', z2.actual < z1.actual && driftOut <= 2, { scale: z2.actual, driftPx: driftOut });
      await ctrlWheel(page, focal, -400, 40);
      const zmax = await stageState(page, 0, focal);
      await ctrlWheel(page, focal, 400, 60);
      const zmin = await stageState(page, 0, focal);
      facts.bounds = { max: zmax.scale, min: zmin.scale };
      c.check('zoom is bounded to 25%–400%', zmax.scale === 4 && zmin.scale === 0.25, facts.bounds);
      // Plain wheel scrolls, never zooms.
      await page.locator(S.fitButton).first().click();
      await page.getByRole('button', { name: 'Zoom in' }).first().click();
      await page.getByRole('button', { name: 'Zoom in' }).first().click();
      const w0 = await stageState(page);
      const mainTop0 = await page.locator('#main').evaluate((m) => m.scrollTop);
      await page.mouse.move(w0.stage.x + w0.stage.width / 2, w0.stage.y + 40);
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(300);
      const w1 = await stageState(page);
      const mainTop1 = await page.locator('#main').evaluate((m) => m.scrollTop);
      c.check('plain wheel scrolls (stage or page) and does not zoom', w1.scale === w0.scale && (w1.top > w0.top || mainTop1 > mainTop0), { scale: [w0.scale, w1.scale], stageTop: [w0.top, w1.top], pageTop: [mainTop0, mainTop1] });
      // Buttons zoom around the centre.
      await page.locator('#main').evaluate((m) => m.scrollTo(0, 0));
      const b0 = await stageState(page);
      await page.getByRole('button', { name: 'Zoom in' }).first().click();
      await page.waitForTimeout(100);
      const b1 = await stageState(page);
      const centreDrift = Math.hypot((b1.natural.x - b0.natural.x) * b1.actual, (b1.natural.y - b0.natural.y) * b1.actual);
      c.check('+ zooms ×1.25 around the stage centre (≤ 2px)', near(b1.actual / b0.actual, 1.25, 0.02) && centreDrift <= 2, { ratio: b1.actual / b0.actual, centreDrift });
      await page.locator(S.fitButton).first().click();
      const fitted = await page.evaluate(() => document.querySelector('figure.diagram .diagram-stage').hasAttribute('data-fits'));
      c.check('Fit still shows the whole diagram after gestures', fitted);
      // Touch pinch (synthetic touch pointers through the stage's handlers), from the overflowing first view
      // (the focal point can only hold where there is room to scroll; a diagram smaller than its frame stays centred).
      await page.goto(`${BASE}/docs/${CHART}`);
      await waitForDocument(page, CHART);
      await waitForDiagrams(page);
      const p0 = await stageState(page);
      const pc = px({ x: p0.stage.x + p0.stage.width * 0.5, y: p0.stage.y + p0.stage.height * 0.5 });
      const pin0 = await stageState(page, 0, pc);
      await pinch(page, pc, 120, 240);
      const pin1 = await stageState(page, 0, pc);
      const pinchDrift = Math.hypot((pin1.natural.x - pin0.natural.x) * pin1.actual, (pin1.natural.y - pin0.natural.y) * pin1.actual);
      facts.pinch = { before: pin0.actual, after: pin1.actual, driftPx: Math.round(pinchDrift * 10) / 10 };
      c.check('two-finger pinch zooms about its midpoint (×≈2, ≤ 3px drift)', near(pin1.actual / pin0.actual, 2, 0.15) && pinchDrift <= 3, facts.pinch);
      // Expanded view: drag still pans; Escape returns focus.
      await page.locator(S.expandButton).first().click();
      const e0 = await stageState(page);
      const ebg = await backgroundPoint(page);
      await page.evaluate(() => {
        const stage = document.querySelector('figure.diagram .diagram-stage');
        stage.scrollLeft = Math.min(stage.scrollWidth - stage.clientWidth, 300);
        stage.scrollTop = Math.min(stage.scrollHeight - stage.clientHeight, 200);
      });
      const e1 = await stageState(page);
      if (ebg) await drag(page, ebg, { x: -80, y: -60 }, 12);
      const e2 = await stageState(page);
      c.check('expanded: drag pans', ebg !== null && (e2.left !== e1.left || e2.top !== e1.top || (e1.maxLeft === 0 && e1.maxTop === 0)), { e0: [e0.left, e0.top], e1: [e1.left, e1.top], e2: [e2.left, e2.top] });
      await page.keyboard.press('Escape');
      c.check('expanded: Escape closes and returns focus to Expand', (await page.locator('figure.diagram[data-expanded]').count()) === 0 && (await activeElement(page))?.action === 'expand');
      // Details view inline diagram: ctrl-wheel works there too.
      await page.goto(`${BASE}/docs/${CHART}?view=details`);
      await waitForDocument(page, CHART);
      await waitForDiagrams(page);
      await page.locator('figure.diagram').first().scrollIntoViewIfNeeded();
      const r0 = await stageState(page);
      const rf = px({ x: r0.stage.x + r0.stage.width / 2, y: r0.stage.y + Math.min(200, r0.stage.height / 2) });
      const rz0 = await stageState(page, 0, rf);
      await ctrlWheel(page, rf, -60, 4);
      const rz1 = await stageState(page, 0, rf);
      const readDrift = Math.hypot((rz1.natural.x - rz0.natural.x) * rz1.actual, (rz1.natural.y - rz0.natural.y) * rz1.actual);
      c.check('Details view: inline diagram zooms around the cursor too (the page takes the vertical part, ≤ 2.5px)', rz1.actual > rz0.actual && readDrift <= 2.5, { before: rz0.actual, after: rz1.actual, driftPx: readDrift });

      // Light appearance: rendered, linked styling present, drag pans.
      const light = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await light.addInitScript(() => localStorage.setItem('nessa-state-browser:appearance', 'light'));
      const lp = await light.newPage();
      await lp.goto(`${BASE}/docs/nessa`);
      await waitForDocument(lp, 'nessa');
      await waitForDiagrams(lp);
      const lightFacts = await lp.evaluate(() => {
        const svg = document.querySelector('figure.diagram .diagram-svg svg');
        const nodes = [...svg.querySelectorAll('g.node, g.cluster')];
        const marksOf = (n) => n.querySelectorAll(':scope > .diagram-depth-mark, :scope > .diagram-depth-inset').length;
        const linked = nodes.filter((n) => n.hasAttribute('data-target-id') || n.hasAttribute('data-detail-key'));
        return {
          dark: document.documentElement.classList.contains('dark'),
          rendered: document.querySelector('figure.diagram').dataset.state,
          linked: linked.length,
          linkedMarked: linked.filter((n) => marksOf(n) === 1).length,
          inertMarked: nodes.filter((n) => !linked.includes(n) && marksOf(n) > 0).length,
        };
      });
      const lbg = await backgroundPoint(lp);
      const l0 = await stageState(lp);
      if (lbg) await drag(lp, lbg, { x: 0, y: -100 }, 10);
      const l1 = await stageState(lp);
      c.check('light: diagram rendered, one + on each linked node and none on inert nodes; drag pans', !lightFacts.dark && lightFacts.rendered === 'rendered' && lightFacts.linked > 0 && lightFacts.linkedMarked === lightFacts.linked && lightFacts.inertMarked === 0 && (l1.top > l0.top || l0.maxTop === 0) && new URL(lp.url()).pathname === '/docs/nessa', { ...lightFacts, top: [l0.top, l1.top] });
      await lp.screenshot({ path: join(SCREENSHOTS, `${engine}-nav-light-root.png`) });
      await light.close();

      // Phone: touch-action for native one-finger scroll, pinch zoom, no overflow.
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: engine === 'chromium' });
      const pp = await phone.newPage();
      await pp.goto(`${BASE}/docs/${CHART}`);
      await waitForDocument(pp, CHART);
      await waitForDiagrams(pp);
      const touchAction = await pp.evaluate(() => getComputedStyle(document.querySelector('figure.diagram .diagram-stage')).touchAction);
      const ph0 = await stageState(pp);
      const phc = px({ x: ph0.stage.x + ph0.stage.width / 2, y: ph0.stage.y + Math.min(200, ph0.stage.height / 2) });
      const phz0 = await stageState(pp, 0, phc);
      await pinch(pp, phc, 80, 160);
      const phz1 = await stageState(pp, 0, phc);
      const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      facts.phone = { touchAction, before: phz0.actual, after: phz1.actual, overflow };
      c.check('phone: one-finger scroll stays native (pan-x pan-y), pinch zooms, no horizontal overflow', /pan-x/.test(touchAction) && /pan-y/.test(touchAction) && phz1.actual > phz0.actual * 1.5 && overflow === 0, facts.phone);
      await pp.screenshot({ path: join(SCREENSHOTS, `${engine}-nav-phone-chart.png`) });
      await phone.close();
    }

    const unexpected = errors.console.filter((e) => !/status of 404/.test(e.text));
    c.check('no page errors; no console errors besides expected 404s', errors.page.length === 0 && unexpected.length === 0, { page: errors.page, console: unexpected });
    c.check('no failed asset requests on the main page', failedRequests.filter((r) => /\/assets\//.test(r)).length === 0, { failedRequests });
  } catch (error) {
    c.check('navigation run completed without exception', false, { error: String(error), url: page.url() });
  } finally {
    await context.close();
    await browser.close();
  }
  const result = { engine, script: 'navigation', baseUrl: BASE, ok: c.ok, passed: c.list.filter((x) => x.pass).length, total: c.list.length, checks: c.list, facts };
  writeResult(`navigation-${engine}${only ? `-${only}` : ''}`, result);
  log(engine, JSON.stringify({ script: result.script, ok: result.ok, passed: result.passed, total: result.total }));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? null;
  const result = await runNavigation(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'chromium', only);
  console.log(JSON.stringify({ engine: result.engine, ok: result.ok, passed: result.passed, total: result.total }));
  process.exit(result.ok ? 0 : 1);
}
