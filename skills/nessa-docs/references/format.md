# Repository Markdown format

The local browser reads `docs/state` inside a selected project. Markdown is the
editable source. Generated SVG is a preview, not another document to maintain.

## Files and metadata

One system root lives at `docs/state/README.md`, with `parent: null`. Its ID need
not be `nessa`. All other documents name an existing parent ID. Keep folder
ownership consistent with that hierarchy. For example:

```text
docs/state/README.md
docs/state/services/payments/README.md
docs/state/services/payments/checkout/README.md
docs/state/services/payments/checkout/pay-for-an-order.md
docs/state/services/payments/payment-lifecycle.md
docs/state/gaps.md
```

Every page has YAML frontmatter and ordinary Markdown. Required fields:

```yaml
---
id: payment-lifecycle
title: Payment lifecycle
kind: statechart
status: implemented
summary: A payment can succeed, fail, or need another attempt.
parent: payments
sources:
  - src/payments.ts
diagramLinks: {}
---
```

IDs are stable lowercase kebab-case values. Titles and summaries are nonempty.
The root can use a project-specific title. Each `sources` entry is a project-relative
path; the browser checks existence but does not expose the source file's contents.
Use `[]` when there are no source references. The source remains the place for the
complete implementation.

| Field | Values |
| --- | --- |
| `kind` | `system`, `service`, `feature`, `flow`, `statechart`, `operation`, `contract`, `guide` |
| `status` | `implemented`, `mixed`, `fixture`, `proposed`, `reference` |
| `parent` | Another accepted document ID, or null for the root only |

Use `implemented` for behavior present in the inspected source, `fixture` for
examples or test wiring, and `proposed` for intended behavior that is not built.
Use `mixed` when a page includes more than one of those, and explain which parts.
Use `reference` for a guide or background material. A status is not a claim that
the code was deployed or that tests passed; report verification separately.

Unknown fields, duplicate IDs, missing parents, parent cycles and unresolved
diagram destinations are reported in Health. Folder/parent disagreement is a
warning. Each README owns the folder beneath it; metadata owns navigation. Do not
add a second navigation manifest.

Normal relative Markdown links to another accepted page navigate there. Source
links appear as references. HTML is not executed. A diagram uses a fenced
`mermaid` block. It can contain at most 100,000 UTF-16 code units, including
directives and comments. Split larger models at their actual owners.

## Source review checkpoint

Each page may record `sourceRevision` in its frontmatter:

```yaml
sourceRevision: "aa91831b5331d3461969f6a7be723a6d3325f29b"
```

This is the full lowercase Git commit ID (40 or 64 hexadecimal characters) of
**the documented repository's source reviewed for that page**. Quote it so YAML
keeps an all-numeric ID as text. Branch names, tags and short IDs are refused.
The value is authored evidence; the browser validates its form, not whether the
commit exists or the review was accurate.

The checkpoint lives in the repository being documented, under `docs/state`.
It is not the renderer's revision, the Markdown catalog's content hash, or the
commit that later adds the documentation. Do not use a self-referential future
commit ID. Record the source commit checked before committing the docs.

A page without this field displays “Source revision not recorded.” It does not
inherit a parent's or root's revision. A partial refresh advances only the pages
reviewed; navigation edits alone do not establish a fresh behavior audit. Keep
scope and exclusions in that page or its linked provenance notes. Do not claim
one atlas-wide revision when older pages have not been checked.

To investigate a later failure, read the page's full revision in Sources and
provenance and compare its linked source files at that commit with the failing
checkout. A checkpoint says what was reviewed, not that tests passed or that
newer commits are covered. Update it only after reconciling the page's behavior
against the newer source.

## Optional rule model

A page may link a TLA+ model of its chart. The model is optional. A page
without one is unchanged, and validation does not require a checker.

Keep the model as files under `docs/state/tla/`, mirroring the page path. For
`docs/state/services/sdk/attachment.md`:

```text
docs/state/tla/services/sdk/attachment.tla
docs/state/tla/services/sdk/attachment.cfg
```

Link those files from the page. Paths are relative to `docs/state`, stay inside
`tla/`, and use no `..`. Each spec and each config is linked by exactly one page.
`validate:docs` reports a missing file or a shared file as an error.

