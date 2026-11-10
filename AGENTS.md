# Working on Nessa Docs

Nessa Docs reads `docs/state` Markdown from a chosen local project. Its optional
MCP server accepts complete document bundles and serves the same explorer to
compatible MCP Apps hosts. The browser and MCP server are separate adapters;
neither should execute the behavior described by a diagram.

## Setup

Use Node.js 22.13+ within 22.x, 24.x, or 26+.

```sh
npm ci
npm run build
npm start
```

The local browser opens at `http://127.0.0.1:4311`. Choose **Browse example**
for the included store project. For development, run `npm run dev:api` and
`npm run dev:client` in separate terminals.

## Where to work

- `skills/nessa-docs/` owns the authoring method and
  [file format](skills/nessa-docs/references/format.md).
- `server/` validates pages, links, and project boundaries; `src/` renders the
  local browser.
- `server/mcp/`, `shared/mcp*`, and `src/mcp/` own the MCP bundle, protocol,
  and embedded explorer. Memory mode is the default; durable storage is opt-in.
- `examples/` and `fixtures/` are synthetic inputs. Use these for UI and MCP
  verification, not someone else's documents.

Read [the architecture](docs/architecture.md) before moving a boundary or
sharing state between the standalone browser and MCP adapter. The MCP tools do
not select source-project paths; the host or agent supplies authored Markdown.

## Custom views: cards, roles and reference pills

A project shapes how its pages look through one file, `docs/state/nessa-docs.yaml`.
Everything below follows from that file; there is no second place to configure
a view. The [format reference](skills/nessa-docs/references/format.md#project-config)
owns the file's fields. Read it before changing anything here.

**When an agent writing docs needs a new view, use config first.** Most needs
are covered without code:

- A reference that should be clickable (`ADR-202`, `RFC-7`, `nessa-agent#1234`,
  `[[page-id]]`): add an entry under `references` with a `match` pattern and
  `open` targets. Point `notes` at the folder that holds the notes so the peek
  can show them.
- A diagram that needs its own name and label (`pairing`, `release`): add it
  under `cards` with one of the existing looks.
- A state that needs a meaning: tag it with one of the fixed roles in Mermaid
  (`class Pending waiting`). Do not add roles: a colour must mean the same on
  every page.

**When config is not enough, add a look in code.** A look is how a card draws.
To add one, change these together and nothing else:

1. `shared/api.ts`: add it to `CardStyle['look']`.
2. `server/project-config.ts`: add it to `LOOK_FAMILY` with the chart family it
   suits, and to `BUILT_IN_CARDS` if it should exist without config.
3. `shared/cards.ts`: if the look changes what Mermaid draws (as `handoff`
   adds `autonumber`), do it in `drawnSource`, the one place both the reader
   and the MCP explorer call.
4. `src/diagram.tsx` (`CardHeader`, `CARD_ICONS`) and `src/styles.css` for its
   header and styling. Style through `data-card-look`, never by editing the
   SVG Mermaid returns.
5. `shared/mcp-payload.ts`: add it to the `look` enum so bundles carry it.
6. The format reference table, and a test in `server/project-config.test.ts`.

A new kind of reference target (beyond `document`, `file` and `url`) goes in
`server/project-config.ts` (`openTarget`) and `server/references.ts`
(`tryTarget`), with its reason strings for when it does not resolve. Targets
are templates, never code a project supplies: opening a folder must never run
that folder's code.

**Keep it fast.** Pages are re-read on every request, so:

- Lex Markdown only through `lexMarkdown` (shared/markdown.ts). It is cached by
  body text; treat the tokens it returns as read-only.
- Text for pills is visited only by `forEachReferenceText` on the server and
  the matching branch of `src/markdown.tsx` in the browser. Both split with
  `splitReferences`, so their keys always agree. Do not add a second matcher.
- Resolve on the server, once per distinct match per page, and share folder
  listings and note reads within a request (`Scratch` in server/references.ts).
  The browser looks pills up by key and never builds a link.
- Patterns are compiled once (`compileRule`), and slow pattern shapes are
  refused at config time rather than timed out at read time.
- `server/references.test.ts` and `shared/references.test.ts` hold the speed
  checks (2,000 references per page, a megabyte of text). Keep them passing
  when you touch this path, and profile with a few hundred generated pages
  before claiming a change is fast.

## Checks

Run `npm run typecheck`, `npm test`, and `npm run build` for code changes. Run
`npm run verify:mcp` when changing MCP protocol or UI behavior. Run
`npm run verify:durable` when changing storage or bundle publication. The
[browser checklist](verification/CHECKLIST.md) covers standalone UI changes.
Generated `dist/` and `verification/results/` output is not source.

Describe host evidence precisely. A local browser harness proves rendering and
interaction in that harness; a Codex tool call proves the tool result. Neither
alone proves that a ChatGPT desktop conversation opened an MCP right-panel tab.
Keep the [right-panel plan](docs/mcp-right-panel-plan.md) current as that host
check progresses.
