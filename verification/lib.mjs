// Shared helpers for the browser verification scripts: launching engines,
// collecting console/page errors, measuring geometry, and reporting.
// Data goes to stdout as JSON; diagnostics go to stderr.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const RESULTS = join(HERE, 'results');
export const SCREENSHOTS = join(RESULTS, 'screenshots');
const require = createRequire(import.meta.url);

export function loadPlaywright() {
  return require(process.env.PLAYWRIGHT_PATH || 'playwright');
}

/** Read per run, so run-all can point successive scripts at different servers. */
export function baseUrl(fallback = 'http://127.0.0.1:4312') {
  return (process.env.BASE_URL || fallback).replace(/\/$/, '');
}

export function log(...parts) {
  console.error('[verify]', ...parts);
}

/** Opens a page that records console errors, page errors, and failed requests. */
export async function openPage(browser, viewport) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = { console: [], page: [], requests: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push({ text: message.text(), url: page.url() });
  });
  page.on('pageerror', (error) => errors.page.push({ text: String(error), url: page.url() }));
  page.on('requestfailed', (request) => {
    errors.requests.push({ url: request.url(), failure: request.failure()?.errorText ?? 'failed' });
  });
  return { context, page, errors };
}

export async function waitForDocument(page, id) {
  await page.waitForSelector(`.document-layout[data-doc-id="${id}"]`, { timeout: 10000 });
}

export async function waitForDiagrams(page) {
  await page.waitForFunction(
    () => [...document.querySelectorAll('figure.diagram')].every((figure) => figure.dataset.state !== 'rendering'),
    null,
    { timeout: 15000 },
  );
}

/** Horizontal overflow of the viewport and of each top-level region. */
export async function geometry(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
        visible: style.visibility !== 'hidden' && style.display !== 'none' && r.width > 0,
      };
    };
    const overflowing = [...document.querySelectorAll('#main *')]
      .filter((element) => {
        const r = element.getBoundingClientRect();
        if (r.width === 0) return false;
        // Elements inside a horizontal scroller are allowed to be wider.
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const overflowX = getComputedStyle(parent).overflowX;
          if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') {
            const p = parent.getBoundingClientRect();
            if (parent.id !== 'main' && p.right <= window.innerWidth + 1) return false;
          }
        }
        return r.right > window.innerWidth + 1;
      })
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      horizontalOverflow: root.scrollWidth - root.clientWidth,
      overflowingElements: overflowing,
      sidebar: rect('#sidebar'),
      main: rect('#main'),
      outline: rect('[role="navigation"][aria-label="On this page"]'),
      document: rect('article.document'),
      firstDiagram: rect('figure.diagram'),
      menuButton: rect('button[data-sidebar-toggle]'),
    };
  });
}

export async function svgFacts(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('figure.diagram')].map((figure) => {
      const svg = figure.querySelector('.diagram-svg svg');
      const r = svg?.getBoundingClientRect();
      return {
        state: figure.dataset.state,
        svgElements: svg ? svg.querySelectorAll('*').length : 0,
        width: r ? Math.round(r.width) : 0,
        height: r ? Math.round(r.height) : 0,
        linkedNodes: svg ? svg.querySelectorAll('[data-target-id]').length : 0,
        hasImgFallback: Boolean(figure.querySelector('img')),
      };
    }),
  );
}

export async function activeElement(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return null;
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      label: element.getAttribute('aria-label'),
      text: (element.textContent || '').trim().slice(0, 60),
      targetId: element.getAttribute('data-target-id'),
      action: element.getAttribute('data-action'),
      sidebarToggle: element.hasAttribute('data-sidebar-toggle'),
      insideSidebar: Boolean(element.closest('#sidebar')),
    };
  });
}

