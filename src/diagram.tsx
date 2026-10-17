import { t, useLanguage } from './i18n';
// Renders one Mermaid block from the current document, live, as SVG.
// Mermaid runs with securityLevel "strict"; renders are serialized and a
// render that finishes after its block unmounted or changed is discarded.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Minus, Plus } from 'lucide-react';
import type { Crumb, DiagramDetail, DiagramFamily } from '../shared/api';
import { diagramFits, MERMAID_MAX_TEXT_SIZE } from '../shared/markdown';
import { type Appearance, useAppearance } from './appearance';
import { checkBuild, isUnloading, reloadOnceFor } from './build';
import { useEscapeLayer } from './layers';
import { attachCanvasGestures, type CanvasHost, MAX_SCALE, MIN_SCALE, zoomAround } from './canvas-gestures';
import { AppLink, documentPath, navigate } from './router';
import { IconButton, QuietButton } from './ui';

type MermaidApi = typeof import('mermaid').default;

let mermaidModule: Promise<MermaidApi> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let renderCount = 0;

function loadMermaid(): Promise<MermaidApi> {
  mermaidModule ??= import('mermaid').then(
    (module) => module.default,
    (error: unknown) => {
      mermaidModule = null; // a failed load is not remembered; the next diagram tries again
      throw error;
    },
  );
  return mermaidModule;
}

// The Nessa neutrals, as hex because Mermaid derives shades from them.
// `stage` matches .diagram-stage in styles.css so edge labels sit on it cleanly.
const PALETTE: Record<Appearance, Record<string, string>> = {
  dark: {
    stage: '#161616',
    node: '#232323',
    nodeBorder: '#474747',
    text: '#ededed',
    muted: '#a3a3a3',
    line: '#7d7d7d',
    cluster: '#1c1c1c',
    clusterBorder: '#383838',
    note: '#262626',
  },
  light: {
    stage: '#fbfbfb',
    node: '#ffffff',
    nodeBorder: '#c7c7c7',
    text: '#1c1c1c',
    muted: '#5c5c5c',
    line: '#8a8a8a',
    cluster: '#f3f3f3',
    clusterBorder: '#dcdcdc',
    note: '#f6f6f6',
  },
};

function themeVariables(appearance: Appearance) {
  const p = PALETTE[appearance];
  return {
    darkMode: appearance === 'dark',
    background: p.stage,
    fontFamily: '"Geist Variable", Geist, ui-sans-serif, system-ui, sans-serif',
    fontSize: '14px',
    primaryColor: p.node,
    primaryBorderColor: p.nodeBorder,
    primaryTextColor: p.text,
    secondaryColor: p.cluster,
    secondaryBorderColor: p.clusterBorder,
    secondaryTextColor: p.text,
    tertiaryColor: p.cluster,
    tertiaryBorderColor: p.clusterBorder,
    tertiaryTextColor: p.text,
    textColor: p.text,
    lineColor: p.line,
    edgeLabelBackground: p.stage,
    clusterBkg: p.cluster,
    clusterBorder: p.clusterBorder,
    titleColor: p.text,
    nodeTextColor: p.text,
    noteBkgColor: p.note,
    noteTextColor: p.text,
    noteBorderColor: p.nodeBorder,
    actorBkg: p.node,
    actorBorder: p.nodeBorder,
    actorTextColor: p.text,
    actorLineColor: p.line,
    signalColor: p.muted,
    signalTextColor: p.text,
    labelBoxBkgColor: p.node,
    labelBoxBorderColor: p.nodeBorder,
    labelTextColor: p.text,
    loopTextColor: p.text,
    activationBkgColor: p.cluster,
    activationBorderColor: p.nodeBorder,
    sequenceNumberColor: p.stage,
    stateBkg: p.node,
    stateBorder: p.nodeBorder,
    stateLabelColor: p.text,
    compositeBackground: p.cluster,
    compositeTitleBackground: p.cluster,
    compositeBorder: p.clusterBorder,
    transitionColor: p.line,
    transitionLabelColor: p.muted,
    specialStateColor: p.muted,
    innerEndBackground: p.muted,
    altBackground: p.cluster,
    errorBkgColor: p.note,
    errorTextColor: p.text,
  };
}

