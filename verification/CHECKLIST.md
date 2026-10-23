# Browser contracts

The tables name automated browser contracts (Chromium and WebKit), unit contracts,
and explicitly pending manual checks. A listed contract is not a run result;
verification/results and the extraction report record completed runs and skips. Rule: Nessa CODING_STANDARDS.md "Browser verification for UI" (gate 17).

| Contract | Script | Measured |
| --- | --- | --- |
| Root renders its system diagram as live Mermaid SVG (no image fallback) with linked service nodes | journeys, real-data | svg element count, linked node count |
| Every Mermaid block in a real document's Markdown (counted by `shared/markdown.ts`) renders as SVG at its index; a failed, too-large or outdated fallback fails | real-data (every document) | blocks = figures = rendered, fallbacks = 0 |
| Diagram node click drills root → service → feature → flow; URL, title, breadcrumbs match | journeys, real-data | pathname, breadcrumb count |
| Sequence participants and state nodes are drilldown targets too | journeys | pathname after click |
| Keyboard: focus a diagram node, Enter navigates; focus lands on the new title | journeys | active element |
| Sidebar tree navigates root → service → feature → flow; collapse/expand works; current item marked | journeys, real-data | aria-expanded, aria-current |
| Back/forward and breadcrumbs restore the right document | journeys, real-data | pathname, title |
| Search finds loaded documents; empty result is explicit | journeys, real-data | result IDs |
| Unknown document ID, traversal-shaped ID, unknown path → explicit 404, no document shown | journeys, real-data | `.document-layout` count = 0 |
| A rejected file's ID → 404 that names the rejection | real-data | issue code shown |
| Settings › Health lists every API issue (errors and warnings, file/code/message) and the accepted-document count; the fixture's rejected `draft-notes.md` is named | journeys, settings (fixture and real), real-data | DOM count = API count, text |
| Raw HTML in Markdown is text; no script/img injected | journeys | `#main script`, `#main img` = 0 |
| Broken Mermaid shows the error and the source (the only place Mermaid source is shown: a diagnostic) | journeys, details | figure state `failed`, source text |
| Slow earlier document answer cannot replace the newer page or its diagrams | journeys | pathname/title/linked nodes after 1.6 s |
| No horizontal overflow at 390 / 820 / 1280 / 1440; diagrams inside the viewport | responsive | scrollWidth − clientWidth = 0 |
| < 900 px: sidebar is off-canvas and out of the tab order; the app-bar toggle opens it, focus moves in, Escape closes and returns focus to the toggle, main is inert while open | responsive | visibility, active element, inert |
| ≥ 900 px: sidebar docked at 260 px by default; no permanent outline column; every first diagram spans the reading column | responsive, journeys | rects |
| Sidebar hide (keyboard): main widens by > 200 px, sidebar inert, focus stays on the toggle; show restores the width | journeys | rects, inert, active element |
| Sidebar footer is one quiet **Settings** link (gear): no issue count, no warnings label, no theme or reload buttons; it is reachable while the catalog loads, after it fails and when no root was accepted | settings | DOM counts, text |
| `/settings` opens General, `/settings?tab=health` opens Health; choosing a tab (click or arrow keys) pushes the URL, Back/Forward restore the tab; `/problems` is an ordinary 404 | settings | URL, aria-selected, tab panel |
| General › Appearance (Nessa UI segmented control): Dark/Light applies at once, persists across reload (`nessa-state-browser:appearance`), the pressed option matches | settings | `html.dark`, aria-pressed, localStorage |
| Health › Reload documentation re-reads the catalog: busy while in flight, then the new count; a failed read says so (role=alert) and Reload recovers; zero issues shows one quiet healthy line | settings (fixture, routed `/api/catalog`) | aria-busy, text, request count |
| Settings at 390 / 820 / 1280 / 1440, dark and light: no horizontal overflow, tabs and controls inside the window | settings | scrollWidth, rects |
| Sidebar resize (≥ 900 px): separator in the gutter between the panes; drag follows the pointer exactly (±1 px), clamped 220–350; arrows ±10, Home 220, End 350; aria-valuenow/min/max/valuetext match the width; release persists (`nessa-state-browser:sidebar-width`), reload restores; Escape / pointercancel restore the width at the press; hidden sidebar and narrow windows have no separator; hide/show and narrow → wide keep the width; double-click resets to 260 | sidebar-resize (rows R1–R14) | rects, aria-*, localStorage |
| Sidebar resize edge light (both appearances, measured from screenshot pixels): nothing lit at rest; hover and a captured drag light a short span (≤ 200 rows) centred on the pointer's height (±4 px), held between the panes' corners; leaving while idle, a released drag, pointercancel, lost capture and Escape leave nothing at the pointer's last height — Escape, pointercancel and lost capture measured with the pointer still held and not moved; keyboard-only focus lights the middle; no layout shift | sidebar-resize (rows R15–R16) | screenshot row deltas, `--sidebar-glow`, rects |
| During a drag the diagram SVG is never re-inserted and nothing navigates; after it a linked node click still opens its document | sidebar-resize | MutationObserver, pathname |
| As the sidebar resizes (220 / 350, keyboard and drag) the app bar (toggle + nessaDocs) does not move, the reading pane fills the rest of the window (main.x = sidebar.right + 8, main.right = viewport − 8), the chart spans the column, no horizontal overflow | brand, sidebar-resize | rects |
| Titlebar Back/Forward: disabled (aria-disabled) with no history, then move through history like the browser's | journeys | pathname, aria-disabled |
| On this page is a popover: opens with focus on the first heading, Escape closes and returns focus | journeys | active element |
| No titlebar details button; **Sources and provenance** (file, ID, sources, warnings) is a closed `<details>` footer, last on the page, in Details and Diagrams | journeys, real-data (every document), details | open state, position after content |
| Footer opens and closes by keyboard (Enter/Space) and shows every API source, the file and the ID; opening it leaves the first diagram's document position unchanged | journeys, real-data (attachments page: 17 sources, host, storage-publication; both views) | counts, text, document-relative top |
| Footer resets: the next document starts closed, and Back arrives closed | journeys, real-data | open state |
| No Markdown source button and no per-diagram Mermaid **Source** toggle, in either view | journeys, navigation (6 documents × 2 views), details | DOM count = 0 |
| Expand: diagram fills the window (≥ viewport − 20 px), focus moves in, Escape closes and returns focus | journeys | rect, active element |
| First view of every real diagram is the whole diagram or ≥ 82 % (14 px labels ≥ ~11.5 px) | real-data | scale per diagram |
| Strict Mermaid SVG carries no on* handlers, script/iframe/object/embed, or javascript: links | real-data | count = 0 |
| Text contrast ≥ 4.5:1 in dark and light (prose, title, meta, child summary, breadcrumb, sidebar row, section label, prose document link, heading anchor `#` in its shown colour, search) | real-data | ratios |
| < 900 px: every titlebar control ≥ 40 px tall | responsive | heights |
| No console or page errors (the 404 resource lines from the deliberate 404 checks are counted separately) | all | counts |
| Diagrams first: a page with charts opens on them; at 1280×800 the first diagram begins ≤ 180 px from the top, spans the reading column, and all of it or ≥ 450 px is visible (every real document, and fixture root/service/feature) | real-data, journeys | figure top, width, visible height |
| Details (`?view=details`) holds the full Markdown with every diagram inline (count equal to the Diagrams view); Back returns to Diagrams, Forward to Details; `?view=read` is not an alias (default view) | real-data, journeys, details | counts, URL |
| A `#section` link opens Details at that heading (or the pane at its end); a caption's "In Details" does too | journeys, details | heading top |
| Phone: view switch options ≥ 40 px | responsive | heights |
| Only `diagramLinks` nodes are links (role=link, tab stop, "Open …" label, target in the API's links) and only bound `diagramDetails` elements are detail buttons (role=button, "Details: …"); every other node has no role, no tab stop, no cue and no pointer, and clicking it goes nowhere | journeys (fixture root), real-data (every document; the root component map — the "System overview" chart — has exactly 13 linked services and an inert External provider runtime), details | attributes, URL |
| Interactive nodes differ at rest: accent tint and border (computed fill/stroke differ from inert) plus a + mark inside the node and clear of the label's glyphs (inset outline only where no room); no ↗ mark remains | journeys, real-data (every linked node), details | computed styles, mark/label rects |
| No "Opens" destination list under any diagram, in Diagrams, Read or expanded | journeys, real-data | DOM count |
| Drilldown through nodes: root → MCP by keyboard Enter, MCP → its leaf by mouse, root → Local gateway by mouse | real-data | pathname |
| Child rows carry a trailing chevron | journeys | DOM count |
| A pure-contract page (credentials-values: a contract with no chart, checked in the API) opens in Details with no view switch and no chart; one introduction: the summary is said once (in the header, or only in the introduction when it opens with it; the rule's examples are the one `summaryExamples` table in `src/view.test.ts` — it was narrowed to the whole paragraph or its complete first sentence and its examples gathered there after two review rounds found untested punctuation clauses, so a new clause comes with a row); the "# Title" line still collapses and the body after it is kept; a page that opens on a heading (found in the API: its first block is a heading other than its title) keeps the header summary and opens on its heading; a first paragraph that says something else keeps the header summary (said once) and is drawn as the first block — no real page has one, so the contract's API response is routed in that page with its introduction replaced, and the real response is checked unchanged afterwards; search on the summary's first words still finds it | navigation, view.test | DOM text, counts |
| A guide with no chart (provenance, checked in the API) opens readable Details (paragraphs and section headings, no chart, nothing waiting to render), also when `?view=diagrams` is asked for | navigation | DOM |
| No "The description, evidence and every section are in Read." paragraph, no "Opens" list, no Read switch and no source controls (6 documents × 2 views); Diagrams view ends with the closed provenance footer | navigation, journeys | DOM |
| The system page's sequence diagram (found by its Markdown block) renders (actors, messages), every chart on the page renders, and it opens on its first participant | navigation (+ final check on 4311 and 4314) | states, rects |
| Missing asset → 404 `no-store`; page from an older build → exactly one reload, then an explained state with Reload + source (no loop); current build + missing chunk → honest error + source, no reload | navigation (routing), stale-build (two real builds, port 4316) | load counts, sessionStorage, requests |
| Drag pans by the pointer distance (±2 px), no navigation, SVG never re-inserted; frame median/max during drag (single headless run, 1280×800, unthrottled — conditions in README Limitations) | navigation | scroll deltas, MutationObserver, rAF intervals |
| A press moving < 4 px is a click (linked node opens); a drag leaving a node and released on it does not navigate (pointer capture); keyboard Enter navigates; unlinked node inert | navigation (mutant without capture fails) | pathname |
| Press at the frame edge, leave before 4 px, release outside, hover back: no scroll, no grabbing (row 18) · health never answers → failed + source within the bound, timed from the renderer chunk's 404 (< 4.5 s; B3) · reload guard denied → outdated + Reload + source, no auto reload, no page error (B4) | navigation (each fails on the pre-fix build in both engines) | scroll, state, timing, load count, page errors |
| Ctrl/⌘ + wheel and two-finger pinch zoom around the focal point (≤ 2 px; pinch ≤ 3 px); − / + around the centre; bounded 25–400 %; plain wheel scrolls, never zooms; Fit still fits; expanded drag and Escape focus; Details-view inline zoom keeps focus via the page | navigation (mutant without focal correction fails 5 checks) | natural-coordinate drift, scales |
| App bar: the sidebar toggle at the window's top-left (≤ 20 px, on top) beside **nessaDocs** (root and a deep document, 390 / 820 / 1280 / 1440, dark and light): "nessa" ≥ 650 weight, "Docs" ≤ 450 and muted, both 20 px, joined within 1.5 px, same row as the toggle (≤ 2 px); docked: inside the sidebar's top row above Search and level with the titlebar; hidden or narrow: Back ≥ 8 px after it; phone: name only in the open drawer; no horizontal overflow | brand (BRAND_MUTANT `no-titlebar-room` / `no-sidebar-room` fail it) | rects, computed type |
| App bar journeys: Tab reaches the toggle right after the skip link; hide/show by keyboard keeps the toggle in place with focus, the name beside it, the pane > 200 px wider; hidden is remembered across reload; toggling never navigates; the name opens `/` without touching the sidebar. Narrow: toggle ≥ 40 px, unmoved and on top of the open drawer; Escape and the scrim close it and return focus; the name opens `/` and closes it | brand | rects, active element, aria-expanded, pathname |
| With BASELINE_URL: the first chart's top/x/width and the titlebar actions' right edge equal the build before the app bar (±1 px; the group is one control narrower without Markdown source), titlebar height unchanged | brand | rects |
| Light appearance: rendered, 13 + marks, drag pans; phone: `touch-action: pan-x pan-y`, pinch zooms, no overflow | navigation | computed styles, scales |
| Diagram details (rows D1–D22 below): the server binds a `diagramDetails` entry only when its chart (a state diagram or a flowchart), element and section are each found exactly once; the inspector opens authored sections for nodes, transitions and flowchart edges; Diagram detail Compact/Standard/Full | details (fixture `fixtures/details-repo`; with REAL_URL the real host, auth and app-call pages) | API, DOM, rects, focus, storage |

## Canvas gestures and build check: states × events

The design record for `src/canvas-gestures.ts` and the renderer-failure path in
`src/diagram.tsx` / `src/build.ts` (gate 15). Code comments cite these row numbers.
A new state or ordering is added here before it is coded. Every row is exercised
by `verification/navigation.mjs` (gesture rows: `--only=gestures`; build rows:
`--only=stale`), and rows B1–B2 also by `verification/stale-build.mjs`.

States: **Idle** · **Pressed** (mouse/pen down on the stage, < 4 px moved) · **Panning** (pointer captured) ·
**Pinching** (2 touch pointers) · **ZoomPending** (wheel/gesture zoom batched to one animation frame).

| # | State | Event | Result |
| --- | --- | --- | --- |
| 1 | Idle | pointerdown, primary mouse/pen, on the stage (node or background) | Pressed; remember point and scroll |
| 2 | Pressed | pointermove < 4 px | stay Pressed (a click is still a click) |
| 3 | Pressed | pointermove ≥ 4 px, primary button held | Panning: setPointerCapture, grabbing cursor |
| 4 | Panning | pointermove, primary button held | scroll = start − delta (no React render, no SVG change) |
| 5 | Pressed | pointerup | Idle; the click proceeds, so a linked node opens |
| 6 | Panning | pointerup | Idle; release capture. The click that follows targets the capturing stage, not a node, so nothing opens |
| 7 | Pressed/Panning | pointercancel / lostpointercapture | Idle; the press is cleared before capture is released |
| 18 | Pressed/Panning | pointermove with the primary button **not** held (`buttons & 1 === 0`): the release happened outside the stage, uncaptured | Idle, no scroll, no grabbing cursor; the hover is only a hover |
| 8 | any | ctrl/⌘ + wheel (including macOS trackpad pinch) | preventDefault; ZoomPending; one frame zooms around the cursor |
| 9 | any | plain wheel | native scroll of the stage, chaining to the page at its edges |
| 10 | any | WebKit gesturestart/change | preventDefault; zoom by `scale` around the last pointer position |
| 11 | Idle | touch pointerdown ×1 | native one-finger scroll (`touch-action: pan-x pan-y`), tracked only |
| 12 | 1 touch | second touch pointerdown | Pinching: distance, midpoint, start scale |
| 13 | Pinching | touch pointermove | scale = clamp(start × d / d0) around the midpoint (one frame) |
| 14 | Pinching | a touch up/cancel | Idle; the remaining finger goes back to native scroll |
| 15 | any | − / + | zoom ×1.25 around the stage centre |
| 16 | any | Enter/Space on a focused linked node | navigate |
| 17 | any | unmount, re-render, expand toggle | listeners removed, capture released, pending frame cancelled |
| B1 | rendering | renderer/chunk load fails; `/api/health` names a **different** client entry | outdated: Reload button and source shown; reload once per server build (sessionStorage guard; the reloaded page is that build, so no loop) |
| B2 | rendering | renderer fails; health names the **same** entry, answers garbage, or errors | failed: the real error and the source; no reload |
| B3 | rendering | renderer fails; `/api/health` does not answer within **3 s** | treated as unknown → failed with error and source (the check is aborted at 3 s) |
| B4 | rendering | renderer fails; outdated; the reload guard cannot be read or written (storage denied) | outdated with Reload and source; **no automatic reload**, nothing thrown |
| B5 | any | renderer fails while the page is being left (beforeunload/pagehide) or after unmount | failed (or nothing, if unmounted); no health check |

Scale is bounded to [0.25, 4]. The focal point holds within 2 px wherever the frame can scroll.

## Sidebar resize: states × events

The design record for `src/sidebar-resize.tsx` and `src/sidebar-width.ts` (gate 15).
Every row is exercised by `verification/sidebar-resize.mjs`; R11 and R12 by
`src/sidebar-width.test.ts` too. The width rule (220–350 px, whole pixels,
default 260, keyboard step 10) is owned by `src/sidebar-width.ts` alone.

States: **Idle** (committed width W) · **Dragging** (pointer captured; preview width P written to
`--sidebar-w` on the shell, no React render, nothing stored). The edge light's height is written the
same way, to `--sidebar-glow` on the separator (R15, R16).

| # | State | Event | Result |
| --- | --- | --- | --- |
| R1 | Idle | primary-button pointerdown on the separator | Dragging: capture, remember start x and W, `data-resizing` on the shell (no grid transition, col-resize cursor, no text selection) |
| R2 | Idle | non-primary pointerdown (right/middle button) | ignored |
| R3 | Dragging | pointermove | P = clamp(W + Δx); `--sidebar-w` and aria-valuenow follow; nothing stored |
| R4 | Dragging | pointerup | Idle; W = P, stored once, release capture |
| R5 | Dragging | pointercancel, or lostpointercapture without a pointerup | Idle; P discarded, `--sidebar-w` back to W, nothing stored |
| R6 | Dragging | Escape | Idle; as R5 (the release that follows is ignored) |
| R7 | Idle | ArrowLeft / ArrowRight (focused separator) | W = clamp(W ∓ 10), stored |
| R8 | Idle | Home / End | W = 220 / 350, stored |
| R9 | Idle | double-click | W = 260, stored |
| R10 | any | sidebar hidden, or window < 900 px (separator unmounts; mid-drag = R5) | no separator in the DOM; W kept; showing / widening again uses W; the drawer keeps its own width |
| R11 | start | stored value missing, not a whole number, or not finite | W = 260 |
| R12 | start | stored value outside 220–350 | W = clamp(value) |
| R13 | Dragging | the drag passes either bound | P stays at the bound; the pointer can come back and P follows from the press point (Δx is from the press, not accumulated) |
| R14 | Idle/Dragging | storage write denied | the width still applies for this page; nothing thrown |
| R15 | Idle (hovered) / Dragging | pointerenter, pointermove (captured too) | `--sidebar-glow` = the pointer's height on the separator; a soft light centred there, clamped to the strip between the panes' corners — never the whole edge |
| R16 | Idle | pointerleave; keyboard focus; a discarded drag (R5, R6) | leave forgets the height (unlit unless keyboard-focused); a discard forgets it at once, before any pointer event, as the edge moves back from under the pointer; a press focuses without `:focus-visible`, so a drag leaves nothing lit; keyboard focus lights the middle. After Escape (pointer still held, not moved), WebKit counts the key as keyboard focus and keeps `:hover` (middle lit), Chromium does not (unlit) — never the drag's height |

## Settings and the catalog read: states × events

The catalog has one owner (`App` in `src/app.tsx`); Settings › Health reads it, it never fetches its own.

| # | State | Event | Result |
| --- | --- | --- | --- |
| S1 | loading (first read) | open /settings | Settings renders; Health says "Reading docs/state…" (aria-busy); General works |
| S2 | loaded | Reload documentation | still loaded, `reloading` (button busy, "Reading docs/state…"); the old count stays until the answer |
| S3 | loaded + reloading | answer ok | loaded with the new catalog; count and issues replaced; "Read at <time>" |
| S4 | loaded + reloading | answer fails | failed: the message (role=alert) and Reload documentation; sidebar shows the message and keeps Settings |
| S5 | failed | Reload documentation / Try again | failed + reloading (busy), then S3 or S4 |
| S6 | any reloading | Reload again | the earlier request is aborted; only the last answer applies |
| S7 | loaded | a document reports a newer version (stale catalog) | same as S2 (one reload path) |
| S8 | loaded, 0 errors and 0 warnings | Health | one quiet "No errors or warnings." line |
| S9 | loaded, no root accepted | sidebar | "No system document was accepted. See Settings › Health." and the Settings link |

## Diagram details: rows and the inspector's states × events

Authored mapping: `diagramDetails` in frontmatter (docs/state/authoring.md). One owner per rule:
Markdown structure (diagram order, sections, heading text) is `shared/markdown.ts`, used by the
server's validation and the browser's rendering; which Mermaid element an entry names is decided
once, on the server, with Mermaid's own parser and database for state diagrams and flowcharts
(`server/diagram-reader.ts`, `server/diagram-details.ts`), which publishes the element's SVG
`data-id` and the chart's family; an edge whose identity Mermaid also gives another element is
refused (`ambiguous-detail-edge`); the browser binds by comparing that attribute, only where exactly
one line and one label carry it, and never re-matches labels. Mermaid runs on the server in a worker of its
own inside a jsdom window (`server/diagram-reader-worker.mjs`), so DOMPurify runs unmodified and the
main thread has no DOM. A transition or edge label binds only when it is plain text written as is;
labels written with Mermaid entity codes, HTML or a flowchart Markdown string are refused (`unsupported-detail-label`). One
size rule, `diagramFits` in `shared/markdown.ts`, decides which charts are drawn (browser) and can
carry details (server). Unbound entries are warnings (Settings › Health) and have no action. One
Escape closes one layer, the last opened or raised (`src/layers.ts`).

| # | Contract | Measured |
| --- | --- | --- |
| D1 | API: bound entries only; same-pair transitions get distinct Mermaid elements and sections; each unbound entry is a warning with its code (`unknown-detail-diagram`, `unsupported-detail-diagram`, `unknown-detail-node`, `unknown-detail-edge`, `unsupported-detail-label`, `ambiguous-detail-edge`, `unknown-detail-section`, `ambiguous-detail-section`, `duplicate-detail-selector`) | JSON |
| D2 | Views are Diagrams and Details only; no source controls; failed chart keeps its source; caption "In Details", Back/Forward; `?view=read` opens the default view; provenance last and closed | DOM, URL |
| D3 | + only where there is depth: explained nodes and navigation-only nodes carry one + inside the node, clear of the words; bound transition labels carry a + clear of their words; unbound labels and inert nodes carry none; a navigation-only node navigates at once | rects, attributes, URL |
| D4 | A transition label opens the inset pane (non-modal, ≥ 900 px) titled by its section, naming the transition and label, focus on the title; Standard shows the overview (blocks before the first nested heading, at most two) and "Show full explanation"; full = the whole section incl. nested headings, nothing after it; content safe (raw HTML as text, no script, `javascript:` unresolved, external `_blank` + `noopener`, document links routed, no duplicate IDs) | DOM text, attributes |
| D5 | The second same-pair transition opens its own section; only the open element is `aria-expanded`; Escape returns focus to the label | text, active element |
| D6 | Enter and Space open; Close returns focus; a state opens its section with evidence flags | active element |
| D7 | The transition line (away from its label) is a click target; a drag from a label (≥ 4 px) pans and never opens; a press < 4 px is a click | scroll, open state |
| D8 | Opening with the element already in view beside the pane leaves scale, pan, stage size and the SVG element unchanged; switching to an element under the pane pans it clear at the same scale; closing leaves the pan; the chart controls stay clear of the pane | text, scroll, rects, attribute probe |
| D9 | A node with a section and a document opens the inspector with "Open <title>"; that link and links in the section navigate and clear the selection; Back arrives with nothing selected | URL, open state |
| D10 | Switching view or theme closes it; charts in Details open the same inspector | open state |
| D11 | Settings › General › Diagram detail: Standard by default, the modes explained; a choice in another tab applies at once with the same SVG, scale and pan, the inspector kept; Compact hides transition labels (but the open, focused or hovered one) and notes, keeps + marks, accessible names and note text; Full opens whole sections; persists across reload | opacity, attribute probe, storage |
| D12 | Invalid stored value → Standard; blocked storage → Standard, a choice still applies in the tab, no page error | aria-pressed, page errors |
| D13 | Over an expanded chart the inspector is a modal dialog on top; Escape closes it first, then the chart | `:modal`, elementFromPoint |
| D14 | 390/820 (drawer): a modal dialog at the right edge inside the viewport, Tab/Shift+Tab stay in it, the drawer toggle cannot open beneath, Escape returns focus; with the drawer open the chart beneath opens nothing. 1280/1440 × sidebar 350 / hidden: an inset pane below the titlebar inside the reading pane, clear of the sidebar; the stage keeps its size and scale and the open transition is in view, clear of the pane. All × dark/light: no horizontal overflow | rects, active element, overflow |
| D15 | Settings › Health lists every unbound entry with its code; the page's warning count includes them | DOM |
| D16 | Real pages (host, auth-admission, auth-credential, app call): every published detail is bound to the element it names (edge label text = authored label) with a +; other nodes inert; host: each of the five labelled edges (Enter) opens its own section as an Edge and Escape returns focus to it, and all six nodes keep their document link with one +; "Origin, scope, visibility or bounds rejected" opens Admission refusal rules (a refusal reason), "Admission audit unavailable" opens Direct dispatch admission | DOM text, active element |
| D17 | Size and labels (fixture `edge-cases`): a chart of exactly 100,000 characters is drawn and its detail bound; 100,001 (with or without front matter and a directive) is not drawn, says so, shows no source and has no controls, and Health has `unsupported-detail-diagram`; only the plain label is a control, named as written; entity-code and HTML labels get `unsupported-detail-label`, quoting no internal or markup text | DOM, API |
| D18 | Escape layers: Outline over the inspector → Outline closes (focus to its button), then the inspector (focus to the element); pane open then Expand → the inspector is a dialog in front and closes first, then the chart (focus to Expand); drawer: the search field's Escape clears it first, then the drawer closes (focus to the toggle) | DOM, active element |
| D19 | Following a link from the inspector closes it: a same-page `#section` link in Details (focus to that heading), and in Diagrams (D6); Back closes it; an external link opens a new tab and leaves this page and the inspector as they are | URL, open state, active element |
| D20 | A chart inside an explained section is a link ("Open chart n in Details") to the page's chart by its document order (block quotes and lists counted), never a second chart; following it opens Details at that chart (focused) and closes the inspector | DOM, URL, active element |
| D21 | Real app call, 1280/1440 × sidebar 350 / hidden: opening Dispatch, Withheld and the "Completion audit unavailable / effect unconfirmed" guard brings each into view, clear of the pane, selected, at the same scale | rects, scale |
| D22 | Flowchart component map (fixture `gate-map`): 3 labelled edges and 1 node bound, family `flowchart`, sibling edges of one pair on their own Mermaid elements; a repeated label is `ambiguous-detail-edge`, entity-code and Markdown labels `unsupported-detail-label`; each bound label's words and line match the published label and element, with exactly one +; unbound labels carry none; controls named "Details: edge A to B, label"; nodes: navigation-only is a link, navigation + details a details button (kind Node, "Open Review flow" navigates), others inert; click, line click, Enter and Space open (kind Edge), the sibling opens its own section with only it expanded, Escape and Close return focus; Compact hides the labels but the open one and keeps marks and names; Full opens the whole section | JSON, DOM, active element, opacity |

| State | Event | Next |
| --- | --- | --- |
| closed | activate a detail element (click < 4 px, Enter, Space) | open (pane ≥ 900 px; dialog when narrow or a chart is expanded); focus on its title |
| open(a) | activate b | open(b); focus returns to b on close |
| open | Close, Escape (when it is the top layer) | closed; focus to the element it came from (or the page title if that is gone) |
| open, Outline over it | Escape | Outline closes; the inspector stays |
| open | a link in it followed in this tab, or Back/Forward | closed; focus to the link's #section (else the page title) |
| open | an external (new-tab) link | unchanged |
| open (pane) | the element is under the pane or out of the stage | the stage gets room on its right and pans it into view; scale unchanged |
| open | a drag from an element (the stage takes the pan's click) | unchanged |
| open | Diagram detail changes | open; content re-presented; the SVG untouched |
| open | width crosses 900 px, a chart expands | open; pane ↔ dialog |
| open | view or theme changes (the element is redrawn or removed) | closed |
| open | another document, or new content (DocumentView remounts per id and version) | closed |
| expanded + open | Escape | inspector closes; the chart stays expanded |

## Project opening: identity and ordering

The project-opening owner validates through `loadCatalog` and assigns an opaque identity after acceptance and reuses it for the same canonical folder. The server retains at most 128 handles; capacity refuses a new folder; restart expires handles. The URL records that identity, never the filesystem path. Browser project composition remounts catalog, document, search and inspector state per handle. Renderer modules depend only on the injected project-read port.

| # | State / ordering | Event | Result / enforcing evidence |
| --- | --- | --- | --- |
| P1 | no project | first load, no startup project | Welcome; Open project, Copy agent prompt, Browse example (`onboarding`) |
| P2 | welcome / project | absolute path accepted by catalog owner | Handle; navigate to root; title from root metadata (`projects.test`, `onboarding`) |
| P3 | welcome / project | relative, missing, missing state, invalid root | Typed refusal + catalog issues; current handle unchanged (`projects.test`, `onboarding`) |
| P4 | any | foreign host/origin, non-JSON, malformed or >8KiB opening body | Refused before filesystem access (`http.test`, `project-http.test`) |
| P5 | project A, catalog/document/search/inspector pending | open B with colliding doc IDs | A subtree unmounts and reads abort; B starts fresh (`onboarding`) |
| P6 | A then B | Back / Forward | URL handle selects A / B with fresh document state (`onboarding`) |
| P7 | two tabs | each opens a different project | Independent handles and reads (`projects.test`, `onboarding`) |
| P8 | open request pending | edit path, open again, leave page | Abort earlier browser read; only current opening answer navigates (`onboarding`) |
| P9 | selected handle | restart / registry capacity | Expired-project guidance; explicit reopening; capacity refusal preserves live handles (`projects.test`, `onboarding`) |
| P10 | startup configured | valid or invalid project | Resolve default on first load, or welcome with actionable issues (`projects.test`, `onboarding`) |
| P11 | accepted project | source provenance path requested | No raw source route; only catalog documents and built assets (`http.test`) |
| P12 | any project | validate:docs --project path | Same catalog validation; errors nonzero, warnings reported (`projects.test`, CLI verification) |

## Diagram startup profiling

An optional Mermaid preload was measured and reverted: cold loads improved in the initial sample, but warm measurements under concurrent verification were inconclusive. No speed claim or changed rendering/import behavior ships. The dated record is `verification/performance/2026-10-04-startup-experiment.json`; `startup-profile.mjs` records production startup samples. A forced module-abort → reload comparison failed identically in baseline and candidate WebKit (two failed charts, zero page errors), so no recovery refactor was included.

## Native folder picker: states and ordering

The chooser owner is `server/project-opening/folder-picker.ts`; the macOS process adapter uses a fixed AppleScript and no shell. Linux advertises unsupported and keeps path entry. A picker supplies a path; only Open project calls the catalog owner. Paths preserve filename whitespace and backslashes.

| # | State / event | Result / evidence |
| --- | --- | --- |
| F1 | unsupported or capability pending | Browse disabled with an accessible hint; path entry and Open work (`folder-picker.test`, `onboarding`) |
| F2 | available → Browse | One process-wide pending chooser; Browse/Open disabled; field preserved (`folder-picker.test`, `onboarding`) |
| F3 | pending → selected, still current | Fill exact path, clear old form errors, focus field; no catalog read or navigation (`onboarding`, injected outcomes) |
| F4 | pending → cancelled | Preserve field and project; restore controls and field focus (`folder-picker.test`, `onboarding`, injected outcomes) |
| F5 | pending → field edited / form unmount / request disconnect | Abort owned child; invalidate answer; late selection does not fill or navigate (`folder-picker.test`, `onboarding`) |
| F6 | another tab requests while pending | Typed busy refusal; first chooser retained (`folder-picker.test`, `onboarding`) |
| F7 | pending → timeout (120 s) / spawn or protocol failure | Kill owned process on timeout; release ownership; typed error supports retry and path entry (`folder-picker.test`, `onboarding`) |
| F8 | picker POST rejected origin/host/media/body | Reject before chooser spawn (`project-http.test`) |
| F10 | server shuts down while chooser pending | Composition aborts chooser; HTTP server waits for child cleanup/response before exit (`folder-picker.test`) |
| F9 | adapter returns selected path with spaces/Unicode/filename newline | Remove output terminator only; preserve filename; Open validates through shared path/catalog owner (`folder-picker.test`, `onboarding`, injected outcomes) |

Project switching is in Settings › General › Project, titled by the catalog root; the sidebar footer contains only Settings. Welcome has no redundant sidebar instruction (`onboarding`, `settings`).

| Sidebar state | Footer layout / evidence |
| --- | --- |
| Welcome or loaded project, desktop docked or mobile drawer open | Settings is the sole footer link and the footer bottom equals the sidebar bottom (within2px); no placeholder filler (`project-layout`) |

## Development proxy admission

Vite listens on loopback5173 with strictPort; its target is the existing PORT interpretation. `scripts/development/project-proxy.ts` calls the production opening guard against the original frontend Host/Origin/media before proxy/body reading. Refused calls are not forwarded. Accepted opening and picker calls have Host and Origin rewritten to the fixed loopback API target; Node retains body/semantic ownership (`project-proxy.test`).

### Pending manual macOS checks

These checks have not been completed. Native initiation was observed separately;
headless journeys inject adapter outcomes and never open an OS dialog.

| Planned physical UI check | Status |
| --- | --- |
| Browse displays the native macOS chooser and selecting a folder containing spaces and Unicode fills the exact path and focuses the field; Open validates it | Unverified |
| Cancelling the native chooser preserves the field and current project and restores field focus | Unverified |

## Release review repair states

| # | State / event | Result / focused evidence |
| --- | --- | --- |
| P13 | Handle h owns A; a different accepted root B mints h | Typed project-id-conflict refusal; A/current/default/capacity remain unchanged; later fresh identity can open B (`projects.test`) |
| P14 | Explicit requested handle A; current handshake reports opened B | Refuse before reader/title application; matching A remains valid; null discovery may select B; abandoned replies remain ignored (`selection.test`, release-recovery) |
| P15 | Catalog/document/search headers succeed; body rejects or JSON is malformed | Typed failed result and retry recovery; deliberate abort remains rejection and cannot become visible failure (`api.test`, release-recovery) |
| P16 | Accepted prose hrefs and diagram node aliases are `__proto__`, `constructor` or ordinary names | Every relationship remains an own property through response JSON and inspector adaptation; Details/inspector links and diagram drilldown preserve the selected project (`responses.test`, reserved-links) |
| FS1 | Accepted canonical state boundary; persistent root/nested ancestor swap | Refuse observed outside canonical candidate, no accepted external content (`files.test`) |
| FS2 | Inside pre/post path; intervening open captures different inode | Expected/open dev+ino mismatch refused before allocation/read (`files.test`) |
| FS3 | File replaced after opening/reading | Post canonical path/containment and identity must match same handle; otherwise refuse (`files.test`) |
| FS4 | Unchanged ordinary/space/Unicode candidate | Read bounded regular file and close handle (`files.test`) |
| FS5 | Final-component symlink, nonregular or oversized opened object | Refuse; no unbounded allocation; every opened handle closes (`files.test`) |

Filesystem checks reject observed path/identity changes; Node pathname operations do not establish an atomic document snapshot or a universal guarantee against coordinated hostile ABA races.

Source checkpoints (`source-revision.mjs`): at 1440px and 390px the header displays the page's short reviewed commit, activates provenance with its full exact ID, and causes no viewport overflow. A child without a checkpoint displays explicit unknown provenance instead of inheriting its root's commit. Both states survive navigation without page errors.