export function writeResult(name, value) {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

/** Collects named checks; `ok` is false if any check failed. */
export function checks() {
  const list = [];
  return {
    list,
    check(name, pass, detail = {}) {
      list.push({ name, pass: Boolean(pass), ...detail });
      if (!pass) log('FAIL', name, JSON.stringify(detail));
      return Boolean(pass);
    },
    get ok() {
      return list.every((entry) => entry.pass);
    },
  };
}

/** WCAG contrast of an element's text colour against the first opaque background behind it. */
export async function contrastOf(page, selector) {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = (color) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    // Composite background layers from the root up to the element.
    const chain = [];
    for (let node = element; node; node = node.parentElement) chain.unshift(node);
    let bg = [255, 255, 255];
    for (const node of [document.documentElement, ...chain]) {
      const [r, g, b, a] = rgba(getComputedStyle(node).backgroundColor);
      if (a > 0) bg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
    }
    const [fr, fg, fb, fa] = rgba(getComputedStyle(element).color);
    const fgc = [fr * fa + bg[0] * (1 - fa), fg * fa + bg[1] * (1 - fa), fb * fa + bg[2] * (1 - fa)];
    const lum = ([r, g, b]) => {
      const c = [r, g, b].map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const [l1, l2] = [lum(fgc), lum(bg)].sort((a, b) => b - a);
    return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
  }, selector);
}

/** Where the first diagram sits in the viewport on arrival, and how much of it is visible. */
export async function firstDiagramPlacement(page) {
  return page.evaluate(() => {
    const figure = document.querySelector('figure.diagram');
    const stage = figure?.querySelector('.diagram-stage');
    const column = document.querySelector('article.document');
    if (!figure || !column) return null;
    const f = figure.getBoundingClientRect();
    const s = (stage ?? figure).getBoundingClientRect();
    const c = column.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      figureTop: Math.round(f.top),
      stageTop: Math.round(s.top),
      width: Math.round(f.width),
      columnWidth: Math.round(c.width),
      visibleHeight: Math.round(Math.min(s.bottom, innerHeight) - Math.max(s.top, 0)),
      stageHeight: Math.round(s.height),
      scale: figure.querySelector('[data-testid="diagram-scale"]')?.textContent ?? null,
    };
  });
}

/** The "Sources and provenance" footer: open state, and whether it sits after everything else on the page. */
export async function provenanceFacts(page) {
  return page.evaluate(() => {
    const footer = document.querySelector('article.document details.provenance');
    if (!footer) return { exists: false };
    const article = footer.parentElement;
    const before = [...article.children].filter((el) => el !== footer && el.getBoundingClientRect().height > 0);
    const contentBottom = Math.max(...before.map((el) => el.getBoundingClientRect().bottom));
    const figure = document.querySelector('figure.diagram');
    return {
      exists: true,
      open: footer.open,
      isLastChild: article.lastElementChild === footer,
      top: Math.round(footer.getBoundingClientRect().top),
      contentBottom: Math.round(contentBottom),
      summary: footer.querySelector('summary')?.textContent.trim() ?? '',
      sourceItems: footer.querySelectorAll('.source-list li').length,
      bodyVisible: (() => {
        const body = footer.querySelector('.provenance-body');
        if (!body) return false;
        return typeof body.checkVisibility === 'function' ? body.checkVisibility() : body.offsetHeight > 0;
      })(),
      text: footer.open ? footer.querySelector('.provenance-body').innerText : '',
      firstFigureTop: figure ? Math.round(figure.getBoundingClientRect().top) : null,
      // Position in the document (independent of the pane's scroll).
      firstFigureDocTop: figure ? Math.round(figure.getBoundingClientRect().top + (document.getElementById('main')?.scrollTop ?? 0) + window.scrollY) : null,
    };
  });
}

/**
 * Interactive (diagramLinks or diagramDetails) vs inert nodes in every rendered diagram: roles, + marks, at-rest colours, and mark/label collisions.
 * `figures` narrows the nodes and marks to the matching figures (default: every diagram on the page).
 */
