---
name: nessa-docs
description: Build or maintain a browsable system map and high-level statecharts in a project's docs/state Markdown, grounded in its current source. Use when documenting services, user flows, lifecycle decisions, or preparing a project for the Nessa Docs browser.
---

# Nessa Docs

Help a newcomer understand what a project does, which part owns each step,
and why an action succeeds or fails. Write the documentation in the user's
repository. Nessa Docs renders it; it does not run the modeled system.

Read [the file format](references/format.md) before authoring files. That
reference owns the metadata and diagram-binding contract. The skill is usable
without the website and does not require other skills or a particular agent.

## Find the real behavior

Read the project's working instructions, entry points and existing feature
documentation. Follow the code and relevant tests for the behavior you describe.
For a full-project request, inventory the services, their responsibilities,
important user goals and stateful entities before writing. For a narrow request,
update the existing owning page rather than generating another atlas.

Distinguish implemented behavior, examples, proposals and things you could not
verify. Reading a test is evidence of its intent, not a claim that it passed.
Name concrete gaps, their effect, and the evidence still needed. Do not invent
a lifecycle for immutable values or claim external behavior you could not inspect.
An immutable record can still have an explicit status. In that case a chart may
describe the returned status changes; say that calls return a new value and name
who saves it, rather than implying the original value changes in place.

## Retain the source checkpoint