/** Mermaid keeps global state, so one render at a time. */
function renderSvg(source: string, appearance: Appearance): Promise<{ svg: string; renderId: string }> {
  const job = queue.then(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      look: 'classic',
      themeVariables: themeVariables(appearance),
      maxTextSize: MERMAID_MAX_TEXT_SIZE,
      flowchart: { padding: 12, nodeSpacing: 36, rankSpacing: 44 },
    });
    renderCount += 1;
    const renderId = `mmd-${renderCount}`;
    try {
      const { svg } = await mermaid.render(renderId, source);
      return { svg, renderId };
    } finally {
      document.getElementById(renderId)?.remove();
      document.getElementById(`d${renderId}`)?.remove();
    }
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Finds the SVG element(s) Mermaid drew for a node ID in flowchart, state and sequence diagrams. */
export function nodeElements(svg: SVGSVGElement, renderId: string): Map<string, Element[]> {
  const found = new Map<string, Element[]>();
  const add = (id: string, element: Element) => found.set(id, [...(found.get(id) ?? []), element]);
  const prefix = `${renderId}-`;
  for (const element of svg.querySelectorAll('g.node, g.cluster, g.statediagram-cluster')) {
    const dataId = element.getAttribute('data-id');
    const raw = element.id.startsWith(prefix) ? element.id.slice(prefix.length) : element.id;
    const match = /^(?:flowchart|state)-(.+)-\d+$/.exec(raw);
    if (match?.[1]) add(match[1], element);
    else if (dataId) add(dataId, element);
    else if (element.classList.contains('cluster') && raw) add(raw, element);
  }
  // Sequence diagrams: participant boxes carry the alias in `name`.
  for (const element of svg.querySelectorAll('rect.actor[name], g.actor-man[name]')) {
    const name = element.getAttribute('name');
    const target = element.tagName.toLowerCase() === 'rect' ? element.parentElement : element;
    if (name && target) add(name, target);
  }
  return found;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The box of a label's glyphs: the union of its text nodes' ranges, since Mermaid's label boxes often span the whole node. */
export function labelBox(label: Element): DOMRect {
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    const box = range.getBoundingClientRect();
    if (box.width === 0) continue;
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.right);
    bottom = Math.max(bottom, box.bottom);
  }
  return Number.isFinite(left) ? new DOMRect(left, top, right - left, bottom - top) : label.getBoundingClientRect();
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** A small +: the at-rest sign that an element has more depth (a deeper document, or an explanation). */
function depthMark(): SVGGElement {
  const mark = document.createElementNS(SVG_NS, 'g');
  mark.setAttribute('class', 'diagram-depth-mark');
  mark.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M4.5 1 V8 M1 4.5 H8');
  mark.appendChild(path);
  return mark;
}

/**
 * The + in an interactive node's corner. Built with DOM calls (no markup is
 * parsed) and hidden from assistive technology, which hears the node's own
 * name. Tried at the top-right, then the bottom-right; left off if both would
 * touch the label.
 */
export function addDepthMark(element: Element): 'top' | 'bottom' | 'inset' | 'none' {
  if (!(element instanceof SVGGraphicsElement)) return 'none';
  const box = element.getBBox();
  if (box.width < 28 || box.height < 18) return 'none';
  // The words themselves: Mermaid's label containers can span the whole node.
  const label = element.querySelector('.nodeLabel') ?? element.querySelector('text') ?? element.querySelector('.label');
  const mark = depthMark();
  element.appendChild(mark);
  for (const [where, y] of [
    ['top', box.y + 5],
    ['bottom', box.y + box.height - 14],
  ] as const) {
    mark.setAttribute('transform', `translate(${box.x + box.width - 14} ${y})`);
    if (!label || !overlaps(mark.getBoundingClientRect(), labelBox(label))) {
      mark.setAttribute('data-position', where);
      return where;
    }
  }
  mark.remove();
  // No room beside the words: a fine inset outline, still a shape cue, not only colour.
  const inset = document.createElementNS(SVG_NS, 'rect');
  inset.setAttribute('class', 'diagram-depth-inset');
  inset.setAttribute('aria-hidden', 'true');
  inset.setAttribute('x', String(box.x + 3));
  inset.setAttribute('y', String(box.y + 3));
  inset.setAttribute('width', String(Math.max(0, box.width - 6)));
  inset.setAttribute('height', String(Math.max(0, box.height - 6)));
  inset.setAttribute('rx', '4');
  element.appendChild(inset);
  return 'inset';
}

