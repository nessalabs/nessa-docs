# Nessa Docs for Claude

Nessa Docs keeps a map of how a project works beside its code: a system
overview in `docs/state/README.md`, a page for each service, and statecharts for
the flows and lifecycles that matter. The pages are plain Markdown with Mermaid
diagrams, so they read well on GitHub, in any editor, and in the
[Nessa Docs reader](https://github.com/nessalabs/nessa-docs).

This plugin teaches Claude to write and maintain those pages from the project's
real source, in the format the reader expects.

## What it adds

| Part | What it does |
| --- | --- |
| `nessa-docs` skill | Writes and updates `docs/state`: finds the real behavior in the code, picks the right diagram, records the commit each page was checked against, tracks work on the page it changes, and runs the checks. |
| `map-implicit-states` skill | Finds states a program is in but never names (flags and nullable fields that change together) and writes them as statecharts with the gaps they reveal. |
| `/nessa-docs:map [focus]` | Maps the whole system, or one service, flow or entity. |
| `/nessa-docs:refresh [scope]` | Brings pages up to date with the code changed since each page was last checked. |

Claude also picks up the skills on its own when you ask it to document a
service, explain a lifecycle, or map a flow.

## Use it

Install from this repository's marketplace in Claude Code:

```text
/plugin marketplace add nessalabs/nessa-docs
/plugin install nessa-docs@nessa-docs
```

Then ask, for example:

> /nessa-docs:map checkout flow

or

> Map the states a subscription can be in, using nessa-docs.

To see the charts drawn and click through them, open the project in the Nessa
Docs reader (`npm start` in a checkout of
[nessalabs/nessa-docs](https://github.com/nessalabs/nessa-docs), then **Open
project**), or install its browser extension to read `docs/state` folders on
GitHub. The plugin does not install or start the reader.

## What it runs and sends

The plugin is instructions only. It has no MCP server, hooks or scripts, and it
sends nothing anywhere. Following the skills, Claude reads your source, writes
Markdown under `docs/state`, and runs local commands you can see and approve:
`git` to read the current commit and what changed since a page was checked, and,
when you have a Nessa Docs checkout, its `npm run validate:docs` check. Any data
Claude handles goes only where your Claude session already sends it.

## License

MIT. See [LICENSE](LICENSE).
