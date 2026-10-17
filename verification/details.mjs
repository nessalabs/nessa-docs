// Diagram details: the Details view (no Read alias, no source controls, the
// failed-chart source kept as a diagnostic), + depth marks only where there is
// depth, the node and transition inspector (inset pane on wide windows, dialog
// on narrow ones and over an expanded chart), click vs drag, keyboard and focus
// return, section boundaries and safe content, the Diagram detail preference
// (persisted, blocked or invalid storage, applied live without re-rendering the
// chart), unbound entries in Settings › Health, the real documents' guards, and
// the same controls on a flowchart component map's labelled edges and nodes.
// Rows D1–D22 in CHECKLIST.md ("Diagram details").
//
// Usage: node verification/details.mjs [chromium|webkit]
//   BASE_URL (default http://127.0.0.1:4313): server on fixtures/details-repo
//   REAL_URL (optional, e.g. http://127.0.0.1:4311): adds the real-repository rows (D16, D21)

import { join } from 'node:path';
import { activeElement, baseUrl, checks, geometry, loadPlaywright, log, nodeLinkFacts, openPage, SCREENSHOTS, waitForDiagrams, waitForDocument, writeResult } from './lib.mjs';
import { S } from './selectors.mjs';

const DETAIL_KEY = 'nessa-state-browser:diagram-detail';
const APP_CALL = 'extensions-ui-call-an-app-tool-approve-it-or-fetch-its-resource-through-the-gateway';
const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1440, height: 900 },
];

async function api(base, path) {
  return (await fetch(`${base}${path}`)).json();
}

/** The published detail keys of a document, by what they select. */
function keysOf(details) {
  const key = {};
  details.forEach((d, k) => {
    key[d.target.kind === 'node' ? `node:${d.target.node}` : `edge:${d.target.from}>${d.target.to}:${d.target.label}`] = k;
  });
  return key;
}

function inspectorFacts(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('dialog.detail-inspector');
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    };
    const body = dialog?.querySelector('.inspector-body');
    const active = document.activeElement;
    return {
      open: Boolean(dialog?.open),
      modal: Boolean(dialog?.open && dialog.matches(':modal')),
      key: dialog?.querySelector('.inspector-frame')?.getAttribute('data-detail-key') ?? null,
      title: dialog?.querySelector('.inspector-title')?.textContent.trim() ?? null,
      kind: dialog?.querySelector('.inspector-kind')?.textContent.trim() ?? null,
      // The relation and authored label are now separate rows; the type Badge
      // is checked through `kind`, not included in the authored edge text.
      element: [dialog?.querySelector('.inspector-relation') ?? dialog?.querySelector('[data-testid="inspector-element"] > code'),
        dialog?.querySelector('.inspector-label')].filter(Boolean).map(e => e.textContent).join(' ').replace(/\s+/g, ' ').trim() || null,
      text: body?.innerText ?? '',
      shown: body?.getAttribute('data-shown') ?? null,
      showFull: Boolean(dialog?.querySelector('button[data-action="show-full"]')),
      linked: dialog?.querySelector('a[data-action="open-linked-document"]')?.textContent.trim() ?? null,
      sectionHref: dialog?.querySelector('a[data-action="inspector-section"]')?.getAttribute('href') ?? null,
      rect: dialog?.open ? rect(dialog) : null,
      activeInside: Boolean(dialog && active && dialog.contains(active)),
      activeIsTitle: active?.classList.contains('inspector-title') ?? false,
      layout: document.querySelector('.document-layout')?.getAttribute('data-inspector') ?? null,
    };
  });
}

/** The chart around an explained element: scale, stage scroll and size, and a probe that a re-render would drop. */
function chartState(page) {
  return page.evaluate(() => {
    const figure = document.querySelector('figure.diagram[data-state="rendered"]');
    const stage = figure?.querySelector('.diagram-stage');
    const svg = figure?.querySelector('.diagram-svg svg');
    return {
      scale: figure?.querySelector('[data-testid="diagram-scale"]')?.textContent ?? null,
      left: Math.round(stage?.scrollLeft ?? -1),
      top: Math.round(stage?.scrollTop ?? -1),
      stageWidth: Math.round(stage?.clientWidth ?? 0),
      stageHeight: Math.round(stage?.clientHeight ?? 0),
      probe: svg?.getAttribute('data-probe') ?? null,
      level: document.querySelector('.document-layout')?.getAttribute('data-diagram-detail') ?? null,
      pannable: stage ? stage.hasAttribute('data-pannable') : false,
    };
  });
}

/** + marks on transition labels, and whether any sits on its words; label/notes visibility. */
function edgeFacts(page) {
  return page.evaluate(() => {
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const words = (label) => {
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const box = range.getBoundingClientRect();
        if (box.width === 0) continue;
        l = Math.min(l, box.left); t = Math.min(t, box.top); r = Math.max(r, box.right); b = Math.max(b, box.bottom);
      }
      return { left: l, top: t, right: r, bottom: b };
    };
    const svg = document.querySelector('figure.diagram .diagram-svg svg');
    const labels = [...svg.querySelectorAll('g.edgeLabel')].filter((g) => g.textContent.trim());
    const explained = labels.filter((g) => g.hasAttribute('data-detail-key'));
    const opacity = (el) => (el ? Number(getComputedStyle(el).opacity) : null);
    return {
      labels: labels.length,
      explained: explained.length,
      marked: explained.filter((g) => g.querySelector(':scope > .diagram-depth-mark')).length,
      unexplainedMarked: labels.filter((g) => !g.hasAttribute('data-detail-key') && g.querySelector('.diagram-depth-mark')).length,
      markOnWords: explained.filter((g) => {
        const mark = g.querySelector(':scope > .diagram-depth-mark');
        return mark && overlap(mark.getBoundingClientRect(), words(g.querySelector(':scope > .label')));
      }).length,
      markIsPlus: explained.every((g) => g.querySelector(':scope > .diagram-depth-mark path')?.getAttribute('d') === 'M4.5 1 V8 M1 4.5 H8'),
      names: explained.map((g) => g.getAttribute('aria-label')),
      labelOpacity: labels.map((g) => opacity(g.querySelector(':scope > .label'))),
      markOpacity: explained.map((g) => opacity(g.querySelector(':scope > .diagram-depth-mark'))),
      noteOpacity: [...svg.querySelectorAll('.statediagram-note')].map(opacity),
      noteText: [...svg.querySelectorAll('.statediagram-note')].map((n) => n.textContent.trim()),
    };
  });
}

/** A point on a transition's line, inside the stage and away from every label, in page coordinates. */
function pointOnLine(page, key) {
  return page.evaluate((key) => {
    const svg = document.querySelector('figure.diagram .diagram-svg svg');
    const path = svg.querySelector(`path.diagram-edge-hit[data-detail-key="${key}"]`);
    const stage = svg.closest('.diagram-stage').getBoundingClientRect();
    const labels = [...svg.querySelectorAll('g.edgeLabel, g.node')].map((g) => g.getBoundingClientRect());
    const ctm = path.getScreenCTM();
    const length = path.getTotalLength();
    for (let i = 1; i < 40; i += 1) {
      const p = path.getPointAtLength((length * i) / 40);
      const x = ctm.a * p.x + ctm.c * p.y + ctm.e;
      const y = ctm.b * p.x + ctm.d * p.y + ctm.f;
      const inside = x > stage.left + 10 && x < stage.right - 10 && y > stage.top + 10 && y < stage.bottom - 10;
      const clear = labels.every((r) => x < r.left - 8 || x > r.right + 8 || y < r.top - 8 || y > r.bottom + 8);
      if (inside && clear && document.elementFromPoint(x, y)?.closest('path.diagram-edge-hit')) return { x, y };
    }
    return null;
  }, key);
}

async function openGate(page, base) {
  await page.goto(`${base}/docs/gate`);
  await waitForDocument(page, 'gate');
  await waitForDiagrams(page);
}