export async function nodeLinkFacts(page, figures = 'figure.diagram') {
  return page.evaluate((figures) => {
    const shapeOf = (node) => node.querySelector(':scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, :scope > path, :scope > .label-container');
    const style = (node) => {
      const shape = shapeOf(node);
      if (!shape) return null;
      const cs = getComputedStyle(shape);
      return { fill: cs.fill, stroke: cs.stroke };
    };
    const svgs = [...document.querySelectorAll(`${figures} .diagram-svg svg`)];
    const nodes = svgs.flatMap((svg) => [...svg.querySelectorAll('g.node, rect.actor')].map((el) => (el.tagName.toLowerCase() === 'rect' ? el.parentElement : el)));
    const linked = nodes.filter((n) => n.hasAttribute('data-target-id') || n.hasAttribute('data-detail-key'));
    const unlinked = nodes.filter((n) => !n.hasAttribute('data-target-id') && !n.hasAttribute('data-detail-key'));
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const markProblems = svgs.flatMap((svg) => [...svg.querySelectorAll('g.node > .diagram-depth-mark, g.cluster > .diagram-depth-mark')]).filter((mark) => {
      const node = mark.parentElement;
      const label = node.querySelector('.nodeLabel') ?? node.querySelector('text') ?? node.querySelector('.label');
      const m = mark.getBoundingClientRect();
      const n = node.getBoundingClientRect();
      const inside = m.left >= n.left - 0.5 && m.right <= n.right + 0.5 && m.top >= n.top - 0.5 && m.bottom <= n.bottom + 0.5;
      // Glyph extents: union of the label's text-node ranges (label boxes can span the node).
      let text = label?.getBoundingClientRect();
      if (label) {
        const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const box = range.getBoundingClientRect();
          if (box.width === 0) continue;
          l = Math.min(l, box.left); t = Math.min(t, box.top); r = Math.max(r, box.right); b = Math.max(b, box.bottom);
        }
        if (Number.isFinite(l)) text = { left: l, top: t, right: r, bottom: b };
      }
      return !inside || (label && overlap(m, text));
    }).length;
    return {
      svgRoles: svgs.map((svg) => svg.getAttribute('role')),
      linked: linked.length,
      linkedWithRole: linked.filter((n) => n.getAttribute('tabindex') === '0' && (n.hasAttribute('data-detail-key') ? n.getAttribute('role') === 'button' && /^Details: /.test(n.getAttribute('aria-label') || '') : n.getAttribute('role') === 'button' && /^Overview of /.test(n.getAttribute('aria-label') || ''))).length,
      linkedWithMark: linked.filter((n) => n.querySelector(':scope > .diagram-depth-mark, :scope > .diagram-depth-inset')).length,
      insetCues: linked.filter((n) => n.querySelector(':scope > .diagram-depth-inset')).length,
      unlinked: unlinked.length,
      unlinkedInert: unlinked.filter((n) => !n.hasAttribute('role') && !n.hasAttribute('tabindex') && !n.querySelector('.diagram-depth-mark, .diagram-depth-inset') && getComputedStyle(n).cursor !== 'pointer').length,
      oldArrowMarks: document.querySelectorAll('.diagram-link-mark, .diagram-link-inset').length,
      linkedStyle: linked[0] ? style(linked[0]) : null,
      unlinkedStyle: unlinked[0] ? style(unlinked[0]) : null,
      targets: [...new Set(linked.filter((n) => n.hasAttribute('data-target-id')).map((n) => n.getAttribute('data-target-id')))],
      markProblems,
      opensLists: document.querySelectorAll('.diagram-drilldown').length,
      opensText: [...document.querySelectorAll('figure.diagram')].some((f) => /(^|\s)Opens(\s|$)/.test(f.querySelector('.diagram-head')?.innerText ?? '') || Boolean(f.querySelector('.diagram-drilldown'))),
    };
  }, figures);
}