Record `sourceRevision` in each state page reviewed, following the
[file format](references/format.md#source-review-checkpoint). Use the documented
repository's exact committed source revision, obtained with `git rev-parse HEAD`
(or the exact base checked when source and docs share a working branch). A dirty
implementation is not represented by HEAD alone: commit the source first or keep
the prior checkpoint and describe the uncommitted scope explicitly.

Read the existing checkpoint before refreshing a page. Compare the relevant
source changes since that revision, then trace the current owning code and tests;
a diff alone is not proof the explanation is correct. Advance only pages whose
behavior was reviewed. Do not stamp an entire atlas after a partial audit, inherit
a root revision onto children, substitute the renderer's commit, or imply a
checkpoint is executed test evidence. Leave unknown historical checkpoints
absent until verified. Record review scope, validation and exclusions in prose.

## Organize the map

Put the system entry in `docs/state/README.md`. For larger projects, group
services under `services/`, with an owning README and useful feature and flow
pages beneath it. Shared libraries can use the same hierarchy. Keep
cross-service explanations with the owner of that interaction and link the
other owners.

Let readers move from the system map to a relevant user goal and its state or
decision explanation. Larger projects can add service and feature levels between
them. Stable IDs and `parent` metadata connect those levels. A document
can serve several user goals without duplicating its lifecycle. Keep one useful
flow index when a feature needs one. Retain unrelated project documentation; replacing it
requires the user's request and preserved evidence links.

Scale the hierarchy to the project. A small module may need only an overview
and one lifecycle page. Add service or feature indexes when they group useful
choices; do not create a chain of pages with just one destination each. Keep
closely related decisions together when separate pages would add navigation
without helping the reader.

## Choose the diagram

- A component map shows parts that exist together. Its arrows describe their
  relationships, not a sequence of exclusive states.
- A statechart follows one entity or operation. Name its owner, entry, meaningful
  states, events, conditions and important refusal or uncertain outcomes.
- A small sequence explains who hands work to whom and in what order. Use it
  when it makes an explanation easier to follow, not on every page.
- A contract page explains a value or rule that has no runtime lifecycle.

Apply [Harel's statechart ideas](https://www.state-machine.com/doc/Harel87.pdf)
where the actual system supports them. Nested states refine an outer state;
shared outer transitions avoid repetition. Concurrent regions describe facts
that coexist, with explicit coordination. History means returning to a prior
configuration; say what is remembered, where, and for how long. Mermaid supports
only part of this notation. Do not promise resume or persistence from a history
symbol, or completion or erasure from a final marker alone.

Read the project's `docs/state/nessa-docs.yaml` before choosing a card or
writing a reference. Name a card on the Mermaid fence (`card=lifecycle`,
`card=handoff`, `card=map`, or one the project defines) and tag states with the
fixed roles, as [the format](references/format.md#diagram-cards-and-state-roles)
describes. Write references in the form the project's patterns expect, such as
`ADR-202`, so they become clickable; never invent a pattern in prose that the
config does not define.

Keep accepted work, performed effects, acknowledgements and completed cleanup
distinct when the code does. Do not force independent lifecycles into one large
application state. Avoid a box for every function or field. Use
`event [condition] / action` on state arrows when those parts matter.

## Track work

Track non-trivial work on the page it changes, so the person sees progress on
the chart itself. The plan is a `work` block on that page. Progress is one new
record file per change of state, committed with the code. The states and the
moves between them are fixed by [lifecycle.json](references/lifecycle.json);
[the format](references/format.md#tracking-work) owns the fields.

1. **Plan when it is worth it.** Work that takes more than one change gets a
   `work` block on the owning page, or a draft page of its own. A one-line fix
   does not.
2. **Anchor, don't invent.** Each task points at a box or arrow that already
   exists in the page's chart. If it does not exist yet, add it to the chart
   first, as the design you are building.
3. **Read the records first.** At the start of a session, read
   `docs/state/work/<page>/` and carry on from the newest record of each task,
   even when another agent wrote it.
4. **Add, never edit.** Each change of state is a new file. Fix a wrong record
   with a newer one. Never edit or delete an old record.
5. **Write on a change of state, not on every step.** Use `note` only when
   something worth knowing landed without moving the task.
6. **Only a person accepts or answers.** `accept` and `answer` are the
   person's moves. Write one only to record what the person said, with their
   words in the body, and never with a `model`.
7. **Blocked means a question.** An `ask` record's body is the question, the
   options and your recommendation.
8. **Finished means evidence.** `submit` names the PR or diff; `merge` names the
   commit that landed. Stamp the page's `sourceRevision` as usual when the work
   lands.
9. **Check and commit together.** Run `validate:docs`. A refused record is an
   error that names the rule it broke. Commit the records on the same branch as
   the code they describe.

## Write for the first reader

Write in simple technical English: familiar verbs, explicit actors and one
consistent name for each thing. Explain a necessary technical term at first use;
do not replace a precise condition with a vague promise. Lead with the person's
task, the result they can observe, and which part owns it. Put implementation
mechanics and model details after that explanation.

For a lifecycle or operation, follow one concrete example from entry to outcome.
Explain what can fail, what may already have changed when an error returns, who
still owns unfinished work, and what the caller can safely do next. If recovery
is not implemented or has not been reviewed, say so; do not invent a retry recipe.
Trace the actual entry point and composition before presenting a helper or a
standalone API as a feature available in the app.

Use short connected paragraphs. No em dashes, slogans, filler or invented jargon.
Use a table to compare outcomes, and steps only for a real procedure. Keep code
symbols and test inventories out of the opening; add exact names and source links
where readers need them to act. A diagram must carry its important failure and
retry conditions, or clearly name the portion of the behavior it leaves out.
Do not replace a wall of prose with a wall of boxes.

Use `diagramLinks` for drill-down and `diagramDetails` for explanations in the
owning Markdown. Each clickable explanation should make sense on its own: what
happened, what allows the next step, and what remains uncertain. Full detail
shows authored content; it does not launch agents or write files.

For a new atlas or substantial refresh, follow
[the reader-quality review](references/reader-quality.md) before completion.
Test whether someone can use the docs, then check the simplified account against
source. For a narrow edit, apply the same checks to the affected explanation.
Page counts, model passes and rendering checks do not establish readability.

## Require adversarial model verification

TLA+ models remain optional. Every run that creates or changes a model, refreshes
its source mapping, or reports model verification must follow
[the model review procedure](references/model-review.md). For every model in
that scope, require source-grounded adversarial review, a passing unmodified
baseline, and reproducible negative controls that break the expected semantic
rules. A full-atlas verification includes every linked model; a narrow update
includes affected models and shared owners, with exclusions stated explicitly.
Do not reuse old receipts as evidence that these checks ran this time.

Resolve review findings and rerun affected checks after fixes. Missing review,
missing controls, unexpected mutant passes, or unfinished checks mean verification
is incomplete. Report the gap rather than claim completion. A passing TLC result
alone does not satisfy this requirement or prove the implementation correct.

## Check and open

Check stable IDs, parents, relative links, headings, Mermaid syntax and diagram
targets. If the local Nessa Docs checkout is available, run its catalog check:

```sh
npm run --silent validate:docs -- --project /absolute/project/path
```

Run it from the renderer checkout, not the documented project. It prints JSON
and returns a nonzero exit code for an invalid catalog. Open the project in the
app to inspect charts and Settings → Health when a browser is available. Without
a browser, report that visual appearance and interaction were not checked.
A syntactically valid chart still needs a behavior check against its source.
Report exclusions.

To open the project, start the separate renderer with `npm start` after its
dependencies and build are ready, then use Open project with the absolute project
folder. A configured start can use
`NESSA_DOCS_PROJECT=/absolute/project/path npm start`. If the renderer is not
installed, direct the user to [nessalabs/nessa-docs](https://github.com/nessalabs/nessa-docs)
and its setup instructions. Do not imply that installing this skill also installs
or starts the app, or that a Codex extension is already available.

## When the host offers Nessa Docs MCP tools

Keep the same document format. Use `replace_docs` with a complete bundle of
`{ path, markdown }` files and `expectedRevision: 0` for an empty bundle, then
`show_docs` to open its explorer. For updates, read `read_docs`, reconcile its
`snapshot.files`, and replace using that snapshot's revision. Never silently
retry a conflict by overwriting a newer revision. Memory mode is session-only. If the operator selected `NESSA_DOCS_STORE` at
startup, generated Markdown is saved only under that dedicated store and survives
restart. Read `read_docs` after reconnecting; a saved revision does not reset to
zero. A save-unconfirmed error may have committed, so read/reconcile before
retrying. Managed generation paths are standalone snapshots with bounded
retention; read for the latest path before opening. Tools never choose arbitrary
paths, write into a source project's docs/state or read source files. State which
content is synthetic/proposed and which source you actually verified.

Call `read_config` before writing pages. It returns the project config, the
cards and state roles a page may use, and the reference patterns. Include
`docs/state/nessa-docs.yaml` in the bundle as `{ path, text }` when the project
has one; a bundle with an invalid config is refused. Pass `text` to
`read_config` to check a draft config without saving it.
