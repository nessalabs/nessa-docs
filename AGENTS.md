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
