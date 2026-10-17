// Docked sidebar resize: the separator in the gutter, pointer drag (exact
// geometry, clamps, Escape, pointercancel, lost capture, non-primary button),
// keyboard (arrows, Home, End), double-click reset, persistence and invalid
// stored values, hide/show and breakpoint changes (also mid-drag), focus, the
// app bar not moving, the diagram SVG never re-inserted, and node clicks; and
// the edge light, measured from screenshot pixels in both appearances: local to
// the pointer, following it (also captured mid-drag, clamped at the ends),
// gone on leave, Escape and pointercancel, centred for keyboard-only focus.
// Rows R1–R16 in CHECKLIST.md ("Sidebar resize: states × events").
//
// Usage: node verification/sidebar-resize.mjs [chromium|webkit]   (BASE_URL, default http://127.0.0.1:4312 — the fixture)

import { join } from 'node:path';
import { activeElement, baseUrl, checks, geometry, loadPlaywright, openPage, SCREENSHOTS, waitForDiagrams, waitForDocument, writeResult } from './lib.mjs';
import { S } from './selectors.mjs';

const KEY = 'nessa-state-browser:sidebar-width';
const GUTTER = 8;

/** Sidebar, separator, reading pane and app bar rects, the separator's ARIA, and what is stored. */
function layout(page) {
  return page.evaluate((key) => {
    const box = (element) => {
      if (!element || element.getClientRects().length === 0) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, width: r.width, height: r.height };
    };
    const resizer = document.querySelector('[role="separator"][data-sidebar-resizer]');
    return {
      viewport: innerWidth,
      sidebar: box(document.querySelector('#sidebar')),
      main: box(document.querySelector('#main')),
      resizer: box(resizer),
      resizers: document.querySelectorAll('[role="separator"][data-sidebar-resizer]').length,
      aria: resizer
        ? {
            now: resizer.getAttribute('aria-valuenow'),
            min: resizer.getAttribute('aria-valuemin'),
            max: resizer.getAttribute('aria-valuemax'),
            text: resizer.getAttribute('aria-valuetext'),
            orientation: resizer.getAttribute('aria-orientation'),
            controls: resizer.getAttribute('aria-controls'),
            label: resizer.getAttribute('aria-label'),
            tabIndex: resizer.tabIndex,
          }
        : null,
      cue: resizer ? getComputedStyle(resizer, '::after').opacity : null,
      glowAt: resizer ? resizer.style.getPropertyValue('--sidebar-glow') : null,
      resizing: document.querySelector('.shell').hasAttribute('data-resizing'),
      stored: localStorage.getItem(key),
      toggle: box(document.querySelector('button[data-sidebar-toggle]')),
      brand: box(document.querySelector('a.brand')),
      chart: box(document.querySelector('figure.diagram')),
      column: box(document.querySelector('article.document')),
    };
  }, KEY);
}

const transparent = (opacity) => opacity === '0';

/**
 * The edge light as it is drawn: a screenshot of the separator's middle 6px
 * column, with and without its ::after, compared row by row. Returns the rows
 * whose strongest channel differs by at least 4/255, their extent and
 * delta-weighted centre in page coordinates, and the strongest delta.
 */
async function light(page) {
  const r = await page.locator(S.resizer).boundingBox();
  const clip = { x: Math.round(r.x) + 3, y: Math.round(r.y), width: 6, height: Math.round(r.height) };
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const on = await page.screenshot({ clip, animations: 'disabled' });
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = '__no-light';
    style.textContent = '.sidebar-resizer::after { display: none !important; }';
    document.head.append(style);
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const off = await page.screenshot({ clip, animations: 'disabled' });
  await page.evaluate(() => document.getElementById('__no-light').remove());
  const rows = await page.evaluate(async ([a, b]) => {
    const pixels = async (base64) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [x, y] = [await pixels(a), await pixels(b)];
    const out = [];
    for (let row = 0; row < x.height; row++) {
      let max = 0;
      for (let i = row * x.width * 4; i < (row + 1) * x.width * 4; i += 4) {
        for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(x.data[i + k] - y.data[i + k]));
      }
      out.push(max);
    }
    return out;
  }, [on.toString('base64'), off.toString('base64')]);
  const lit = rows.map((delta, row) => ({ delta, row })).filter((x) => x.delta >= 4);
  const weight = lit.reduce((sum, x) => sum + x.delta, 0);
  return {
    top: clip.y,
    height: clip.height,
    rows: lit.length,
    first: lit.length ? clip.y + lit[0].row : null,
    last: lit.length ? clip.y + lit.at(-1).row : null,
    centre: weight ? clip.y + lit.reduce((sum, x) => sum + x.row * x.delta, 0) / weight + 0.5 : null,
    peak: Math.max(0, ...rows),
  };
}

