# nessaDocs

Turn a project's source code into readable system maps and flows, then browse
those maps locally. Your coding agent writes Markdown in your project's
`docs/state`. Nessa Docs renders it with diagrams you can navigate, drag and zoom.

This repository contains the **nessa-docs authoring skill** and the **local web
app**. It works with any project; it does not need the Nessa agent backend.
The current app is a website running on your computer. A Codex extension is a
future integration, not part of this release.

## Start the app

Use Node.js 22.13 or newer within 22.x, 24.x, or 26 and newer, on macOS or Linux.
Native Windows support needs a filesystem adapter and is outside this release.
The recorded browser and local filesystem checks ran on macOS.

```sh
git clone https://github.com/nessalabs/nessa-docs.git
cd nessa-docs
npm ci
npm run build
npm start
```

Open [localhost:4311](http://127.0.0.1:4311). Choose **Browse example** to try the
small store map. On macOS, **Browse…** opens the native folder chooser and fills
the project field. Choose **Open project** to load its documentation. You can
also paste an absolute folder path; Linux uses path entry in this release.
The folder must contain `docs/state/README.md`.

The app reads your local files. It does not upload your project, run your agents,
change documentation or execute the state machines shown in diagrams.

## Install the skill

Copy the skill folder into your coding agent's skill directory. For Codex,
install it in the project where you want to write documentation:

```sh
mkdir -p /path/to/your-project/.agents/skills
cp -R skills/nessa-docs /path/to/your-project/.agents/skills/
```

Run that command from this checkout. Other agents can read
[SKILL.md](skills/nessa-docs/SKILL.md) directly or use their own skill installation
mechanism. Installing the skill does not install or start the web app.

Ask the agent in your project:

> Use $nessa-docs to map this project's system and important user flows in
> docs/state. Read the actual source, explain the main states and decisions in
> plain English, and mark examples, proposals and anything you could not verify.

Start with the parts you need to understand, or ask for a full-project sweep.
Small projects should get a small map. The skill explains how to choose states,
component maps and short sequences without turning the documentation into a code
trace. It also helps update the owning page when behavior changes.

## Browse your project

Open the project in the app after your agent creates its Markdown. Start at the
system map and choose a box with a **+** to open a deeper page or an explanation.
The sidebar is another way to navigate. It resizes up to 350 px.

**Diagrams** shows the page's charts. **Details** shows its complete Markdown,
including short sequences and source references. Drag the diagram surface to
move around; use its zoom and Fit controls to find your place.

**Settings** contains appearance, diagram detail and documentation Health.
To open another project, use **Settings → General → Project**.
Standard shows a short explanation; Full displays the complete authored section.
These choices do not generate content or launch an agent. Sources are collapsed
at the bottom of each page.

Project selection belongs to the page you open. Different projects can use the
same document IDs. A server restart clears open project handles; reopen the folder
if the app says the project is no longer available.

## Authoring and validation

[The format reference](skills/nessa-docs/references/format.md) owns the Markdown
contract: metadata, hierarchy, diagram links and explanation bindings. There is
no separate navigation manifest. The [example project](examples/store) demonstrates
an overview, a lifecycle with explanations, a short sequence and an external
contract. Its source is illustrative, with no real payment provider or database.

The optional per-page [`sourceRevision`](skills/nessa-docs/references/format.md#source-review-checkpoint) records the exact source commit reviewed. Each page shows its checkpoint or explicitly says it is not recorded; Sources and provenance exposes the full ID. Partial refreshes do not make older pages appear current.

Statecharts describe states of one entity or operation. Component maps describe
parts that exist together. Sequences explain useful handoffs. These choices draw
on [Harel's statechart paper](https://www.state-machine.com/doc/Harel87.pdf);
Mermaid is the rendering notation and supports only part of its semantics.
The documentation does not replace the project's runtime logic.

Check a project's documentation without opening a browser:

```sh
npm run --silent validate:docs -- --project /absolute/path/to/your-project
```

The check uses the app's catalog validator and prints JSON with accepted pages
and issues. A missing or invalid system root returns a nonzero exit code. This
checks structure and diagram bindings; it does not prove the described behavior
or replace a visual check.

Optional startup configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NESSA_DOCS_PROJECT` | None | Open this absolute project path on startup |
| `PORT` | `4311` | Local server port; binds to `127.0.0.1` |

For example, on macOS or Linux:

```sh
NESSA_DOCS_PROJECT=/absolute/path/to/your-project npm start
```

## Development

```sh
npm run typecheck
npm test
npm run build
```

For local UI development after building, run the API in one terminal:

```sh
npm run dev:api
```

Run Vite in a second terminal, then open [localhost:5173](http://127.0.0.1:5173):

```sh
npm run dev:client
```

If you change `PORT`, use the same value in both terminals.

For the browser checks, install both engines and run:

```sh
npx playwright install chromium webkit
npm run verify:browser
```

The runner starts temporary local fixture servers. Checks needing the Nessa
atlas or an older build are reported as skipped unless you supply those inputs.
See the verification checklist for those optional checks.

See [package architecture](docs/architecture.md) for module owners and the future
host-integration boundary, and [verification](verification/CHECKLIST.md) for the
browser behavior checked by the local scripts.

The UI uses a small MIT-licensed subset of Nessa UI, included in this repository
so no sibling checkout is needed. See [third-party notices](THIRD_PARTY_NOTICES.md) for its provenance.
This project is MIT licensed.
