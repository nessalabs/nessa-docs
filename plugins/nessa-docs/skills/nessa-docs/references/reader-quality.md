# Review whether readers can use the docs

Use this review for a new atlas or substantial refresh. For a narrow change,
check the affected task and conditions rather than repeating an atlas-wide audit.
The intended reader understands basic software concepts but has not worked on
this codebase. This is simple technical English, not a formal controlled-language
certification or a requirement to remove useful technical detail.

## Draft around a task

At the root, explain what the project does, who uses it, its main boundaries and
where to start for common goals. Organize navigation around those goals as well
as the source owners. Link to an owner's explanation rather than repeating it.
Use short task-oriented titles in frontmatter as well as headings: navigation
may show only the title. Connect useful component-map nodes to their owners.
A feature inventory must distinguish reachable product behavior, standalone APIs,
examples, proposed work and external systems. A class existing in source does not
prove that the app calls it.

For a substantial operation, give the reader a useful order:

- Start with the task and observable result. Identify the owner and define terms
  needed to understand the next paragraph, rather than opening with internals.
- Walk through a concrete example with actual conditions. Label illustrative
  examples as examples; do not imply they were executed. Keep commands runnable
  only when their prerequisites and effects have been checked.
- Explain normal progress and important alternatives: refusal, cancellation,
  partial success, uncertainty and recovery. Say what remains changed or owned,
  and whether retry is supported. Differentiate requesting a stop from observing
  a stop, and observing an exit from verifying cleanup.
- Put implementation detail, source links and model assumptions after the reader
  understands the behavior. Use the real symbol when it helps locate a boundary.
- Give one clear account of evidence: what ran, against which source, what it
  established and what remains untested. Link historical runs as historical.

These are information needs, not mandatory headings or a fixed page template.
A short contract may need only two paragraphs and a table. A complex lifecycle
may need separate owner pages. Keep detail that changes a decision; remove
repeated disclaimers and lists of model actions that merely duplicate the chart.

Prefer an actor and verb over a pile of nouns. For example, replace “correlated
completion admission” with “The owner accepts the reply only when its request ID
matches the request still waiting.” Retain any additional identity, generation
or timing conditions from the source; the shorter sentence must not erase them.
Use a term consistently across prose, charts and code references. Define a
specialized term locally even when a glossary also exists.

## First pass: a reader uses only the docs

For an atlas, use an independent reviewer or subagent when available. Give them
the root page, intended audience and realistic tasks, without the author's
expected answers or suspected defects. Until their answers are recorded, they
may follow doc links but must not inspect implementation or ask the author for
explanations. This exposes missing explanations instead of letting code knowledge
fill the gaps. If independent review is unavailable, disclose self-review.

Choose tasks from actual product goals and risks. Include an ordinary journey,
a failure or cancellation case, and a handoff between owners where one exists.
For example: “Start a background command, stop waiting, then decide whether it
has ended” or “An import returned an error; decide what may already be saved.”
Do not manufacture a cross-service journey for a small library. When the browser
is available, exercise its normal reading view as well as the Markdown. Check
that a crucial warning is accessible from the chart through `diagramDetails`
or an explicit label; prose hidden in another view cannot silently carry a
misleading terminal state. Record which reading surfaces were inspected.

For each task, have the reviewer record:

- The path followed from the root and the pages used to answer.
- What happens, who owns the next step, and what the reader can safely do next.
- Which sentence supports the answer, and where an answer would require guessing.
- Undefined terms, contradictory statements, misleading diagram states, missing
  prerequisites, or navigation that leads to stale evidence.

An explicit, accurate statement that an operation is unsupported can be a good
answer. An invented procedure cannot. Record concrete failures, not a readability
score or a verdict based on sentence length. This exercise is simulated reader
evidence; it is not a claim that real users were studied.

## Second pass: check technical fidelity

A source-aware reviewer checks the answers and page claims against the actual
entry points, composition, state owners and tests at the recorded revision.
For critical paths, use a separate reviewer from the author when available.

Check that simplifying the explanation preserved authorization, identity,
ordering, timing and platform conditions. In particular, challenge these
potential leaps where relevant:

- A returned error means no effects occurred, or a retry is automatically safe.
- A timeout, cancelled observer or closed client means remote work was undone.
- An API implemented in a helper is wired into the normal app flow.
- A diagram's final state means successful completion or durable cleanup.
- A model pass, test source or mocked adapter establishes real platform behavior.

Review the diagram independently. A crucial boundary hidden in a later prose
paragraph still leaves the chart misleading. Show the boundary or label the
chart's limited scope. Do not add states or recovery steps absent from source.
For evidence, reconcile specific executed checks with general limitations so
they cannot contradict each other. Keep the current result easy to find.

## Fix and retest

Keep a brief review record with tasks, observations, source corrections and
resolutions. Fix the smallest explanation or navigation change that addresses
each issue, then rerun the affected reader tasks and source checks. Stop when
there are no unresolved material misunderstandings, unsupported claims or
missing critical conditions in the reviewed scope. Report remaining exclusions
and avoid claiming that a sample establishes every page's quality.

When improving this skill for a broader rollout, extract reusable guidance from
observed failures rather than embedding project-specific fixes. Test the revised
skill on a different repository or untouched feature with a fresh reader pass.
Give that author the skill and source, not the first pilot's expected prose.
Revise again only for demonstrated failures. Preserve detailed case evidence in
the review report or PR, not in the reusable skill.