/**
 * The + beside a transition or edge label that has an explanation, clear of the words
 * (to their right, or left where the right is taken). It sits outside the
 * label's own group, so Compact can hide the words and keep the mark.
 */
export function addEdgeMark(edgeLabel: SVGGraphicsElement, label: Element): 'right' | 'left' | 'none' {
  const toLocal = edgeLabel.getScreenCTM()?.inverse();
  if (!toLocal) return 'none';
  const words = labelBox(label);
  const local = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(toLocal);
  const mark = depthMark();
  edgeLabel.appendChild(mark);
  for (const [where, x] of [
    ['right', words.right + 4],
    ['left', words.left - 13],
  ] as const) {
    const at = local(x, words.top + words.height / 2);
    mark.setAttribute('transform', `translate(${at.x} ${at.y - 4.5})`);
    if (!overlaps(mark.getBoundingClientRect(), words)) {
      mark.setAttribute('data-position', where);
      return where;
    }
  }
  mark.remove();
  return 'none';
}

/** What a chart's elements are called, by its family: in control names and the inspector. */
export const ELEMENT_NAMES: Readonly<Record<DiagramFamily, { readonly node: string; readonly edge: string }>> = {
  state: { node: 'State', edge: 'Transition' },
  flowchart: { node: 'Node', edge: 'Edge' },
};

/** A detail the page can open, keyed by its position in the document's diagramDetails. */
export interface DiagramDetailEntry {
  readonly key: number;
  readonly detail: DiagramDetail;
}

/** Elements carrying `data-id` equal to the given value; compared, never put into a selector. */
function byDataId(svg: SVGSVGElement, id: string): Element[] {
  return [...svg.querySelectorAll('[data-id]')].filter((element) => element.getAttribute('data-id') === id);
}

type DiagramState =
  | { readonly kind: 'rendering' }
  | { readonly kind: 'rendered'; readonly svg: string; readonly renderId: string }
  | { readonly kind: 'failed'; readonly message: string }
  /** Rendering failed and the server now serves a newer build than this page runs: its renderer chunks are gone. */
  | { readonly kind: 'outdated'; readonly message: string }
  /** Longer than the site draws (shared/markdown.ts diagramFits): Mermaid is not asked. */
  | { readonly kind: 'too-large'; readonly length: number };

/** The anchor of chart `index` (document order) in either view; slugify never makes a '.', so no heading can take it. */
export function chartAnchor(index: number): string {
  return `chart.${index}`;
}

/** Room kept between an element brought into view and the stage's edges or the inspector. */
const REVEAL_GAP = 16;

// Never drawn larger than authored when fitting: text stays at 14px or below.
const MAX_FIT = 1;
// The first view is fit-to-width, but never below this: 14px labels stay at
// least ~11.5px. A wider diagram scrolls in its stage; "Fit" shows all of it.
export const READABLE_SCALE = 0.82;

/** How the diagram is sized: readable fit (first view), whole-diagram fit, or a chosen scale. */
type Zoom = { readonly mode: 'readable' } | { readonly mode: 'fit' } | { readonly mode: 'manual'; readonly scale: number };

export function scaleFor(zoom: Zoom, fitScale: number): number {
  if (zoom.mode === 'manual') return zoom.scale;
  if (zoom.mode === 'fit') return fitScale;
  return Math.max(fitScale, Math.min(MAX_FIT, READABLE_SCALE));
}