/** Lit, local (at most 200 of the separator's rows), and centred on `y` within 4px. */
const localAt = (l, y) => l.rows >= 20 && l.rows <= 200 && Math.abs(l.centre - y) <= 4;

export async function runSidebarResize(engine) {
  const BASE_URL = baseUrl();
  const playwright = loadPlaywright();
  const browser = await playwright[engine].launch();
  const c = checks();
  const measurements = {};
  const allErrors = { console: [], page: [] };
  const keep = (errors) => {
    allErrors.console.push(...errors.console);
    allErrors.page.push(...errors.page);
  };

  try {
    for (const viewport of [{ name: 'laptop', width: 1280, height: 800 }, { name: 'desktop', width: 1440, height: 900 }]) {
      const where = viewport.name;
      const { page, errors, context } = await openPage(browser, { width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}/docs/nessa`);
      await waitForDocument(page, 'nessa');
      await waitForDiagrams(page);
      const width = async () => (await layout(page)).sidebar.width;
      // The pane fills the rest of the window; the app bar never moves.
      const start = await layout(page);
      measurements[where] = { start };
      const settled = (m, w) =>
        Math.abs(m.sidebar.width - w) <= 0.5 &&
        Math.abs(m.main.x - (m.sidebar.right + GUTTER)) <= 0.5 &&
        Math.abs(m.main.right - (m.viewport - GUTTER)) <= 0.5 &&
        Math.abs(m.toggle.x - start.toggle.x) <= 0.5 &&
        Math.abs(m.brand.x - start.brand.x) <= 0.5 &&
        Math.abs(m.toggle.y - start.toggle.y) <= 0.5;

      // Default and placement (R11 with nothing stored).
      c.check(`${where}: default 260px, nothing stored`, start.sidebar.width === 260 && start.stored === null, { sidebar: start.sidebar, stored: start.stored });
      c.check(`${where}: separator is a 12px target centred on the gutter, full pane height`, start.resizer && Math.abs(start.resizer.x + 6 - (start.sidebar.right + GUTTER / 2)) <= 0.5 && start.resizer.width === 12 && Math.abs(start.resizer.height - start.sidebar.height) <= 0.5, { resizer: start.resizer, sidebar: start.sidebar });
      c.check(`${where}: separator semantics`, start.aria.now === '260' && start.aria.min === '220' && start.aria.max === '350' && start.aria.text === '260 pixels' && start.aria.orientation === 'vertical' && start.aria.controls === 'sidebar' && start.aria.label === 'Resize sidebar' && start.aria.tabIndex === 0, start.aria);
      c.check(`${where}: panes keep their width (the target overlaps the gutter, not the panes' layout)`, settled(start, 260), start);
      const centre = { x: start.resizer.x + 6, y: start.resizer.y + start.resizer.height / 2 };
      await page.mouse.move(centre.x, centre.y);
      await page.waitForTimeout(200);
      const hovered = await layout(page);
      c.check(`${where}: hover shows the edge light (hidden at rest)`, transparent(start.cue) && !transparent(hovered.cue), { rest: start.cue, hover: hovered.cue });

      // R1, R3, R4, R13: drag follows the pointer exactly, clamps, comes back, commits once.
      await page.evaluate(() => {
        window.__svg = document.querySelector('figure.diagram .diagram-svg svg');
        window.__svgMutations = 0;
        window.__svgObserver = new MutationObserver((records) => {
          window.__svgMutations += records.filter((r) => [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeName.toLowerCase() === 'svg')).length;
        });
        document.querySelectorAll('figure.diagram .diagram-svg').forEach((host) => window.__svgObserver.observe(host, { childList: true }));
      });
      const path = new URL(page.url()).pathname;
      await page.mouse.down();
      const trail = [];
      for (const dx of [20, 50, -30, -200, 300, 10, 40]) {
        await page.mouse.move(centre.x + dx, centre.y, { steps: 3 });
        const m = await layout(page);
        trail.push({ dx, width: m.sidebar.width, now: m.aria.now, mainX: m.main.x, resizing: m.resizing, stored: m.stored });
      }
      const expected = (dx) => Math.min(350, Math.max(220, 260 + dx));
      c.check(`${where}: drag: width = clamp(260 + Δx) at every step (±1px), ARIA follows`, trail.every((t) => Math.abs(t.width - expected(t.dx)) <= 1 && t.now === String(expected(t.dx))), { trail });
      c.check(`${where}: drag: pane follows (main.x = sidebar.right + 8), shell marked resizing, nothing stored yet`, trail.every((t) => t.resizing && t.stored === null && Math.abs(t.mainX - (t.width + 2 * GUTTER)) <= 1), { trail });
      await page.mouse.up();
      const committed = await layout(page);
      c.check(`${where}: release commits 300 and stores it once`, committed.sidebar.width === 300 && committed.stored === '300' && !committed.resizing && settled(committed, 300), { width: committed.sidebar.width, stored: committed.stored });
      const svgFacts = await page.evaluate(() => ({ mutations: window.__svgMutations, same: window.__svg === document.querySelector('figure.diagram .diagram-svg svg') }));
      c.check(`${where}: the diagram SVG was never re-inserted and nothing navigated`, svgFacts.mutations === 0 && svgFacts.same && new URL(page.url()).pathname === path, svgFacts);
      c.check(`${where}: chart spans the column after the drag, no horizontal overflow`, committed.chart.width >= committed.column.width - 2 && (await geometry(page)).horizontalOverflow === 0, { chart: committed.chart, column: committed.column });

      // R6: Escape mid-drag discards; the release that follows changes nothing.
      const c2 = { x: committed.resizer.x + 6, y: centre.y };
      await page.mouse.move(c2.x, c2.y);
      await page.mouse.down();
      await page.mouse.move(c2.x + 40, c2.y, { steps: 3 });
      const during = await width();
      await page.keyboard.press('Escape');
      const escaped = await layout(page);
      await page.mouse.move(c2.x + 60, c2.y, { steps: 2 });
      await page.mouse.up();
      const afterEscape = await layout(page);
      c.check(`${where}: Escape mid-drag restores 300; later moves and the release change nothing (R6)`, during === 340 && escaped.sidebar.width === 300 && !escaped.resizing && afterEscape.sidebar.width === 300 && afterEscape.stored === '300', { during, escaped: escaped.sidebar.width, after: afterEscape.sidebar.width });

      // R5: pointercancel and a lost capture without a release discard the preview.
      await page.evaluate(() => {
        const el = document.querySelector('[data-sidebar-resizer]');
        el.addEventListener('pointerdown', (event) => (window.__pointerId = event.pointerId), { capture: true });
      });
      for (const kind of ['pointercancel', 'lostpointercapture']) {
        await page.mouse.move(c2.x, c2.y);
        await page.mouse.down();
        await page.mouse.move(c2.x - 50, c2.y, { steps: 3 });
        const mid = await width();
        await page.evaluate((k) => {
          const el = document.querySelector('[data-sidebar-resizer]');
          if (k === 'pointercancel') el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__pointerId, bubbles: true }));
          else el.releasePointerCapture(window.__pointerId);
        }, kind);
        // A released capture is reported at the next pointer event (Pointer Events "process pending capture").
        await page.mouse.move(c2.x - 51, c2.y);
        const cancelled = await layout(page);
        await page.mouse.move(c2.x - 80, c2.y, { steps: 2 });
        await page.mouse.up();
        const after = await layout(page);
        c.check(`${where}: ${kind} mid-drag restores 300, stores nothing, later moves are ignored (R5)`, mid === 250 && cancelled.sidebar.width === 300 && !cancelled.resizing && after.sidebar.width === 300 && after.stored === '300', { mid, cancelled: cancelled.sidebar.width, after: after.sidebar.width });
      }

      // R2: a right-button press is not a drag.
      await page.mouse.move(c2.x, c2.y);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(c2.x + 40, c2.y, { steps: 3 });
      await page.mouse.up({ button: 'right' });
      c.check(`${where}: right-button press and move does nothing (R2)`, (await width()) === 300 && !(await layout(page)).resizing);

      // R7, R8: keyboard. Focus the separator by Tab from the sidebar's last control.
      await page.locator('.language-switch').focus();
      await page.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
      const focused = await page.evaluate(() => document.activeElement?.hasAttribute('data-sidebar-resizer'));
      c.check(`${where}: Tab from the sidebar footer reaches the separator`, focused);
      await page.waitForTimeout(150);
      const focusCue = await layout(page);
      c.check(`${where}: keyboard focus shows the edge light`, !transparent(focusCue.cue), { cue: focusCue.cue });
      const steps = [];
      for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'End', 'ArrowRight', 'Home', 'ArrowLeft', 'ArrowRight']) {
        await page.keyboard.press(key);
        const m = await layout(page);
        steps.push({ key, width: m.sidebar.width, now: m.aria.now, text: m.aria.text, stored: m.stored, ok: settled(m, m.sidebar.width) });
      }
      const wanted = [310, 320, 310, 350, 350, 220, 220, 230];
      c.check(`${where}: arrows ±10, End 350, Home 220, clamped at both ends; ARIA, storage and layout follow`, steps.every((s, i) => s.width === wanted[i] && s.now === String(wanted[i]) && s.text === `${wanted[i]} pixels` && s.stored === String(wanted[i]) && s.ok), { steps });
      c.check(`${where}: focus stays on the separator`, await page.evaluate(() => document.activeElement?.hasAttribute('data-sidebar-resizer')));
      await page.screenshot({ path: join(SCREENSHOTS, `${engine}-sidebar-resize-${where}-230.png`) });

      // R9: double-click resets.
      await page.locator(S.resizer).dblclick();
      const reset = await layout(page);
      c.check(`${where}: double-click resets to 260 and stores it (R9)`, reset.sidebar.width === 260 && reset.stored === '260' && settled(reset, 260));

      // Persistence across reload.
      await page.locator(S.resizer).focus();
      await page.keyboard.press('End');
      await page.reload();
      await waitForDocument(page, 'nessa');
      await waitForDiagrams(page);
      const reloaded = await layout(page);
      c.check(`${where}: 350 survives a reload`, reloaded.sidebar.width === 350 && reloaded.aria.now === '350' && settled(reloaded, 350), { width: reloaded.sidebar.width });
      await page.screenshot({ path: join(SCREENSHOTS, `${engine}-sidebar-resize-${where}-350.png`) });

      // R10: hidden sidebar has no separator; showing keeps the width.
      await page.locator(S.menuButton).focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#sidebar')).visibility === 'hidden');
      const hidden = await layout(page);
      c.check(`${where}: hidden: no separator, toggle keeps focus and place (R10)`, hidden.resizers === 0 && (await activeElement(page))?.sidebarToggle && Math.abs(hidden.toggle.x - start.toggle.x) <= 0.5, { resizers: hidden.resizers });
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#sidebar')).visibility === 'visible');
      const shown = await layout(page);
      c.check(`${where}: shown again at 350 with its separator`, shown.resizers === 1 && settled(shown, 350), { width: shown.sidebar.width });

      // R10: narrow window — no separator, the drawer keeps its own width; wide again keeps 350.
      await page.setViewportSize({ width: 820, height: viewport.height });
      await page.waitForFunction(() => !document.querySelector('[data-sidebar-resizer]'));
      await page.locator(S.menuButton).click();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#sidebar')).visibility === 'visible');
      const drawer = await layout(page);
      c.check(`${where}: narrow: no separator; the open drawer keeps its 320px width`, drawer.resizers === 0 && Math.abs(drawer.sidebar.width - 320) <= 0.5, { drawer: drawer.sidebar });
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForFunction(() => document.querySelector('[data-sidebar-resizer]'));
      const wide = await layout(page);
      c.check(`${where}: wide again: 350 and the separator`, settled(wide, 350) && wide.resizers === 1, { width: wide.sidebar.width });

      // R10 mid-drag: narrowing during a drag discards the preview.
      const c3 = { x: wide.resizer.x + 6, y: centre.y };
      await page.mouse.move(c3.x, c3.y);
      await page.mouse.down();
      await page.mouse.move(c3.x - 60, c3.y, { steps: 3 });
      const midDrag = await width();
      await page.setViewportSize({ width: 820, height: viewport.height });
      await page.waitForFunction(() => !document.querySelector('[data-sidebar-resizer]'));
      await page.mouse.up();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForFunction(() => document.querySelector('[data-sidebar-resizer]'));
      const afterBreakpoint = await layout(page);
      c.check(`${where}: narrowing mid-drag discards the preview: wide again at 350, not resizing, stored 350`, midDrag === 290 && settled(afterBreakpoint, 350) && !afterBreakpoint.resizing && afterBreakpoint.stored === '350', { midDrag, width: afterBreakpoint.sidebar.width, stored: afterBreakpoint.stored });

      // Node clicks: a drag released over a linked node does not open it; a click on it does.
      const node = page.locator(S.diagramNode('chat')).first();
      const nb = await node.boundingBox();
      await page.mouse.move(afterBreakpoint.resizer.x + 6, centre.y);
      await page.mouse.down();
      await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const releasedOver = await layout(page);
      c.check(`${where}: a drag released over a linked node does not navigate (capture)`, new URL(page.url()).pathname === '/docs/nessa' && releasedOver.sidebar.width === 350, { path: new URL(page.url()).pathname });
      const nb2 = await node.boundingBox();
      await page.mouse.click(nb2.x + nb2.width / 2, nb2.y + nb2.height / 2);
      await waitForDocument(page, 'chat');
      c.check(`${where}: after resizing, a linked node click still opens its document`, new URL(page.url()).pathname === '/docs/chat');
      measurements[where].end = await layout(page);
      keep(errors);
      await context.close();
    }

    // R15, R16: the edge light, in both appearances. Pixels, not computed style: a full-height
    // line would light every row of the separator; this light is a short span at the pointer.
    for (const appearance of ['dark', 'light']) {
      const { page, errors, context } = await openPage(browser, { width: 1280, height: 800 });
      await context.addInitScript((value) => localStorage.setItem('nessa-state-browser:appearance', value), appearance);
      await page.goto(`${BASE_URL}/docs/nessa`);
      await waitForDocument(page, 'nessa');
      await waitForDiagrams(page);
      const at = `glow ${appearance}`;
      const settle = () => page.waitForTimeout(200);
      const start = await layout(page);
      const r = start.resizer;
      const x = r.x + 6;
      const strip = { top: r.y + 14, bottom: r.y + r.height - 14 };
      const facts = { appearance, resizer: r };
      measurements[at] = facts;
      await page.mouse.move(640, 400);
      await settle();
      facts.rest = await light(page);
      c.check(`${at}: at rest nothing is lit`, facts.rest.rows === 0, facts.rest);

      // Hover follows the pointer along the edge, and only there.
      const y1 = r.y + 150;
      const y2 = r.y + 520;
      await page.mouse.move(x, y1);
      await settle();
      facts.hover1 = await light(page);
      await page.screenshot({ path: join(SCREENSHOTS, `${engine}-sidebar-glow-${appearance}-hover.png`), clip: { x: x - 80, y: y1 - 140, width: 160, height: 280 } });
      await page.mouse.move(x - 4, y2, { steps: 4 });
      await settle();
      facts.hover2 = await light(page);
      const hovered = await layout(page);
      c.check(`${at}: hover lights a local span centred on the pointer (R15)`, localAt(facts.hover1, y1) && facts.hover1.rows < r.height / 3, facts.hover1);
      c.check(`${at}: moving along the edge moves the light with the pointer (R15)`, localAt(facts.hover2, y2) && facts.hover2.first > y1 + 60, facts.hover2);
      c.check(`${at}: the light is visible (peak ≥ 24/255 against the gutter)`, facts.hover1.peak >= 24, { peak: facts.hover1.peak });
      c.check(`${at}: lighting the edge moves nothing (no layout shift)`, ['sidebar', 'main', 'resizer'].every((k) => JSON.stringify(hovered[k]) === JSON.stringify(start[k])), { start, hovered });

      // At an end of the hit region the light stays in the strip between the panes' corners.
      await page.mouse.move(x, r.y + 2);
      await settle();
      facts.top = await light(page);
      c.check(`${at}: at the top of the target the light is held below the corner (clamped)`, facts.top.rows > 0 && facts.top.first >= strip.top - 0.5 && facts.top.last <= strip.top + 110, facts.top);

      // Idle leave hides it and forgets the height.
      await page.mouse.move(r.x - 120, y1);
      await settle();
      facts.left = { light: await light(page), glowAt: (await layout(page)).glowAt };
      c.check(`${at}: leaving while idle hides the light and forgets the pointer (R16)`, facts.left.light.rows === 0 && facts.left.glowAt === '', facts.left);

      // Captured drag: the light follows the pointer's height at the moving edge, still local.
      await page.mouse.move(x, y1);
      await page.mouse.down();
      await page.mouse.move(x + 40, y2, { steps: 5 });
      await settle();
      facts.drag = await light(page);
      facts.dragAt = (await layout(page)).resizer;
      await page.screenshot({ path: join(SCREENSHOTS, `${engine}-sidebar-glow-${appearance}-drag.png`), clip: { x: x + 40 - 80, y: y2 - 140, width: 160, height: 280 } });
      c.check(`${at}: mid-drag the light is local, at the pointer, on the moved edge — never the full divider (R15)`, localAt(facts.drag, y2) && Math.abs(facts.dragAt.x - (r.x + 40)) <= 1, { light: facts.drag, resizer: facts.dragAt });
      await page.mouse.move(x + 40, 799, { steps: 3 });
      await settle();
      facts.dragPast = await light(page);
      c.check(`${at}: a captured pointer past the end clamps the light to the strip's end`, facts.dragPast.rows > 0 && facts.dragPast.rows <= 200 && facts.dragPast.last <= strip.bottom + 0.5 && facts.dragPast.first >= strip.bottom - 110, facts.dragPast);
      // Escape with the pointer still held and not moved: measured once the fade settles, before any pointer event
      // (WebKit sends no pointerleave and keeps :hover until the pointer next moves). Escape is a key
      // press on the still-focused separator: WebKit then matches :focus-visible and lights the
      // middle, Chromium does not. Either way, never the height the drag ended at (R16).
      const middle = r.y + r.height / 2;
      const forgotten = (f) => f.glowAt === '' && (f.light.rows === 0 || localAt(f.light, middle));
      const now = async () => {
        const m = await layout(page);
        const focus = await page.locator(S.resizer).evaluate((el) => ({ hovered: el.matches(':hover'), focusVisible: el.matches(':focus-visible'), focused: document.activeElement === el }));
        return { light: await light(page), glowAt: m.glowAt, width: m.sidebar.width, resizing: m.resizing, ...focus };
      };
      await page.mouse.move(x + 40, y2, { steps: 3 });
      await page.keyboard.press('Escape');
      await settle(); // the 120ms opacity fade, with no pointer event
      facts.escaped = await now();
      c.check(`${at}: Escape mid-drag, pointer held, no move: edge back at 260, the drag's height forgotten at once — nothing lit, or the keyboard-focus light at the middle`, facts.escaped.width === 260 && !facts.escaped.resizing && forgotten(facts.escaped), { ...facts.escaped, middle, dragHeight: y2 });
      await page.waitForTimeout(1000);
      facts.escapedLater = await now();
      c.check(`${at}: …and still so a second later, pointer still held`, facts.escapedLater.width === 260 && forgotten(facts.escapedLater), facts.escapedLater);
      await page.keyboard.press('ArrowRight');
      await settle();
      facts.escapedKey = await now();
      c.check(`${at}: …then ArrowRight with the pointer still held: 270, the light no nearer the drag's height`, facts.escapedKey.width === 270 && forgotten(facts.escapedKey), facts.escapedKey);
      await page.keyboard.press('ArrowLeft');
      await page.mouse.up();
      await page.mouse.move(r.x - 120, y2, { steps: 2 });
      await settle();
      facts.escapedAway = await now();
      c.check(`${at}: …released and away: 260, nothing remembered`, facts.escapedAway.width === 260 && forgotten(facts.escapedAway), facts.escapedAway);
      await page.evaluate(() => document.activeElement?.blur());

      // A plain drag, released, then away: a press is not keyboard focus, so nothing stays lit.
      await page.mouse.move(x, y1);
      await page.mouse.down();
      await page.mouse.move(x + 20, y2, { steps: 4 });
      await page.mouse.up();
      await page.mouse.move(r.x - 120, y2, { steps: 3 });
      await settle();
      facts.released = { light: await light(page), glowAt: (await layout(page)).glowAt, width: (await layout(page)).sidebar.width, focused: await page.evaluate(() => document.activeElement?.hasAttribute('data-sidebar-resizer')) };
      c.check(`${at}: drag released, then away: committed 280, separator focused, nothing lit, nothing remembered (R16)`, facts.released.width === 280 && facts.released.focused && facts.released.light.rows === 0 && facts.released.glowAt === '', facts.released);
      await page.locator(S.resizer).dblclick();
      await page.mouse.move(r.x - 120, y2, { steps: 3 });
      await page.evaluate(() => document.activeElement?.blur());

      await page.evaluate(() => {
        document.querySelector('[data-sidebar-resizer]').addEventListener('pointerdown', (event) => (window.__pointerId = event.pointerId), { capture: true });
      });
      await page.mouse.move(x, y1);
      await page.mouse.down();
      await page.mouse.move(x - 30, y2, { steps: 4 });
      await page.evaluate(() => document.querySelector('[data-sidebar-resizer]').dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__pointerId, bubbles: true })));
      await settle();
      facts.cancelledAtOnce = await now();
      // A browser's own pointercancel is followed by pointerout/pointerleave; this dispatched one is not,
      // and WebKit keeps :hover on the edge until the pointer moves, so it may light the middle.
      c.check(`${at}: pointercancel mid-drag, pointer held, no move: 260, the drag's height forgotten — nothing lit, or the middle`, facts.cancelledAtOnce.width === 260 && !facts.cancelledAtOnce.resizing && forgotten(facts.cancelledAtOnce), facts.cancelledAtOnce);
      await page.mouse.move(x - 31, y2);
      await page.mouse.up();
      await page.mouse.move(r.x - 120, y2, { steps: 3 });
      await settle();
      facts.cancelled = { light: await light(page), glowAt: (await layout(page)).glowAt, width: (await layout(page)).sidebar.width };
      c.check(`${at}: pointercancel mid-drag (focused by the press only), then away: width 260, nothing lit, nothing remembered`, facts.cancelled.width === 260 && facts.cancelled.light.rows === 0 && facts.cancelled.glowAt === '', facts.cancelled);

      // Lost capture: reported at the next pointer event, so measured after the one move that
      // delivers it, with the pointer still held and off the snapped-back edge.
      await page.mouse.move(x, y1);
      await page.mouse.down();
      await page.mouse.move(x - 30, y2, { steps: 4 });
      await page.evaluate(() => document.querySelector('[data-sidebar-resizer]').releasePointerCapture(window.__pointerId));
      await page.mouse.move(x - 31, y2);
      await settle();
      facts.lostAtOnce = await now();
      c.check(`${at}: lost capture mid-drag, pointer held: 260, nothing lit, nothing remembered`, facts.lostAtOnce.width === 260 && !facts.lostAtOnce.resizing && facts.lostAtOnce.light.rows === 0 && facts.lostAtOnce.glowAt === '', facts.lostAtOnce);
      await page.mouse.up();
      await page.mouse.move(r.x - 120, y2, { steps: 3 });

      // Keyboard only, after the pointer has been near the top: the light is at the middle.
      await page.mouse.move(x, r.y + 60);
      await page.mouse.move(640, 400, { steps: 3 });
      await page.evaluate(() => document.activeElement?.blur());
      await page.locator('.language-switch').focus();
      await page.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
      await settle();
      facts.focus = await light(page);
      c.check(`${at}: keyboard-only focus lights a local span at the edge's middle, not the last pointer height (R16)`, localAt(facts.focus, middle), { light: facts.focus, middle });
      await page.keyboard.press('ArrowRight');
      await settle();
      const moved = await layout(page);
      facts.focusMoved = await light(page);
      await page.screenshot({ path: join(SCREENSHOTS, `${engine}-sidebar-glow-${appearance}-focus.png`), clip: { x: moved.resizer.x + 6 - 80, y: middle - 140, width: 160, height: 280 } });
      c.check(`${at}: an arrow key moves the edge and its light stays centred on it`, moved.sidebar.width === 270 && localAt(facts.focusMoved, middle), { width: moved.sidebar.width, light: facts.focusMoved });
      await page.locator(S.settingsLink).focus();
      await settle();
      facts.blurred = await light(page);
      c.check(`${at}: focus leaving the separator hides the light`, facts.blurred.rows === 0, facts.blurred);
      keep(errors);
      await context.close();
    }

    // R1 with motion allowed: the grid's 240ms easing is off while dragging, so the pane is at
    // the pointer on the next frame (the other contexts use reduced motion, which hides this).
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/docs/nessa`);
      await waitForDocument(page, 'nessa');
      const r = await page.locator(S.resizer).boundingBox();
      await page.mouse.move(r.x + 6, r.y + 300);
      await page.mouse.down();
      await page.mouse.move(r.x + 6 + 80, r.y + 300);
      const lag = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(document.querySelector('#sidebar').getBoundingClientRect().width))));
      await page.mouse.up();
      c.check('motion allowed: one frame after the move the sidebar is at the pointer (no easing behind a drag)', Math.abs(lag - 340) <= 1, { width: lag });
      await context.close();
    }

    // R11, R12: invalid stored values.
    for (const [stored, expected] of [['abc', 260], ['300.5', 260], ['-5', 260], ['999', 350], ['100', 220], ['333', 333]]) {
      const { page, errors, context } = await openPage(browser, { width: 1280, height: 800 });
      await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [KEY, stored]);
      await page.goto(`${BASE_URL}/docs/nessa`);
      await waitForDocument(page, 'nessa');
      const m = await layout(page);
      c.check(`stored "${stored}" → ${expected}px (R11/R12)`, m.sidebar.width === expected && m.aria.now === String(expected), { width: m.sidebar.width });
      keep(errors);
      await context.close();
    }

    // R14: storage denied — the width still applies for this page.
    {
      const { page, errors, context } = await openPage(browser, { width: 1280, height: 800 });
      await context.addInitScript((key) => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (name === key) throw new DOMException('denied', 'QuotaExceededError');
          return setItem.call(this, name, value);
        };
      }, KEY);
      await page.goto(`${BASE_URL}/docs/nessa`);
      await waitForDocument(page, 'nessa');
      await page.locator(S.resizer).focus();
      await page.keyboard.press('End');
      const m = await layout(page);
      c.check('storage denied: End still widens to 350, nothing thrown (R14)', m.sidebar.width === 350 && errors.page.length === 0, { width: m.sidebar.width, pageErrors: errors.page });
      keep(errors);
      await context.close();
    }
    c.check('sidebar-resize: no console errors', allErrors.console.length === 0, { console: allErrors.console });
    c.check('sidebar-resize: no page errors', allErrors.page.length === 0, { page: allErrors.page });
  } catch (error) {
    c.check('sidebar-resize completed without exception', false, { error: String(error) });
  } finally {
    await browser.close();
  }
  const result = { engine, script: 'sidebar-resize', baseUrl: BASE_URL, ok: c.ok, passed: c.list.filter((x) => x.pass).length, total: c.list.length, checks: c.list, measurements };
  writeResult(`sidebar-resize-${engine}`, result);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runSidebarResize(process.argv[2] || 'chromium');
  console.log(JSON.stringify({ engine: result.engine, script: result.script, ok: result.ok, passed: result.passed, total: result.total, failed: result.checks.filter((x) => !x.pass).map((x) => x.name) }));
  process.exit(result.ok ? 0 : 1);
}