export async function runDetails(engine = 'chromium') {
  const BASE = baseUrl('http://127.0.0.1:4313');
  const REAL = process.env.REAL_URL ? process.env.REAL_URL.replace(/\/$/, '') : null;
  const playwright = loadPlaywright();
  const browser = await playwright[engine].launch();
  const c = checks();
  const facts = { engine, baseUrl: BASE, realUrl: REAL };
  const pageErrors = [];
  const keep = (errors) => pageErrors.push(...errors.page, ...errors.console.filter((e) => !/Failed to load resource/.test(e.text)));
  const shot = (page, name) => page.screenshot({ path: join(SCREENSHOTS, `${engine}-details-${name}.png`) });

  const gate = await api(BASE, '/api/documents/gate');
  const K = keysOf(gate.diagramDetails);
  const ORIGIN = K['edge:Admission>Refused:Origin, scope, visibility or bounds rejected'];
  const AUDIT = K['edge:Admission>Refused:Admission audit unavailable'];
  const DENIED = K['edge:Review>Refused:Denied [time >= deadline]'];
  const ADMISSION = K['node:Admission'];
  const REVIEW = K['node:Review'];
  facts.keys = K;

  try {
    // D1: the server binds exactly the entries it can, and says why for the rest.
    const catalog = await api(BASE, '/api/catalog');
    const detailCodes = catalog.issues.filter((i) => i.code.includes('detail') && i.file.endsWith('/gate/README.md')).map((i) => i.code);
    facts.detailIssues = detailCodes;
    c.check('D1 API: 5 entries bound (2 nodes, 3 transitions incl. two Admission→Refused)', gate.diagramDetails.length === 5 && [ORIGIN, AUDIT, DENIED, ADMISSION, REVIEW].every((k) => Number.isInteger(k)), { bound: gate.diagramDetails.length });
    c.check('D1 API: each unbound entry is a warning with its typed code (10)', detailCodes.length === 10 && catalog.issues.every((i) => i.severity === 'warning') &&
      ['unknown-detail-node', 'unknown-detail-edge', 'unknown-detail-section', 'ambiguous-detail-section', 'duplicate-detail-selector', 'unsupported-detail-diagram', 'ambiguous-detail-edge', 'unknown-detail-diagram'].every((code) => detailCodes.includes(code)), { detailCodes });
    c.check('D1 API: same-pair transitions bound to different Mermaid elements and sections', gate.diagramDetails[ORIGIN].target.element !== gate.diagramDetails[AUDIT].target.element && gate.diagramDetails[ORIGIN].section.title !== gate.diagramDetails[AUDIT].section.title);

    const desk = await openPage(browser, { width: 1440, height: 900 });
    const page = desk.page;

    // D2: vocabulary and routes.
    await openGate(page, BASE);
    const view = await page.evaluate(() => ({
      options: [...document.querySelectorAll('.titlebar [data-view]')].map((o) => [o.getAttribute('data-view'), o.textContent.trim()]),
      source: document.querySelectorAll('button[data-action="source"], [data-action="diagram-source"], .markdown-source, [data-view="source"], [data-view="read"]').length,
      sourceText: /Markdown source/.test(document.querySelector('.titlebar').innerText) || [...document.querySelectorAll('button')].some((b) => /^(Source|Markdown source)$/.test(b.textContent.trim()) || b.getAttribute('aria-label') === 'Markdown source'),
      captions: [...document.querySelectorAll('[data-action="details-section"]')].map((a) => [a.textContent.trim(), a.getAttribute('href')]),
      failedSource: [...document.querySelectorAll('figure.diagram[data-state="failed"] .diagram-source')].length,
      renderedSource: [...document.querySelectorAll('figure.diagram[data-state="rendered"] .diagram-source')].length,
    }));
    facts.view = view;
    c.check('D2 views are Diagrams and Details only', JSON.stringify(view.options.map(([v]) => v)) === '["diagrams","details"]' && view.options[0][1].startsWith('Diagrams') && view.options[1][1] === 'Details', view.options);
    c.check('D2 no Markdown source button, no Mermaid Source toggle', view.source === 0 && !view.sourceText, view);
    c.check('D2 a chart that cannot be drawn still shows its source and error (diagnostic)', view.failedSource === 1 && view.renderedSource === 0, view);
    await page.locator(S.detailsSection).first().click();
    await page.locator('.prose').waitFor();
    const detailsUrl = new URL(page.url());
    c.check('D2 caption "In Details" opens ?view=details at the section', detailsUrl.searchParams.get('view') === 'details' && detailsUrl.hash.length > 1, { url: page.url() });
    await page.goBack();
    await page.locator('.diagram-view').waitFor();
    await page.goForward();
    await page.locator('.prose').waitFor();
    c.check('D2 Back → Diagrams, Forward → Details', new URL(page.url()).searchParams.get('view') === 'details');
    await page.goto(`${BASE}/docs/gate?view=read`);
    await waitForDocument(page, 'gate');
    c.check('D2 ?view=read is not an alias: it opens the default view (Diagrams)', (await page.locator('.diagram-view').count()) === 1 && (await page.locator('.prose').count()) === 0);
    await page.goto(`${BASE}/docs/gate?view=details`);
    await waitForDocument(page, 'gate');
    c.check('D2 ?view=details deep link opens Details', (await page.locator('.prose').count()) === 1);
    c.check('D2 provenance stays the last, closed footer', await page.evaluate(() => {
      const f = document.querySelector('article.document details.provenance');
      return Boolean(f && !f.open && f.parentElement.lastElementChild === f);
    }));

    // D3: + marks only where there is depth; inert nodes neutral.
    await openGate(page, BASE);
    const nodes = await nodeLinkFacts(page);
    const edges = await edgeFacts(page);
    facts.marks = { nodes, edges };
    c.check('D3 explained nodes (Admission, Review) are buttons with a + mark; no ↗ anywhere', nodes.linked === 2 && nodes.linkedWithRole === 2 && nodes.linkedWithMark === 2 && nodes.oldArrowMarks === 0, nodes);
    c.check('D3 every other node is inert: no role, no tab stop, no mark (incl. unbound Refused/Dispatch/Withheld)', nodes.unlinkedInert === nodes.unlinked && nodes.unlinked >= 4, nodes);
    c.check('D3 node + marks sit inside the node, clear of the words', nodes.markProblems === 0, nodes);
    c.check('D3 bound transition labels carry a + clear of their words; unbound labels none', edges.explained === 3 && edges.marked === 3 && edges.unexplainedMarked === 0 && edges.markOnWords === 0 && edges.markIsPlus, edges);
    c.check('D3 transition controls are named with the transition and its label', edges.names.includes('Details: transition Admission to Refused, Origin, scope, visibility or bounds rejected'), edges.names);
    await page.goto(`${BASE}/docs/nessa`);
    await waitForDocument(page, 'nessa');
    await waitForDiagrams(page);
    const root = await nodeLinkFacts(page);
    c.check('D3 root: the navigation-only node (Gate) has a + and is a link; Person and Other inert', root.linked === 1 && root.linkedWithMark === 1 && root.linkedWithRole === 1 && root.unlinkedInert === root.unlinked, root);
    await page.locator(S.diagramNode('gate')).first().click();
    await waitForDocument(page, 'gate');
    c.check('D3 a navigation-only node still navigates at once', new URL(page.url()).pathname === '/docs/gate' && !(await inspectorFacts(page)).open);
    await waitForDiagrams(page);
    await shot(page, 'gate-standard-desktop');

    // D4: transition guard opens the pane; Standard overview, Show full, section boundary, safe content.
    await page.locator(S.detailControl(ORIGIN)).click();
    let ins = await inspectorFacts(page);
    facts.originStandard = ins;
    c.check('D4 clicking the guard label opens the inset pane (non-modal) with the section title', ins.open && !ins.modal && ins.layout === 'pane' && ins.title === 'Admission refusal rules' && ins.kind === 'Transition', ins);
    c.check('D4 the pane names the transition and its label; focus is on the title', ins.element.includes('Admission → Refused') && ins.element.includes('Origin, scope, visibility or bounds rejected') && ins.activeIsTitle, ins);
    c.check('D4 Standard shows the overview (intro + rule list), not the nested heading, and offers Show full', ins.shown === 'overview' && ins.text.includes('did not reach the server') && ins.text.includes('an untrusted origin is refused') && !ins.text.includes('Nested bounds rule') && ins.showFull, ins);
    c.check('D4 the pane links its section in Details', new URL(ins.sectionHref ?? '', BASE).searchParams.get('view') === 'details' && new URL(ins.sectionHref ?? '', BASE).hash === '#admission-refusal-rules', { href: ins.sectionHref });
    await page.locator(S.inspectorShowFull).click();
    ins = await inspectorFacts(page);
    c.check('D4 Show full explanation: the whole section, nested heading included, and nothing after it', ins.shown === 'full' && ins.text.includes('Nested bounds rule') && ins.text.includes('Evidence:') && !ins.text.includes('The audit must commit') && !ins.text.includes('Text after every section') && !ins.showFull, ins);
    const safety = await page.evaluate(() => {
      const d = document.querySelector('dialog.detail-inspector');
      return {
        scripts: d.querySelectorAll('script').length,
        pwned: window.__pwned === 1,
        rawShown: d.innerText.includes('<script>window.__pwned = 1</script>'),
        jsHrefs: [...d.querySelectorAll('a')].filter((a) => /^javascript:/i.test(a.getAttribute('href') ?? '')).length,
        unresolved: d.querySelectorAll('[data-evidence="unresolved"]').length,
        external: [...d.querySelectorAll('a.external-link')].map((a) => [a.getAttribute('href'), a.target, a.rel]),
        docLink: d.querySelector('a.doc-link')?.getAttribute('href') ?? null,
        ids: [...d.querySelectorAll('[id]')].map((e) => e.id).filter((id) => document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length > 1),
      };
    });
    facts.safety = safety;
    c.check('D4 section content is safe: raw HTML as text, no script, javascript: unresolved, external in a new tab, doc links routed', safety.scripts === 0 && !safety.pwned && safety.rawShown && safety.jsHrefs === 0 && safety.unresolved === 1 && safety.external.length === 1 && safety.external[0][1] === '_blank' && /noopener/.test(safety.external[0][2]) && new URL(safety.docLink ?? '', BASE).pathname === '/docs/review' && safety.ids.length === 0, safety);
    await shot(page, 'pane-full-desktop');

    // D5: the other same-pair transition opens its own section; Escape returns focus.
    await page.locator(S.detailControl(AUDIT)).click();
    ins = await inspectorFacts(page);
    c.check('D5 the second Admission → Refused label opens its own section', ins.open && ins.title === 'Direct dispatch admission' && ins.text.includes('The audit must commit') && !ins.text.includes('did not reach the server'), ins);
    c.check('D5 the open element is marked, and only it (aria-expanded)', await page.evaluate((k) => [...document.querySelectorAll('figure.diagram svg [aria-expanded="true"]')].map((e) => e.getAttribute('data-detail-key')).join() === String(k), AUDIT));
    await page.keyboard.press('Escape');
    ins = await inspectorFacts(page);
    const back = await activeElement(page);
    c.check('D5 Escape closes and returns focus to the label that opened it', !ins.open && back?.label === 'Details: transition Admission to Refused, Admission audit unavailable', { back });

    // D6: keyboard: Enter and Space open; close button returns focus.
    await page.locator(S.detailControl(DENIED)).focus();
    await page.keyboard.press('Enter');
    ins = await inspectorFacts(page);
    c.check('D6 Enter on a focused transition opens it (label with >= kept exactly)', ins.open && ins.title === 'Review refusal' && ins.element.includes('Denied [time >= deadline]'), ins);
    await page.locator(S.inspectorClose).click();
    c.check('D6 Close returns focus to the transition', !(await inspectorFacts(page)).open && (await activeElement(page))?.label?.includes('Denied [time >= deadline]'));
    await page.keyboard.press(' ');
    c.check('D6 Space opens it too', (await inspectorFacts(page)).title === 'Review refusal');
    await page.keyboard.press('Escape');
    await page.locator(S.detailControl(ADMISSION)).focus();
    await page.keyboard.press('Enter');
    ins = await inspectorFacts(page);
    c.check('D6 a state opens its section: Standard overview stops at 2 blocks; evidence flagged', ins.kind === 'State' && ins.title === 'Call admission' && ins.text.includes('Second overview paragraph') && !ins.text.includes('Third paragraph') && ins.showFull && (await page.locator('dialog.detail-inspector [data-evidence="repo-file"].evidence-missing').count()) === 1, ins);
    await page.locator(S.inspectorAnchor('gate', 'admission-refusal-rules')).click();
    await page.locator('#admission-refusal-rules').waitFor();
    c.check('D6 a same-page #section link in the inspector opens Details at that heading and closes the inspector', new URL(page.url()).hash === '#admission-refusal-rules' && (await page.locator('.prose').count()) === 1 && !(await inspectorFacts(page)).open, { url: page.url() });
    await openGate(page, BASE);

    // D7: the line itself is a click target; a drag never opens.
    const point = await pointOnLine(page, ORIGIN);
    if (point) await page.mouse.click(point.x, point.y);
    ins = await inspectorFacts(page);
    c.check('D7 clicking the transition line (away from its label) opens it', point !== null && ins.open && ins.title === 'Admission refusal rules', { point, title: ins.title });
    await page.keyboard.press('Escape');
    // Zoomed in, so the stage has somewhere to pan.
    for (let i = 0; i < 3; i += 1) await page.locator('button[data-action="zoom-in"]').first().click();
    await page.locator(S.detailControl(DENIED)).evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
    const box = await page.locator(S.detailControl(DENIED)).boundingBox();
    const s0 = await chartState(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(box.x + box.width / 2 - i * 6, box.y + box.height / 2 - i * 5);
    await page.mouse.up();
    await page.waitForTimeout(150);
    const s1 = await chartState(page);
    c.check('D7 a drag that starts on a transition label pans and never opens the inspector', s0.pannable && !(await inspectorFacts(page)).open && (s1.left !== s0.left || s1.top !== s0.top), { pannable: s0.pannable, before: [s0.left, s0.top], after: [s1.left, s1.top] });
    await page.locator(S.detailControl(ADMISSION)).evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
    const nbox = await page.locator(S.detailControl(ADMISSION)).boundingBox();
    await page.mouse.move(nbox.x + nbox.width / 2, nbox.y + nbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(nbox.x + nbox.width / 2 + 2, nbox.y + nbox.height / 2 + 1);
    await page.mouse.up();
    c.check('D7 a press moving < 4 px is still a click (opens the state)', (await inspectorFacts(page)).title === 'Call admission');
    await page.keyboard.press('Escape');

    // D8: zoom and pan survive opening, switching and closing; the SVG is not redrawn.
    // (Clicks are dispatched on the elements, so no test-driven scrolling moves the stage.)
    await page.locator(S.detailControl(ORIGIN)).evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
    await page.locator('figure.diagram .diagram-svg svg').first().evaluate((svg) => svg.setAttribute('data-probe', 'kept'));
    const z0 = await chartState(page);
    const dispatchClick = (key) => page.locator(S.detailControl(key)).evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await dispatchClick(ORIGIN);
    const z1 = await chartState(page);
    const paneRect = (await inspectorFacts(page)).rect;
    const fitRect = await page.locator(S.fitButton).first().boundingBox();
    await dispatchClick(AUDIT);
    const zs = await chartState(page);
    const auditClear = await page.locator(S.detailControl(AUDIT)).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const pane = document.querySelector('dialog.detail-inspector').getBoundingClientRect();
      const stage = el.closest('.diagram-stage').getBoundingClientRect();
      return r.right <= pane.left && r.left >= stage.left && r.top >= stage.top && r.bottom <= stage.bottom;
    });
    await page.keyboard.press('Escape');
    const z2 = await chartState(page);
    facts.zoomPan = { z0, z1, zs, z2, auditClear };
    c.check('D8 opening with the element already in view beside the pane: scale, pan, stage size and the SVG element unchanged', z1.scale === z0.scale && Math.abs(z1.left - z0.left) <= 1 && Math.abs(z1.top - z0.top) <= 1 && z1.stageWidth === z0.stageWidth && z1.stageHeight === z0.stageHeight && z1.probe === 'kept', facts.zoomPan);
    c.check('D8 switching to an element under the pane pans it into view beside the pane at the same scale; closing leaves the pan and the SVG as they are', auditClear && zs.scale === z0.scale && zs.probe === 'kept' && z2.scale === z0.scale && z2.left === zs.left && z2.top === zs.top && z2.probe === 'kept', facts.zoomPan);
    c.check('D8 the chart controls stay clear of the pane', fitRect && paneRect && fitRect.x + fitRect.width <= paneRect.x, { fitRect, paneRect });

    // D9: node with both an explanation and a deeper document; inspector links navigate and clear the selection.
    await page.locator(S.detailControl(REVIEW)).click({ force: true });
    ins = await inspectorFacts(page);
    c.check('D9 a node with a section and a document opens the inspector (no navigation) with "Open Review flow"', ins.open && new URL(page.url()).pathname === '/docs/gate' && ins.title === 'Destructive review' && ins.linked === 'Open Review flow', ins);
    await page.locator(S.inspectorLinkedDocument).click();
    await waitForDocument(page, 'review');
    c.check('D9 Open <doc> navigates, and the inspector is gone', new URL(page.url()).pathname === '/docs/review' && !(await inspectorFacts(page)).open);
    await page.goBack();
    await waitForDocument(page, 'gate');
    await waitForDiagrams(page);
    c.check('D9 Back arrives with nothing selected', !(await inspectorFacts(page)).open && (await page.locator('figure.diagram svg [data-selected]').count()) === 0);
    await page.locator(S.detailControl(ORIGIN)).click();
    await page.locator(S.inspectorShowFull).click();
    await page.locator('dialog.detail-inspector a.doc-link').click();
    await waitForDocument(page, 'review');
    c.check('D9 a document link inside the section navigates normally and clears the selection', new URL(page.url()).pathname === '/docs/review' && !(await inspectorFacts(page)).open);
    await page.goBack();
    await waitForDocument(page, 'gate');
    await waitForDiagrams(page);

    // D10: the view switch and a theme change close it; Details view charts open it too.
    await page.locator(S.detailControl(ORIGIN)).click();
    await page.locator(S.viewDetails).click();
    await page.locator('.prose').waitFor();
    c.check('D10 switching to Details closes the inspector', !(await inspectorFacts(page)).open);
    await waitForDiagrams(page);
    await page.locator(`.prose ${S.detailControl(ORIGIN).replace('figure.diagram ', 'figure.diagram ')}`).click();
    c.check('D10 the inline chart in Details opens the same inspector', (await inspectorFacts(page)).title === 'Admission refusal rules');
    await page.locator(S.settingsLink).click();
    await page.locator(S.appearanceOption('light')).click();
    await page.goBack();
    await waitForDocument(page, 'gate');
    await waitForDiagrams(page);
    c.check('D10 after a theme change, nothing is selected and the chart is redrawn in the new theme', !(await inspectorFacts(page)).open && (await page.evaluate(() => document.documentElement.dataset.appearance)) === 'light');
    await page.evaluate(() => localStorage.setItem('nessa-state-browser:appearance', 'dark'));

    // D11: the preference — live from another tab, no redraw, no pan jump, the open detail kept.
    await openGate(page, BASE);
    await page.locator('figure.diagram .diagram-stage').first().evaluate((s) => { s.scrollLeft = 30; s.scrollTop = 30; });
    await page.locator('figure.diagram .diagram-svg svg').first().evaluate((svg) => svg.setAttribute('data-probe', 'kept'));
    await page.locator(S.detailControl(ORIGIN)).click({ force: true });
    const p0 = await chartState(page);
    const settings = await desk.context.newPage();
    await settings.goto(`${BASE}/settings`);
    await settings.locator(S.diagramDetailOption('compact')).waitFor();
    const help = await settings.locator('[data-testid="diagram-detail-help"]').innerText();
    const pressed0 = await settings.locator('[data-diagram-detail-option][aria-pressed="true"]').getAttribute('data-diagram-detail-option');
    c.check('D11 Settings › General: Diagram detail, Standard by default, modes explained', pressed0 === 'standard' && /Compact/.test(help) && /Standard/.test(help) && /Full/.test(help), { pressed0, help });
    await settings.locator(S.diagramDetailOption('compact')).click();
    await page.waitForFunction(() => document.querySelector('.document-layout')?.getAttribute('data-diagram-detail') === 'compact');
    const p1 = await chartState(page);
    const compact = await edgeFacts(page);
    facts.compact = compact;
    c.check('D11 Compact applies at once: same SVG, same scale and pan, inspector still open', p1.probe === 'kept' && p1.scale === p0.scale && p1.left === p0.left && p1.top === p0.top && (await inspectorFacts(page)).open, { p0, p1 });
    c.check('D11 Compact hides transition labels (except the open one) and notes; + marks stay', compact.labelOpacity.filter((o) => o === 0).length === compact.labels - 1 && compact.noteOpacity.every((o) => o === 0) && compact.markOpacity.every((o) => o === 1), compact);
    c.check('D11 Compact keeps the meaning in the accessible names and the note text in the SVG', compact.names.every((n) => /, .+/.test(n)) && compact.noteText.some((t) => t.includes('Sent calls own their task')), compact.names);
    await page.keyboard.press('Escape');
    await page.locator(S.detailControl(AUDIT)).focus();
    const focusedLabel = await page.locator(S.detailControl(AUDIT)).evaluate((g) => Number(getComputedStyle(g.querySelector(':scope > .label')).opacity));
    c.check('D11 Compact: a focused transition shows its words', focusedLabel === 1, { focusedLabel });
    await page.keyboard.press('Enter');
    c.check('D11 Compact: the transition still opens its details from the keyboard', (await inspectorFacts(page)).title === 'Direct dispatch admission');
    await shot(page, 'compact-desktop');
    await settings.locator(S.diagramDetailOption('full')).click();
    await page.waitForFunction(() => document.querySelector('.document-layout')?.getAttribute('data-diagram-detail') === 'full');
    await page.locator(S.detailControl(ORIGIN)).click({ force: true });
    ins = await inspectorFacts(page);
    c.check('D11 Full opens the whole authored section at once, no Show full button', ins.shown === 'full' && ins.text.includes('Nested bounds rule') && !ins.showFull, ins);
    c.check('D11 Full keeps labels drawn and the SVG untouched', (await chartState(page)).probe === 'kept' && (await edgeFacts(page)).labelOpacity.every((o) => o === 1));
    await page.reload();
    await waitForDocument(page, 'gate');
    c.check('D11 the preference survives a reload', (await chartState(page)).level === 'full');
    await settings.locator(S.diagramDetailOption('standard')).click();
    await settings.close();

    // D12: invalid and blocked storage.
    const bad = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await bad.addInitScript((key) => localStorage.setItem(key, 'bogus'), DETAIL_KEY);
    const bp = await bad.newPage();
    bp.on('pageerror', (e) => pageErrors.push({ text: String(e) }));
    await bp.goto(`${BASE}/settings`);
    const invalid = await bp.locator('[data-diagram-detail-option][aria-pressed="true"]').getAttribute('data-diagram-detail-option');
    await bad.close();
    const blocked = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await blocked.addInitScript((key) => {
      const get = Storage.prototype.getItem;
      const set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (k) { if (k === key) throw new DOMException('denied', 'SecurityError'); return get.call(this, k); };
      Storage.prototype.setItem = function (k, v) { if (k === key) throw new DOMException('denied', 'SecurityError'); return set.call(this, k, v); };
    }, DETAIL_KEY);
    const xp = await blocked.newPage();
    const blockedErrors = [];
    xp.on('pageerror', (e) => blockedErrors.push(String(e)));
    await xp.goto(`${BASE}/settings`);
    const blockedDefault = await xp.locator('[data-diagram-detail-option][aria-pressed="true"]').getAttribute('data-diagram-detail-option');
    await xp.locator(S.diagramDetailOption('full')).click();
    const blockedChosen = await xp.locator('[data-diagram-detail-option][aria-pressed="true"]').getAttribute('data-diagram-detail-option');
    await xp.locator(S.treeLink('gate')).click();
    await waitForDocument(xp, 'gate');
    await waitForDiagrams(xp);
    await xp.locator(S.detailControl(ORIGIN)).click();
    const blockedFull = await inspectorFacts(xp);
    await blocked.close();
    facts.storage = { invalid, blockedDefault, blockedChosen, blockedShown: blockedFull.shown, blockedErrors };
    c.check('D12 an invalid stored value reads as Standard', invalid === 'standard', facts.storage);
    c.check('D12 blocked storage: Standard, a choice still applies in this tab, no page error', blockedDefault === 'standard' && blockedChosen === 'full' && blockedFull.shown === 'full' && blockedErrors.length === 0, facts.storage);

    // D13: expanded chart — the inspector is a dialog over it; Escape closes only the inspector.
    await openGate(page, BASE);
    await page.locator(S.expandButton).first().click();
    await page.locator('figure.diagram[data-expanded]').waitFor();
    await page.locator(`figure.diagram[data-expanded] .diagram-svg svg [role="button"][data-detail-key="${ORIGIN}"]`).click();
    ins = await inspectorFacts(page);
    const onTop = await page.evaluate(() => {
      const r = document.querySelector('dialog.detail-inspector').getBoundingClientRect();
      return Boolean(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('dialog.detail-inspector'));
    });
    c.check('D13 over an expanded chart the inspector is a modal dialog on top', ins.open && ins.modal && ins.layout === 'dialog' && onTop, { ins: { modal: ins.modal, layout: ins.layout }, onTop });
    await shot(page, 'expanded-dialog-desktop');
    await page.keyboard.press('Escape');
    const afterOne = { inspector: (await inspectorFacts(page)).open, expanded: await page.locator('figure.diagram[data-expanded]').count() };
    await page.keyboard.press('Escape');
    const afterTwo = await page.locator('figure.diagram[data-expanded]').count();
    c.check('D13 Escape closes the inspector first, the chart stays expanded; the next Escape collapses it', !afterOne.inspector && afterOne.expanded === 1 && afterTwo === 0, { afterOne, afterTwo });

    // D18 (F5): one Escape closes one layer, the last opened or raised; focus returns each time.
    await openGate(page, BASE);
    await page.locator(S.detailControl(ORIGIN)).click();
    await page.locator(S.outlineButton).click();
    await page.locator(S.outline).waitFor();
    await page.keyboard.press('Escape');
    const l1 = { outline: await page.locator(S.outline).count(), inspector: (await inspectorFacts(page)).open, focus: (await activeElement(page))?.action };
    await page.keyboard.press('Escape');
    const l2 = { inspector: (await inspectorFacts(page)).open, focus: (await activeElement(page))?.label };
    facts.layers = { l1, l2 };
    c.check('D18 Outline over the inspector: Escape closes the Outline only, focus to its button', l1.outline === 0 && l1.inspector && l1.focus === 'outline', l1);
    c.check('D18 then Escape closes the inspector, focus to the transition', !l2.inspector && l2.focus?.startsWith('Details: transition Admission to Refused, Origin'), l2);
    await page.locator(S.detailControl(ORIGIN)).click();
    await page.locator(S.expandButton).first().click();
    await page.locator('figure.diagram[data-expanded]').waitFor();
    const raised = await inspectorFacts(page);
    await page.keyboard.press('Escape');
    const r1 = { inspector: (await inspectorFacts(page)).open, expanded: await page.locator('figure.diagram[data-expanded]').count() };
    await page.keyboard.press('Escape');
    const r2 = { expanded: await page.locator('figure.diagram[data-expanded]').count(), focus: (await activeElement(page))?.action };
    facts.layers.raised = { modal: raised.modal, r1, r2 };
    c.check('D18 pane open, then Expand: the inspector becomes a dialog in front and closes first; then the chart', raised.open && raised.modal && !r1.inspector && r1.expanded === 1 && r2.expanded === 0 && r2.focus === 'expand', facts.layers.raised);

    // D19 (F4): following a link from the inspector closes it, in both views; a new-tab link does not navigate here.
    await page.goto(`${BASE}/docs/gate?view=details`);
    await waitForDocument(page, 'gate');
    await waitForDiagrams(page);
    await page.locator(`.prose ${S.detailControl(ADMISSION)}`).click();
    await page.locator(S.inspectorAnchor('gate', 'admission-refusal-rules')).click();
    await page.waitForFunction(() => location.hash === '#admission-refusal-rules');
    const anchorFacts = { open: (await inspectorFacts(page)).open, focus: await page.evaluate(() => document.activeElement?.id ?? null), url: page.url() };
    c.check('D19 Details view: a same-page #section link closes the inspector and focuses that heading', !anchorFacts.open && anchorFacts.focus === 'admission-refusal-rules', anchorFacts);
    await desk.context.route('https://example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' }));
    await page.locator(`.prose ${S.detailControl(ORIGIN)}`).click();
    await page.locator(S.inspectorShowFull).click();
    const before = page.url();
    const [popup] = await Promise.all([desk.context.waitForEvent('page'), page.locator(S.inspectorExternalLink).click()]);
    await popup.close();
    c.check('D19 an external link opens a new tab: this page stays, the inspector stays open', page.url() === before && (await inspectorFacts(page)).open);
    await page.keyboard.press('Escape');
    await page.locator(`.prose ${S.detailControl(ORIGIN)}`).click();
    await page.goBack();
    await page.waitForFunction(() => location.hash === '');
    c.check('D19 Back (a move in this tab) closes it', !(await inspectorFacts(page)).open, { url: page.url() });

    // D17 (F2, F3) and D20 (F6): the edge-cases page.
    const edgeDoc = await api(BASE, '/api/documents/edge-cases');
    const EK = keysOf(edgeDoc.diagramDetails);
    await page.goto(`${BASE}/docs/edge-cases`);
    await waitForDocument(page, 'edge-cases');
    await waitForDiagrams(page);
    const sizes = await page.evaluate(() => [...document.querySelectorAll('.diagram-view figure.diagram')].map((f) => ({
      index: f.dataset.diagramIndex,
      state: f.dataset.state,
      controls: f.querySelectorAll('[role="button"][data-detail-key]').length,
      source: f.querySelectorAll('.diagram-source').length,
      text: f.querySelector('.diagram-error')?.textContent ?? '',
    })));
    facts.sizes = sizes;
    c.check('D17 a chart of exactly the size limit is drawn and its detail bound', sizes[3]?.state === 'rendered' && sizes[3]?.controls === 1, sizes[3]);
    c.check('D17 one character over (with or without front matter): not drawn, said so, no source dump, no detail controls', [4, 5].every((i) => sizes[i]?.state === 'too-large' && sizes[i]?.controls === 0 && sizes[i]?.source === 0 && sizes[i]?.text.includes('100,001 characters')), sizes.slice(4));
    const labels = await page.evaluate(() => [...document.querySelectorAll('figure.diagram[data-diagram-index="0"] g.edgeLabel[data-detail-key]')].map((g) => g.getAttribute('aria-label')));
    c.check('D17 only the plain label is a control, named as written; entity-code and HTML labels are not bound', labels.length === 1 && labels[0] === 'Details: transition A to B, plain words', { labels });
    const edgeIssues = (await api(BASE, '/api/catalog')).issues.filter((i) => i.file.endsWith('/edge-cases.md'));
    c.check('D17 Health has a typed warning for each: two unsupported-detail-label, two unsupported-detail-diagram, quoting no internal or markup text', edgeIssues.filter((i) => i.code === 'unsupported-detail-label').length === 2 && edgeIssues.filter((i) => i.code === 'unsupported-detail-diagram').length === 2 && edgeIssues.every((i) => !/[\uFB02\u00B6]|<b>/.test(i.message)), edgeIssues.map((i) => i.code));
    await page.locator(S.detailControl(EK['node:Outer'])).focus();
    await page.keyboard.press('Enter');
    let charts = await page.evaluate(() => ({
      links: [...document.querySelectorAll('dialog.detail-inspector a[data-action="inspector-chart"]')].map((a) => [a.dataset.diagramIndex, a.getAttribute('href'), a.textContent.trim()]),
      figures: document.querySelectorAll('dialog.detail-inspector figure').length,
      index0: document.querySelectorAll('figure.diagram[data-diagram-index="0"]').length,
    }));
    c.check('D20 a chart in the section is a link to the page\'s chart 2 (the quoted block), not a second chart', charts.figures === 0 && charts.index0 === 1 && charts.links.length === 1 && charts.links[0][0] === '1' && new URL(charts.links[0][1], BASE).pathname === '/docs/edge-cases' && new URL(charts.links[0][1], BASE).searchParams.get('view') === 'details' && new URL(charts.links[0][1], BASE).hash === '#chart.1' && charts.links[0][2] === 'Open chart 2 in Details', charts);
    await page.locator(S.inspectorShowFull).click();
    charts = await page.evaluate(() => ({ links: [...document.querySelectorAll('dialog.detail-inspector a[data-action="inspector-chart"]')].map((a) => a.dataset.diagramIndex), figures: document.querySelectorAll('dialog.detail-inspector figure').length }));
    c.check('D20 the full section links both of its charts by their page order (1, 2)', charts.figures === 0 && charts.links.join() === '1,2', charts);
    await page.locator(S.inspectorChart(2)).click();
    await page.waitForFunction(() => location.hash === '#chart.2');
    await waitForDiagrams(page);
    const landed = await page.evaluate(() => {
      const figure = document.getElementById('chart.2');
      const r = figure?.getBoundingClientRect();
      return { inProse: Boolean(figure?.closest('.prose')), state: figure?.dataset.state, top: r ? Math.round(r.top) : null, focus: document.activeElement?.id ?? null };
    });
    c.check('D20 following it opens Details at that chart (in view, focused) and closes the inspector', !(await inspectorFacts(page)).open && new URL(page.url()).searchParams.get('view') === 'details' && landed.inProse && landed.focus === 'chart.2' && landed.top !== null && landed.top < 900, landed);
    keep(desk.errors);
    await desk.context.close();

    // D22: a flowchart component map binds its labelled edges and nodes with the same controls.
    const mapDoc = await api(BASE, '/api/documents/gate-map');
    const MK = keysOf(mapDoc.diagramDetails);
    const READY = MK['edge:Gate>Review:ready'];
    const REFUSED = MK['edge:Gate>Review:refused'];
    const IDENTITY = MK['edge:Review>Audit:validated identity'];
    const REVIEW_NODE = MK['node:Review'];
    const mapIssues = (await api(BASE, '/api/catalog')).issues.filter((i) => i.file.endsWith('/gate/map.md')).map((i) => i.code).sort();
    facts.map = { keys: MK, issues: mapIssues, elements: mapDoc.diagramDetails.map((d) => d.target.element ?? d.target.node) };
    c.check('D22 API: a flowchart binds 3 labelled edges and 1 node (family flowchart); sibling edges get their own Mermaid elements', mapDoc.diagramDetails.length === 4 && mapDoc.diagramDetails.every((d) => d.family === 'flowchart') && [READY, REFUSED, IDENTITY, REVIEW_NODE].every(Number.isInteger) && mapDoc.diagramDetails[READY].target.element !== mapDoc.diagramDetails[REFUSED].target.element, facts.map);
    c.check('D22 API: a repeated label is ambiguous; entity-code and Markdown labels are unsupported (warnings, quoting no internal or markup text)', JSON.stringify(mapIssues) === JSON.stringify(['ambiguous-detail-edge', 'unsupported-detail-label', 'unsupported-detail-label']), { mapIssues });
    const map = await openPage(browser, { width: 1280, height: 800 });
    await map.page.goto(`${BASE}/docs/gate-map`);
    await waitForDocument(map.page, 'gate-map');
    await waitForDiagrams(map.page);
    const mapEdges = await edgeFacts(map.page);
    const mapBound = await map.page.evaluate((details) => details.map((d, key) => {
      const el = document.querySelector(`figure.diagram .diagram-svg svg [role="button"][data-detail-key="${key}"]`);
      if (!el) return { key, found: false };
      const marks = el.querySelectorAll('.diagram-depth-mark, .diagram-depth-inset').length;
      if (d.target.kind === 'edge') {
        const words = el.querySelector(':scope > .label')?.textContent.replace(/\s+/g, ' ').trim();
        const paths = [...el.ownerSVGElement.querySelectorAll('path.diagram-edge-path')].filter((p) => p.getAttribute('data-detail-key') === String(key));
        return { key, found: true, words, matches: words === d.target.label && paths.length === 1 && paths[0].getAttribute('data-id') === d.target.element, marks };
      }
      return { key, found: true, matches: el.matches('g.node') && el.id.includes(`-flowchart-${d.target.node}-`), marks, target: el.getAttribute('data-target-id') };
    }), mapDoc.diagramDetails);
    facts.map.bound = mapBound;
    c.check('D22 every published edge and node is bound to the element it names (label words = authored label, line = its Mermaid element), with exactly one +', mapBound.every((b) => b.found && b.matches && b.marks === 1), mapBound);
    c.check('D22 only the 3 bound labels are controls; the repeated, entity-code, Markdown and unexplained labels carry no +', mapEdges.explained === 3 && mapEdges.marked === 3 && mapEdges.unexplainedMarked === 0 && mapEdges.markOnWords === 0 && mapEdges.labels === 8, mapEdges);
    c.check('D22 edge controls are named as edges with their label', mapEdges.names.includes('Details: edge Gate to Review, ready') && mapEdges.names.includes('Details: edge Review to Audit, validated identity'), mapEdges.names);
    const mapNodes = await map.page.evaluate(() => [...document.querySelectorAll('figure.diagram .diagram-svg svg g.node')].map((n) => ({
      id: n.id.replace(/^.*-flowchart-(.+)-\d+$/, '$1'),
      role: n.getAttribute('role'),
      label: n.getAttribute('aria-label'),
      marks: n.querySelectorAll('.diagram-depth-mark, .diagram-depth-inset').length,
    })));
    facts.map.nodes = mapNodes;
    const byNode = Object.fromEntries(mapNodes.map((n) => [n.id, n]));
    c.check('D22 nodes: navigation-only is a link, navigation + details is a details button, the rest inert; one + each where there is depth', byNode.Gate?.role === 'link' && byNode.Gate.marks === 1 && byNode.Review?.role === 'button' && byNode.Review.label === 'Details: Review (also opens Review flow)' && byNode.Review.marks === 1 && ['Audit', 'Sender', 'Plain'].every((n) => byNode[n]?.role === null && byNode[n].marks === 0), mapNodes);
    await map.page.locator(S.detailControl(READY)).click();
    let mins = await inspectorFacts(map.page);
    c.check('D22 clicking "ready" opens the inset pane titled by its section, kind Edge, naming the edge and label', mins.open && !mins.modal && mins.layout === 'pane' && mins.title === 'Gate readiness' && mins.kind === 'Edge' && mins.element.startsWith('Gate → Review') && mins.element.endsWith('ready') && !mins.element.includes('refused') && mins.activeIsTitle, mins);
    await map.page.locator(S.detailControl(REFUSED)).click({ force: true });
    mins = await inspectorFacts(map.page);
    const selectedKeys = await map.page.evaluate(() => [...document.querySelectorAll('[data-detail-key][aria-expanded="true"]')].map((e) => e.getAttribute('data-detail-key')));
    c.check('D22 the sibling edge of the same pair opens its own section; only it is expanded', mins.title === 'Gate refusal' && mins.element.startsWith('Gate → Review') && mins.element.endsWith('refused') && JSON.stringify(selectedKeys) === JSON.stringify([String(REFUSED)]), { title: mins.title, selectedKeys });
    await map.page.keyboard.press('Escape');
    const mapBack = await activeElement(map.page);
    c.check('D22 Escape closes and returns focus to the edge label', !(await inspectorFacts(map.page)).open && mapBack?.label === 'Details: edge Gate to Review, refused', { mapBack });
    await map.page.locator(S.detailControl(IDENTITY)).focus();
    await map.page.keyboard.press('Enter');
    mins = await inspectorFacts(map.page);
    c.check('D22 Enter on a focused edge opens it', mins.open && mins.title === 'Checking the identity', mins);
    await map.page.locator(S.inspectorClose).click();
    c.check('D22 Close returns focus to the edge', !(await inspectorFacts(map.page)).open && (await activeElement(map.page))?.label === 'Details: edge Review to Audit, validated identity');
    await map.page.locator(S.detailControl(IDENTITY)).focus();
    await map.page.keyboard.press(' ');
    c.check('D22 Space on a focused edge opens it', (await inspectorFacts(map.page)).title === 'Checking the identity');
    await map.page.keyboard.press('Escape');
    const mapPoint = await pointOnLine(map.page, READY);
    if (mapPoint) await map.page.mouse.click(mapPoint.x, mapPoint.y);
    mins = await inspectorFacts(map.page);
    c.check('D22 clicking the edge line (away from its label) opens that edge', mapPoint !== null && mins.open && mins.title === 'Gate readiness', { mapPoint, title: mins.title });
    await map.page.keyboard.press('Escape');
    await map.page.locator(S.detailControl(REVIEW_NODE)).click();
    mins = await inspectorFacts(map.page);
    c.check('D22 a node with a section and a document opens the inspector (kind Node) offering "Open Review flow"', mins.open && mins.kind === 'Node' && mins.title === 'Review service' && mins.linked === 'Open Review flow', mins);
    await map.page.locator(S.inspectorLinkedDocument).click();
    await map.page.waitForURL((url) => url.pathname === '/docs/review');
    c.check('D22 that link navigates and clears the selection', !(await inspectorFacts(map.page)).open, { url: map.page.url() });
    await map.page.goto(`${BASE}/docs/gate-map`);
    await waitForDocument(map.page, 'gate-map');
    await waitForDiagrams(map.page);
    await map.page.locator(`figure.diagram .diagram-svg svg [role="link"][data-target-id="gate"]`).click();
    await map.page.waitForURL((url) => url.pathname === '/docs/gate');
    c.check('D22 a navigation-only node navigates at once, opening nothing', !(await inspectorFacts(map.page)).open, { url: map.page.url() });
    // Compact: the labels go (but the open one), the + marks and names stay, the edge still opens.
    await map.page.evaluate((key) => localStorage.setItem(key, 'compact'), DETAIL_KEY);
    await map.page.goto(`${BASE}/docs/gate-map`);
    await waitForDocument(map.page, 'gate-map');
    await waitForDiagrams(map.page);
    await map.page.locator(S.detailControl(IDENTITY)).focus();
    await map.page.keyboard.press('Enter');
    const mapCompact = await edgeFacts(map.page);
    mins = await inspectorFacts(map.page);
    c.check('D22 Compact: edge labels hidden but the open one, + marks and names kept, the edge opens from the keyboard', mapCompact.labelOpacity.filter((o) => o === 0).length === mapCompact.labels - 1 && mapCompact.markOpacity.every((o) => o === 1) && mapCompact.names.length === 3 && mins.title === 'Checking the identity', { labelOpacity: mapCompact.labelOpacity, markOpacity: mapCompact.markOpacity });
    await map.page.keyboard.press('Escape');
    await map.page.evaluate((key) => localStorage.setItem(key, 'full'), DETAIL_KEY);
    await map.page.goto(`${BASE}/docs/gate-map`);
    await waitForDocument(map.page, 'gate-map');
    await waitForDiagrams(map.page);
    await map.page.locator(S.detailControl(READY)).click();
    mins = await inspectorFacts(map.page);
    c.check('D22 Full: the edge opens its whole section', mins.shown === 'full' && mins.title === 'Gate readiness', { shown: mins.shown });
    await shot(map.page, 'map-ready');
    await map.page.keyboard.press('Escape');
    await map.page.evaluate((key) => localStorage.removeItem(key), DETAIL_KEY);
    keep(map.errors);
    await map.context.close();

    // D18 (narrow): a control's own Escape goes first, then the drawer.
    const phone = await openPage(browser, { width: 390, height: 844 });
    await openGate(phone.page, BASE);
    await phone.page.locator(S.menuButton).click();
    await phone.page.locator(S.search).fill('gate');
    await phone.page.keyboard.press('Escape');
    const d1 = { query: await phone.page.locator(S.search).inputValue(), open: await phone.page.locator('#sidebar[data-open="true"]').count() };
    await phone.page.keyboard.press('Escape');
    const d2 = { open: await phone.page.locator('#sidebar[data-open="true"]').count(), toggle: (await activeElement(phone.page))?.sidebarToggle };
    c.check('D18 drawer: Escape in the search field clears it and keeps the drawer; the next Escape closes the drawer, focus to the toggle', d1.query === '' && d1.open === 1 && d2.open === 0 && d2.toggle, { d1, d2 });
    keep(phone.errors);
    await phone.context.close();

    // D14: geometry across widths, sidebar states and appearances; narrow is a dialog with a focus trap.
    facts.layouts = [];
    for (const appearance of ['dark', 'light']) {
      for (const viewport of WIDTHS) {
        const sidebars = viewport.width >= 900 ? [{ name: 'w350', width: '350', state: 'shown' }, { name: 'hidden', width: '260', state: 'hidden' }] : [{ name: 'drawer', width: '260', state: 'shown' }];
        for (const sidebar of sidebars) {
          const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
          await ctx.addInitScript(([a, w, s]) => {
            localStorage.setItem('nessa-state-browser:appearance', a);
            localStorage.setItem('nessa-state-browser:sidebar-width', w);
            localStorage.setItem('nessa-state-browser:sidebar', s);
          }, [appearance, sidebar.width, sidebar.state]);
          const p = await ctx.newPage();
          const errs = { page: [], console: [] };
          p.on('pageerror', (e) => errs.page.push({ text: String(e) }));
          await openGate(p, BASE);
          const before = await chartState(p);
          await p.locator(S.detailControl(ORIGIN)).scrollIntoViewIfNeeded();
          await p.locator(S.detailControl(ORIGIN)).click({ force: true });
          const f = await inspectorFacts(p);
          const after = await chartState(p);
          const clear = await p.locator(S.detailControl(ORIGIN)).evaluate((el) => {
            const r = el.getBoundingClientRect();
            const pane = document.querySelector('dialog.detail-inspector').getBoundingClientRect();
            const stage = el.closest('.diagram-stage').getBoundingClientRect();
            return r.right <= pane.left && r.left >= stage.left && r.top >= stage.top && r.bottom <= Math.min(stage.bottom, innerHeight);
          });
          const g = await geometry(p);
          const frame = await p.evaluate(() => {
            const r = (s) => document.querySelector(s)?.getBoundingClientRect();
            const main = r('#main');
            const titlebar = r('.titlebar');
            const sidebar = r('#sidebar');
            return { main: main && { x: main.x, right: main.right }, titlebarBottom: titlebar?.bottom ?? 0, sidebarRight: getComputedStyle(document.querySelector('#sidebar')).visibility === 'visible' ? sidebar.right : 0 };
          });
          const row = { appearance, viewport: viewport.name, sidebar: sidebar.name, modal: f.modal, rect: f.rect, stage: [before.stageWidth, after.stageWidth], overflow: g.horizontalOverflow };
          const narrow = viewport.width < 900;
          if (narrow) {
            // A dialog: inside the viewport, right-aligned, focus trapped, the drawer toggle blocked.
            const trapped = [];
            for (let i = 0; i < 6; i += 1) {
              await p.keyboard.press('Tab');
              trapped.push((await inspectorFacts(p)).activeInside);
            }
            await p.keyboard.press('Shift+Tab');
            trapped.push((await inspectorFacts(p)).activeInside);
            const toggle = await p.locator(S.menuButton).boundingBox();
            await p.mouse.click(toggle.x + toggle.width / 2, toggle.y + toggle.height / 2);
            const drawerOpened = await p.locator('#sidebar[data-open="true"]').count();
            const stillOpen = (await inspectorFacts(p)).open;
            row.trapped = trapped;
            row.drawerOpened = drawerOpened;
            c.check(`D14 ${appearance} ${viewport.name}: a modal dialog at the right edge, inside the viewport`, f.modal && f.layout === 'dialog' && f.rect.right <= viewport.width && f.rect.x >= 0 && f.rect.right >= viewport.width - 1 && f.rect.height === viewport.height, row);
            c.check(`D14 ${appearance} ${viewport.name}: Tab and Shift+Tab stay in the dialog; the drawer cannot open under it`, trapped.every(Boolean) && drawerOpened === 0 && stillOpen, row);
            await p.keyboard.press('Escape');
            const ret = await activeElement(p);
            c.check(`D14 ${appearance} ${viewport.name}: Escape closes and returns focus to the transition`, !(await inspectorFacts(p)).open && ret?.label?.startsWith('Details: transition Admission to Refused, Origin'), { ret });
            // The drawer open first: the chart is inert, so nothing opens.
            await p.locator(S.menuButton).click();
            await p.locator('#sidebar[data-open="true"]').waitFor();
            const label = await p.locator(S.detailControl(ORIGIN)).boundingBox();
            if (label) await p.mouse.click(label.x + label.width / 2, label.y + label.height / 2);
            c.check(`D14 ${appearance} ${viewport.name}: with the drawer open, the chart beneath does not open the inspector`, !(await inspectorFacts(p)).open);
            await p.keyboard.press('Escape');
            if (!(await inspectorFacts(p)).open) await p.locator(S.detailControl(ORIGIN)).click({ force: true });
          } else {
            c.check(`D14 ${appearance} ${viewport.name} sidebar ${sidebar.name}: an inset pane below the titlebar, inside the reading pane, clear of the sidebar`, !f.modal && f.layout === 'pane' && f.rect.y >= frame.titlebarBottom && f.rect.right <= frame.main.right && f.rect.x > frame.main.x && f.rect.x > frame.sidebarRight && f.rect.bottom <= viewport.height, { ...row, frame });
            c.check(`D14 ${appearance} ${viewport.name} sidebar ${sidebar.name}: the chart keeps its size and scale; the open transition is in view, clear of the pane`, before.stageWidth === after.stageWidth && before.stageHeight === after.stageHeight && before.scale === after.scale && clear, { ...row, clear });
          }
          c.check(`D14 ${appearance} ${viewport.name} ${sidebar.name}: no horizontal overflow`, g.horizontalOverflow === 0, { overflow: g.horizontalOverflow, elements: g.overflowingElements });
          await p.screenshot({ path: join(SCREENSHOTS, `${engine}-details-${viewport.name}-${sidebar.name}-${appearance}.png`) });
          facts.layouts.push(row);
          pageErrors.push(...errs.page);
          await ctx.close();
        }
      }
    }

    // D15: Health lists the unbound entries; the document counts them as warnings.
    const health = await openPage(browser, { width: 1280, height: 800 });
    await health.page.goto(`${BASE}/settings?tab=health`);
    await health.page.locator(S.healthIssues).first().waitFor();
    const shown = await health.page.locator(S.healthIssues).evaluateAll((items) =>
      items.filter((i) => i.querySelector('.issue-file')?.textContent.endsWith('/gate/README.md')).map((i) => i.getAttribute('data-issue-code')));
    await health.page.screenshot({ path: join(SCREENSHOTS, `${engine}-details-health.png`), fullPage: true });
    await health.page.goto(`${BASE}/docs/gate`);
    await waitForDocument(health.page, 'gate');
    const metaWarnings = await health.page.locator('.meta-warning').innerText();
    keep(health.errors);
    await health.context.close();
    c.check('D15 Settings › Health lists every unbound entry with its code; the page says 10 warnings', shown.filter((code) => code.includes('detail')).length === 10 && metaWarnings.trim() === '10 warnings', { shown, metaWarnings });

    // D16: the real documents (when REAL_URL is set).
    if (REAL) {
      facts.real = {};
      const real = await openPage(browser, { width: 1440, height: 900 });
      // The host component map: each labelled edge opens the section that explains it; sibling edges from Startup do not swap.
      const host = await api(REAL, '/api/documents/host');
      const HK = keysOf(host.diagramDetails);
      await real.page.goto(`${REAL}/docs/host`);
      await waitForDocument(real.page, 'host');
      await waitForDiagrams(real.page);
      facts.real.hostEdges = [];
      for (const [key, title] of [
        ['edge:Startup>Gateway:ready', 'Host dependencies are ready'],
        ['edge:Startup>Surface:ready or refusal', 'Choosing the first screen'],
        ['edge:Gateway>Endpoint:validated identity', 'Checking the gateway identity'],
        ['edge:Startup>Credentials:scoped namespace', 'Choosing the credential store'],
        ['edge:Surface>Windows:show and dismiss', 'Showing and hiding windows'],
      ]) {
        await real.page.locator(S.detailControl(HK[key])).focus();
        await real.page.keyboard.press('Enter');
        const opened = await inspectorFacts(real.page);
        await real.page.keyboard.press('Escape');
        const back = await activeElement(real.page);
        facts.real.hostEdges.push({ key, title: opened.title, kind: opened.kind, back: back?.label ?? null });
        c.check(`D16 host: "${key.split(':').pop()}" opens "${title}" (Edge); Escape returns focus to it`, opened.open && opened.title === title && opened.kind === 'Edge' && back?.label === `Details: edge ${key.slice(5).split(':')[0].replace('>', ' to ')}, ${key.split(':').slice(2).join(':')}`, facts.real.hostEdges.at(-1));
      }
      const hostNodes = await real.page.evaluate(() => [...document.querySelectorAll('figure.diagram[data-diagram-index="0"] .diagram-svg svg g.node')].map((n) => [n.getAttribute('role'), n.querySelectorAll('.diagram-depth-mark, .diagram-depth-inset').length]));
      c.check('D16 host: every node keeps its document link (role link, one +), unchanged by the edge details', hostNodes.length === 6 && hostNodes.every(([role, marks]) => role === 'link' && marks === 1), { hostNodes });
      await real.page.locator(S.detailControl(HK['edge:Startup>Gateway:ready'])).click({ force: true });
      await real.page.screenshot({ path: join(SCREENSHOTS, `${engine}-details-real-host-ready.png`) });
      await real.page.keyboard.press('Escape');

      for (const id of ['host', 'auth-admission', 'auth-credential', APP_CALL]) {
        const doc = await api(REAL, `/api/documents/${id}`);
        await real.page.goto(`${REAL}/docs/${id}`);
        await waitForDocument(real.page, id);
        await waitForDiagrams(real.page);
        const bound = await real.page.evaluate((details) => details.map((d, key) => {
          const el = document.querySelector(`figure.diagram[data-diagram-index="${d.diagram}"] .diagram-svg svg [role="button"][data-detail-key="${key}"]`);
          if (!el) return { key, found: false };
          if (d.target.kind === 'edge') {
            const words = el.querySelector(':scope > .label')?.textContent.replace(/\s+/g, ' ').trim();
            return { key, found: true, matches: words === d.target.label.replace(/\s+/g, ' ').trim(), words, mark: Boolean(el.querySelector(':scope > .diagram-depth-mark')) };
          }
          return { key, found: true, matches: el.matches('g.node') && el.id.includes(`-${d.family === 'flowchart' ? 'flowchart' : 'state'}-${d.target.node}-`), mark: Boolean(el.querySelector(':scope > .diagram-depth-mark, :scope > .diagram-depth-inset')) };
        }), doc.diagramDetails);
        const n = await nodeLinkFacts(real.page);
        facts.real[id] = { published: doc.diagramDetails.length, bound, inert: [n.unlinked, n.unlinkedInert] };
        c.check(`D16 ${id}: every published detail is bound to the element it names (label text = authored label) with a + mark`, doc.diagramDetails.length > 0 && bound.every((b) => b.found && b.matches && b.mark), facts.real[id]);
        c.check(`D16 ${id}: every other node stays inert`, n.unlinkedInert === n.unlinked, { unlinked: n.unlinked, inert: n.unlinkedInert });
      }
      const app = await api(REAL, `/api/documents/${APP_CALL}`);
      const RK = keysOf(app.diagramDetails);
      await real.page.locator(S.detailControl(RK['edge:Admission>Refused:Origin, scope, visibility or bounds rejected'])).click();
      const origin = await inspectorFacts(real.page);
      await real.page.screenshot({ path: join(SCREENSHOTS, `${engine}-details-real-app-call-origin.png`) });
      await real.page.locator(S.detailControl(RK['edge:Admission>Refused:Admission audit unavailable'])).click({ force: true });
      const audit = await inspectorFacts(real.page);
      facts.real.appCall = { origin: { title: origin.title, has: origin.text.slice(0, 160) }, audit: { title: audit.title } };
      c.check('D16 app call: "Origin, scope, visibility or bounds rejected" opens Admission refusal rules (why it is refused)', origin.open && origin.title === 'Admission refusal rules' && /\brefuses?\b/i.test(origin.text), facts.real.appCall);
      c.check('D16 app call: "Admission audit unavailable" (same pair) opens Direct dispatch admission', audit.title === 'Direct dispatch admission', facts.real.appCall);
      await real.page.keyboard.press('Escape');
      for (const [w, h, name] of [[390, 844, 'phone'], [1280, 800, 'laptop']]) {
        await real.page.setViewportSize({ width: w, height: h });
        await real.page.locator(S.detailControl(RK['edge:Admission>Refused:Origin, scope, visibility or bounds rejected'])).scrollIntoViewIfNeeded();
        await real.page.locator(S.detailControl(RK['edge:Admission>Refused:Origin, scope, visibility or bounds rejected'])).click({ force: true });
        await real.page.screenshot({ path: join(SCREENSHOTS, `${engine}-details-real-app-call-${name}.png`) });
        await real.page.keyboard.press('Escape');
      }
      keep(real.errors);
      await real.context.close();

      // D21 (F1): beside the pane, a right-hand element of the real chart is brought into view; the scale is kept.
      facts.reveal = [];
      const RIGHT = [
        ['Dispatch', `node:Dispatch`],
        ['Withheld', `node:Withheld`],
        ['CompletionAudit → Withheld', 'edge:CompletionAudit>Withheld:Completion audit unavailable / effect unconfirmed'],
      ];
      for (const width of [1280, 1440]) {
        for (const sidebar of [{ name: 'w350', width: '350', state: 'shown' }, { name: 'hidden', width: '260', state: 'hidden' }]) {
          const ctx = await browser.newContext({ viewport: { width, height: 860 }, reducedMotion: 'reduce' });
          await ctx.addInitScript(([w, st]) => {
            localStorage.setItem('nessa-state-browser:sidebar-width', w);
            localStorage.setItem('nessa-state-browser:sidebar', st);
          }, [sidebar.width, sidebar.state]);
          const rp = await ctx.newPage();
          await rp.goto(`${REAL}/docs/${APP_CALL}`);
          await waitForDocument(rp, APP_CALL);
          await waitForDiagrams(rp);
          for (const [name, key] of RIGHT) {
            const scale0 = (await chartState(rp)).scale;
            await rp.locator(S.detailControl(RK[key])).focus();
            await rp.keyboard.press('Enter');
            const m = await rp.locator(S.detailControl(RK[key])).evaluate((el) => {
              const r = el.getBoundingClientRect();
              const pane = document.querySelector('dialog.detail-inspector').getBoundingClientRect();
              const stage = el.closest('.diagram-stage').getBoundingClientRect();
              return { el: [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)], paneLeft: Math.round(pane.left), selected: el.hasAttribute('data-selected'), clear: r.right <= pane.left && r.left >= stage.left && r.top >= stage.top && r.bottom <= Math.min(stage.bottom, innerHeight) };
            });
            const scale1 = (await chartState(rp)).scale;
            const row = { width, sidebar: sidebar.name, name, ...m, scale: [scale0, scale1] };
            facts.reveal.push(row);
            c.check(`D21 ${width} sidebar ${sidebar.name}: ${name} is in view, clear of the pane, selected, at the same scale`, m.clear && m.selected && scale0 === scale1, row);
            if (name === 'Dispatch') await rp.screenshot({ path: join(SCREENSHOTS, `${engine}-details-real-reveal-${width}-${sidebar.name}.png`) });
            await rp.keyboard.press('Escape');
          }
          await ctx.close();
        }
      }
    }

    c.check('no page errors or console errors', pageErrors.length === 0, { pageErrors: pageErrors.slice(0, 5) });
  } catch (error) {
    log('details error', error);
    c.check('script ran to completion', false, { error: String(error).slice(0, 400) });
  } finally {
    await browser.close();
  }
  const result = { script: 'details', ok: c.ok, passed: c.list.filter((x) => x.pass).length, total: c.list.length, checks: c.list, facts };
  writeResult(`details-${engine}`, result);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runDetails(process.argv[2] || 'chromium');
  console.log(JSON.stringify({ script: result.script, ok: result.ok, passed: result.passed, total: result.total, failed: result.checks.filter((x) => !x.pass).map((x) => x.name) }, null, 2));
  process.exit(result.ok ? 0 : 1);
}