```yaml
model:
  spec: tla/services/sdk/attachment.tla
  config: tla/services/sdk/attachment.cfg
  steps:
    Init: Start with the attachment open.
    Close: Close the attachment.
    Write: Write bytes.
```

`steps` is optional. Keys are TLC action names (`Init` is the initial state).
Values are one plain sentence each. The checker uses them for the failing path.
Diagram state ids should match the string values the model assigns (for example
a variable `phase = "Closed"` marks the chart state `Closed`).

The checker writes the last finished result. Do not hand-edit it to claim a
rule held. A model checks the design, not the code.

```yaml
modelCheck:
  sourceRevision: "aa91831b5331d3461969f6a7be723a6d3325f29b"
  checker: tlc-1.7.4
  date: "2026-11-02T08:12:00.000Z"
  config: tla/services/sdk/attachment.cfg
  modelDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  states: 4
  held:
    - OnlyOpenOrClosed
  broke:
    - rule: NoWriteAfterClose
      path:
        - Start with the attachment open.
        - Close the attachment.
        - Write bytes.
      states:
        - Closed
  unchecked: []
```

`sourceRevision`, when present, is quoted and is a full lowercase commit id, the
same form as the page checkpoint. The checker records the page checkpoint it
saw, or the repository `HEAD` when the page has no checkpoint. `checker` is
`tlc-` plus the pinned TLC version. `date` is UTC. `config` is the config path
that was run. `modelDigest` is the SHA-256 of the spec bytes, a NUL, and the
config bytes. `states` is how many distinct states the last finished TLC run
reported. `held`, `broke`, and `unchecked` name TLC invariants and properties.
A broken rule has a plain-language path and the chart states where it failed.
A rule that the bound or the timeout did not finish is `unchecked`, never
`held`.

The chart badge "Rules checked at <short id>" is stale when the page checkpoint
and `modelCheck.sourceRevision` differ, or when the linked files no longer match
`modelDigest`.

## Drill-down

`diagramLinks` maps a Mermaid node ID to an accepted document ID:

```yaml
diagramLinks:
  Payments: payments
```

```mermaid
flowchart LR
    Store[Storefront] --> Payments[Payments]
```

Only mapped nodes navigate. A + marks them. Unmapped nodes stay neutral.

## State and decision explanations

`diagramDetails` is optional. It points to a heading in the same document, rather
than copying text into metadata:

```yaml
diagramDetails:
  - diagram: 0
    node: Pending
    section: Waiting for a reply
  - diagram: 0
    edge:
      from: Pending
      to: Failed
      label: Provider refuses
    section: Payment refused
```

```mermaid
stateDiagram-v2
    [*] --> Pending
    Pending --> Paid: Provider accepts
    Pending --> Failed: Provider refuses
```

```markdown
## Waiting for a reply

The payment request was sent, but the provider has not confirmed its result.
Waiting does not mean the payment succeeded.

## Payment refused

The provider refused this payment. The order remains unpaid. Explain the next
step supported by the actual implementation here.
```

`diagram` is the zero-based Mermaid block index. Select a `node` or an `edge`,
not both. Node IDs, endpoints and labels match the source exactly. `section` is
the exact plain heading text, unique in the document. A section includes its
nested headings and ends at the next heading at the same or higher level.
Headings inside lists or quotes do not define sections.

Bindings support `stateDiagram-v2` and ordinary `flowchart`/`graph` nodes and
plain labeled edges. Sequence messages and subgraph groups do not receive
explanation bindings. Duplicate edges with identical endpoints and labels are
ambiguous. Labels containing HTML, Markdown strings, Mermaid entity codes such
as `#quot;`, or a literal `|` cannot bind. Health reports a failed binding while
the page remains readable.

A node can have both navigation and an explanation. Its inspector shows the
explanation and offers the deeper page. Several elements may share a section.
Sequences in an explanation open in Details rather than creating another canvas
inside the inspector.

Standard shows the opening explanation, at most two blocks before a nested
heading. Full shows the whole authored section. Compact hides labels and notes
visually while preserving access to their explanations. Keep the important
condition and uncertainty in the first short paragraphs.