/** The grab cursor only where there is somewhere to pan. */
function markPannable(stage: HTMLElement | null) {
  if (!stage) return;
  if (stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1) stage.dataset.pannable = '';
  else delete stage.dataset.pannable;
}

/** The nearest ancestor that scrolls vertically (the reading pane, or the document on phones). */
function pageScroller(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

export interface DiagramCaption {
  readonly text: string;
  /** Where this diagram's section is in the Details view. */
  readonly detailsHref: string;
}

const NO_DETAILS: readonly DiagramDetailEntry[] = [];

export function Diagram({
  source,
  links,
  index,
  caption = null,
  canvas = false,
  details = NO_DETAILS,
  selectedDetail = null,
  onSelectDetail,
  onExpandedChange,
  revealLeftOf = null,
}: {
  source: string;
  links: Readonly<Record<string, Crumb>>;
  index: number;
  caption?: DiagramCaption | null;
  /** In the Diagrams view: the stage is a window-height canvas that scrolls inside. */
  canvas?: boolean;
  /** This chart's explained elements (a stable array: a new one re-binds the SVG). */
  details?: readonly DiagramDetailEntry[];
  /** The key of the detail open in the inspector, if it is one of this chart's. */
  selectedDetail?: number | null;
  onSelectDetail?: (key: number, element: Element) => void;
  onExpandedChange?: (expanded: boolean) => void;
  /** Where the open inspector begins on screen (viewport x), when it covers the right of this chart. */
  revealLeftOf?: number | null;
}) {
  const language = useLanguage();
  const appearance = useAppearance();
  const [state, setState] = useState<DiagramState>({ kind: 'rendering' });
  const [zoom, setZoom] = useState<Zoom>({ mode: 'readable' });
  const [fitScale, setFitScale] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const labelUpdates = useRef<(() => void)[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const figure = useRef<HTMLElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const natural = useRef({ width: 0, height: 0 });
  // Read at activation, so a new callback never re-binds the SVG.
  const selectDetail = useRef(onSelectDetail);
  selectDetail.current = onSelectDetail;
  const expandedChange = useRef(onExpandedChange);
  expandedChange.current = onExpandedChange;

  useEffect(() => {
    let current = true;
    const check = new AbortController(); // cancels a pending build check on unmount
    if (!diagramFits(source)) {
      setState({ kind: 'too-large', length: source.length });
      return;
    }
    setState({ kind: 'rendering' });
    renderSvg(source, appearance).then(
      ({ svg, renderId }) => current && setState({ kind: 'rendered', svg, renderId }),
      async (error: unknown) => {
        if (!current) return; // unmounted: nothing to show
        const message = error instanceof Error ? error.message : String(error);
        if (isUnloading()) {
          setState({ kind: 'failed', message }); // the page is being left: no server check
          return;
        }
        // Not the message, but the build tells failure kinds apart: is this page still the served build?
        const build = await checkBuild(check.signal);
        if (!current) return;
        if (build.kind === 'outdated') {
          setState({ kind: 'outdated', message });
          reloadOnceFor(build.serverEntry);
        } else {
          setState({ kind: 'failed', message });
        }
      },
    );
    return () => {
      current = false;
      check.abort();
    };
  }, [source, appearance]);

  // Insert the SVG and attach drilldown before paint, so a frame never shows
  // "rendered" without its SVG.
  useLayoutEffect(() => {
    const container = host.current;
    if (state.kind !== 'rendered' || !container) return;
    container.innerHTML = state.svg;
    const svg = container.querySelector('svg');
    if (!svg) return;
    const box = svg.viewBox.baseVal;
    natural.current = { width: box?.width || svg.getBoundingClientRect().width, height: box?.height || svg.getBoundingClientRect().height };
    svg.removeAttribute('height');
    svg.removeAttribute('width');
    svg.style.maxWidth = 'none';
    const nodes = nodeElements(svg, state.renderId);
    const cleanups: (() => void)[] = [];
    const updates: (() => void)[] = [];
    const bindLabel = (element: Element, text: () => string) => {
      const update = () => element.setAttribute('aria-label', text());
      update();
      updates.push(update);
    };
    labelUpdates.current = updates;
    // Click (a press that did not pan: the stage takes a pan's click), Enter or Space.
    const activate = (element: Element, action: () => void) => {
      const onClick = (event: Event) => {
        event.preventDefault();
        action();
      };
      const onKey = (event: Event) => {
        const key = (event as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') {
          event.preventDefault();
          action();
        }
      };
      element.addEventListener('click', onClick);
      element.addEventListener('keydown', onKey);
      cleanups.push(() => {
        element.removeEventListener('click', onClick);
        element.removeEventListener('keydown', onKey);
      });
    };
    const nodeDetails = new Map<string, DiagramDetailEntry>();
    for (const entry of details) {
      if (entry.detail.target.kind === 'node') nodeDetails.set(entry.detail.target.node, entry);
    }
    let linkedCount = 0;
    let explainedCount = 0;
    for (const [node, elements] of nodes) {
      // Only nodes the document's diagramLinks or diagramDetails name act; every other node stays inert.
      const target = Object.hasOwn(links, node) ? (links[node] as Crumb) : null;
      const entry = nodeDetails.get(node) ?? null;
      if (!target && !entry) continue;
      if (entry) explainedCount += 1;
      else linkedCount += 1;
      for (const element of elements) {
        element.classList.add('diagram-link');
        addDepthMark(element);
        element.setAttribute('tabindex', '0');
        if (target) element.setAttribute('data-target-id', target.id);
        if (entry) {
          // An explanation opens in the inspector; a deeper document is offered there.
          element.setAttribute('role', 'button');
          element.setAttribute('aria-haspopup', 'dialog');
          element.setAttribute('aria-expanded', 'false');
          bindLabel(element, () => `${t("Details:")} ${node}${target ? ` (${t("also opens")} ${target.title})` : ''}`);
          element.setAttribute('data-detail-key', String(entry.key));
          activate(element, () => selectDetail.current?.(entry.key, element));
        } else if (target) {
          element.setAttribute('role', 'link');
          bindLabel(element, () => `${t("Open")} ${target.title}`);
          activate(element, () => navigate(documentPath(target.id)));
        }
      }
    }
    for (const entry of details) {
      const edge = entry.detail.target;
      if (edge.kind !== 'edge') continue;
      // Exactly one line and one label carry the published identity, or the edge is left inert.
      const bound = byDataId(svg, edge.element);
      const paths = bound.filter((element) => element.tagName.toLowerCase() === 'path');
      const labels = bound.filter((element) => element.parentElement?.classList.contains('edgeLabel'));
      const [path] = paths;
      const [label] = labels;
      const edgeLabel = label?.parentElement;
      if (paths.length !== 1 || labels.length !== 1 || !path || !label || !(edgeLabel instanceof SVGGraphicsElement)) continue;
      explainedCount += 1;
      const open = () => selectDetail.current?.(entry.key, edgeLabel);
      // The label is the edge's one focusable control; it keeps its name in Compact, where its words are not drawn.
      edgeLabel.classList.add('diagram-edge-detail');
      edgeLabel.setAttribute('tabindex', '0');
      edgeLabel.setAttribute('role', 'button');
      edgeLabel.setAttribute('aria-haspopup', 'dialog');
      edgeLabel.setAttribute('aria-expanded', 'false');
      bindLabel(edgeLabel, () => `${t("Details:")} ${t(ELEMENT_NAMES[entry.detail.family].edge).toLowerCase()} ${edge.from} ${t("to")} ${edge.to}, ${edge.label}`);
      edgeLabel.setAttribute('data-detail-key', String(entry.key));
      addEdgeMark(edgeLabel, label);
      activate(edgeLabel, open);
      // The line itself is a wider, invisible click target.
      path.classList.add('diagram-edge-path');
      path.setAttribute('data-detail-key', String(entry.key));
      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', path.getAttribute('d') ?? '');
      hit.setAttribute('class', 'diagram-edge-hit');
      hit.setAttribute('aria-hidden', 'true');
      hit.setAttribute('data-detail-key', String(entry.key));
      path.after(hit);
      const onClick = (event: Event) => {
        event.preventDefault();
        open();
      };
      const hover = (on: boolean) => () => {
        for (const element of [edgeLabel, path]) element.toggleAttribute('data-hover', on);
      };
      const enter = hover(true);
      const leave = hover(false);
      hit.addEventListener('click', onClick);
      hit.addEventListener('pointerenter', enter);
      hit.addEventListener('pointerleave', leave);
      cleanups.push(() => {
        hit.removeEventListener('click', onClick);
        hit.removeEventListener('pointerenter', enter);
        hit.removeEventListener('pointerleave', leave);
      });
    }
    // An image's children are presentational, which would hide the controls
    // from assistive technology; a diagram with any is a labelled group.
    if (linkedCount + explainedCount > 0) {
      svg.setAttribute('role', 'group');
      bindLabel(svg, () => {
        // Category labels avoid attaching English plural suffixes to Arabic.
        const parts = [
          linkedCount > 0 ? `${t("Linked document nodes")}: ${linkedCount.toLocaleString(document.documentElement.lang)}` : null,
          explainedCount > 0 ? `${t("Elements with details")}: ${explainedCount.toLocaleString(document.documentElement.lang)}` : null,
        ];
        return `${t("Diagram:")} ${parts.filter(Boolean).join('; ')}`;
      });
    } else {
      svg.setAttribute('role', 'img');
    }
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      labelUpdates.current = [];
      container.innerHTML = '';
    };
  }, [state, links, details]);

  // Translate accessible labels without replacing SVG nodes: selection and
  // the inspector's focus-return element must keep their DOM identity.
  useLayoutEffect(() => {
    labelUpdates.current.forEach(update => update());
  }, [language, state, links, details]);

  // The open detail is marked in place; selection never re-renders the SVG.
  useLayoutEffect(() => {
    const svg = host.current?.querySelector('svg');
    if (state.kind !== 'rendered' || !svg) return;
    for (const element of svg.querySelectorAll('[data-detail-key]')) {
      const selected = selectedDetail !== null && element.getAttribute('data-detail-key') === String(selectedDetail);
      element.toggleAttribute('data-selected', selected);
      if (element.hasAttribute('aria-expanded')) element.setAttribute('aria-expanded', String(selected));
    }
  }, [state, details, selectedDetail]);

  // While the inspector covers the right of the stage, the open element stays in view beside
  // it: the SVG gets room on its right as wide as the covered part (so any element can be
  // panned clear), and the stage pans only when the element is not already in view. The
  // scale never changes and the SVG is not redrawn. Closing the inspector removes the room.
  useLayoutEffect(() => {
    const container = host.current;
    const element = stage.current;
    const svg = container?.querySelector('svg');
    if (state.kind !== 'rendered' || !container || !element || !svg || selectedDetail === null || revealLeftOf === null) return;
    const stageBox = element.getBoundingClientRect();
    container.style.setProperty('--covered', `${Math.max(0, Math.round(stageBox.right - revealLeftOf + REVEAL_GAP))}px`);
    container.dataset.covered = '';
    markPannable(element);
    const target = svg.querySelector(`[role="button"][data-detail-key="${Number(selectedDetail)}"]`);
    if (target) {
      const box = target.getBoundingClientRect();
      const left = stageBox.left + REVEAL_GAP;
      const right = Math.min(stageBox.right, revealLeftOf) - REVEAL_GAP;
      if (box.left < left || box.right > right) {
        element.scrollLeft += box.width > right - left ? box.left - left : box.left + box.width / 2 - (left + right) / 2;
      }
      // Vertically, the stage and then the page; horizontally it is already clear of the inspector.
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    return () => {
      delete container.dataset.covered;
      container.style.removeProperty('--covered');
      markPannable(element);
    };
  }, [state, selectedDetail, revealLeftOf]);

  useEffect(() => {
    if (!expanded) return;
    expandedChange.current?.(true);
    return () => expandedChange.current?.(false);
  }, [expanded]);

  // Fit: the largest scale (up to 1) at which the diagram's width fits the
  // stage — and, when expanded, its height too.
  const measureFit = useCallback(() => {
    const element = stage.current;
    const { width, height } = natural.current;
    if (!element || width === 0) return;
    const style = getComputedStyle(element);
    const availableWidth = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    let scale = Math.min(MAX_FIT, availableWidth / width);
    // Expanded, or a canvas in the Diagrams view: the height counts too.
    const boxHeight = expanded ? element.clientHeight : canvas ? parseFloat(style.maxHeight) : Number.NaN;
    if (Number.isFinite(boxHeight)) {
      const availableHeight = boxHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      scale = Math.min(scale, availableHeight / height);
    }
    setFitScale(Math.max(MIN_SCALE, Math.round(scale * 1000) / 1000));
  }, [expanded, canvas]);

  useLayoutEffect(() => {
    if (state.kind !== 'rendered') return;
    measureFit();
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      measureFit();
      markPannable(stage.current);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [state, measureFit]);

  const scale = scaleFor(zoom, fitScale);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const sizeSvg = useCallback((next: number) => {
    const svg = host.current?.querySelector('svg');
    const { width, height } = natural.current;
    if (!svg || width === 0) return;
    svg.style.width = `${width * next}px`;
    svg.style.height = `${height * next}px`;
  }, []);
  useLayoutEffect(() => {
    const svg = host.current?.querySelector('svg');
    const { width } = natural.current;
    if (!svg || width === 0) return;
    sizeSvg(scale);
    markPannable(stage.current);
    // Larger than the stage: open on where the diagram begins — a state
    // chart's start, else the first node — rather than on empty canvas.
    const element = stage.current;
    if (element && zoom.mode === 'readable') {
      // Topmost node; among nodes level with it (a sequence diagram's participants), the leftmost.
      const topmost = [...svg.querySelectorAll('g.node, rect.actor')].reduce<Element | null>((best, node) => {
        if (best === null) return node;
        const a = node.getBoundingClientRect();
        const b = best.getBoundingClientRect();
        return a.top < b.top - 2 || (Math.abs(a.top - b.top) <= 2 && a.left < b.left) ? node : best;
      }, null);
      const start = svg.querySelector('[id*="-state-root_start-"]') ?? topmost;
      const stageBox = element.getBoundingClientRect();
      if (start && (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)) {
        const box = start.getBoundingClientRect();
        element.scrollLeft += box.left + box.width / 2 - (stageBox.left + stageBox.width / 2);
        element.scrollTop += box.top - stageBox.top - 24;
      } else {
        element.scrollLeft = Math.max(0, (element.scrollWidth - element.clientWidth) / 2);
      }
    }
  }, [scale, state, zoom.mode]);

  // Expanded: fills the window; Escape (src/layers.ts) or the button returns; Tab stays inside.
  useEscapeLayer(expanded, () => setExpanded(false));
  useEffect(() => {
    if (!expanded) return;
    figure.current?.querySelector<HTMLElement>('[data-action="collapse"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && figure.current) {
        const focusable = [...figure.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      expandButton.current?.focus();
    };
  }, [expanded]);

  // Pan and zoom on the stage itself (src/canvas-gestures.ts). The host sizes
  // the SVG synchronously so focal zoom can measure before and after.
  const canvasHost = useCallback(
    (element: HTMLElement): CanvasHost => ({
      stage: element,
      svg: () => host.current?.querySelector('svg') ?? null,
      scale: () => scaleRef.current,
      setScale: (next) => {
        scaleRef.current = next;
        sizeSvg(next);
        setZoom({ mode: 'manual', scale: next });
      },
      pageScroller: canvas || expanded ? undefined : () => pageScroller(element),
    }),
    [sizeSvg, canvas, expanded],
  );
  useEffect(() => {
    const element = stage.current;
    if (state.kind !== 'rendered' || !element) return;
    return attachCanvasGestures(canvasHost(element));
  }, [state.kind, expanded, canvasHost]);

  /** − / +: zoom around the stage's centre (row 15). */
  const step = (factor: number) => {
    const element = stage.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    zoomAround(canvasHost(element), Math.min(MAX_SCALE, Math.max(MIN_SCALE, scaleRef.current * factor)), {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    });
  };
  const fitsWhole = scale <= fitScale + 0.001;

  const controls = (
    <div className="diagram-actions" role="group" aria-label={t("Diagram view")}>
      {state.kind === 'rendered' ? (
        <>
          <QuietButton onClick={() => setZoom({ mode: 'fit' })} aria-pressed={fitsWhole} title={t("Show the whole diagram")} data-action="fit">{t("Fit")}</QuietButton>
          <IconButton label={t("Zoom out")} onClick={() => step(1 / 1.25)} data-action="zoom-out">
            <Minus />
          </IconButton>
          <span className="diagram-scale" aria-live="polite" data-testid="diagram-scale">
            {Math.round(scale * 100)}%
          </span>
          <IconButton label={t("Zoom in")} onClick={() => step(1.25)} data-action="zoom-in">
            <Plus />
          </IconButton>
          {expanded ? (
            <IconButton label={t("Close expanded diagram")} onClick={() => setExpanded(false)} data-action="collapse">
              <Minimize2 />
            </IconButton>
          ) : (
            <IconButton ref={expandButton} label={t("Expand diagram")} onClick={() => setExpanded(true)} data-action="expand">
              <Maximize2 />
            </IconButton>
          )}
        </>
      ) : null}
    </div>
  );

  return (
    <figure
      ref={figure}
      id={chartAnchor(index)}
      className="diagram"
      data-diagram-index={index}
      data-state={state.kind}
      data-canvas={canvas ? '' : undefined}
      data-expanded={expanded ? '' : undefined}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={expanded ? (caption?.text ?? 'Diagram') : undefined}
    >
      <div className="diagram-head">
        {caption ? (
          <figcaption className="diagram-caption">
            <span className="diagram-caption-text" title={caption.text}>
              {caption.text}
            </span>
            <AppLink to={caption.detailsHref} className="diagram-read" data-action="details-section">{t("In Details")}</AppLink>
          </figcaption>
        ) : (
          <span />
        )}
        {controls}
      </div>
      {state.kind === 'failed' ? (
        <div className="diagram-error" role="alert">
          <strong>{t("This diagram could not be rendered.")}</strong>
          <p>{state.message}</p>
        </div>
      ) : state.kind === 'too-large' ? (
        <div className="diagram-error" data-too-large="">
          <strong>{t("This chart is not drawn: it is too long.")}</strong>
          <p>
            {t('Its Mermaid source is {length} characters; charts up to {limit} are drawn.')
              .replace('{length}', state.length.toLocaleString(language))
              .replace('{limit}', MERMAID_MAX_TEXT_SIZE.toLocaleString(language))}
          </p>
        </div>
      ) : state.kind === 'outdated' ? (
        <div className="diagram-error" role="alert" data-outdated="">
          <strong>{t("The site was rebuilt since this page loaded, so this diagram's renderer is no longer available.")}</strong>
          <p>{state.message}</p>
          <QuietButton onClick={() => window.location.reload()} data-action="reload-page">{t("Reload page")}</QuietButton>
        </div>
      ) : (
        <div
          ref={stage}
          className="diagram-stage"
          data-zoom={zoom.mode}
          data-fits={fitsWhole ? '' : undefined}
          title={t("Drag to pan · Ctrl or ⌘ + scroll, or pinch, to zoom")}
        >
          {state.kind === 'rendering' ? <p className="diagram-pending">{t("Rendering diagram…")}</p> : null}
          <div ref={host} className="diagram-svg" />
        </div>
      )}
      {/* Diagnostic only: a chart that could not be drawn shows what it was given. */}
      {state.kind === 'failed' || state.kind === 'outdated' ? (
        <pre className="diagram-source" aria-label={t("Mermaid source")}>
          <code>{source}</code>
        </pre>
      ) : null}
    </figure>
  );
}
