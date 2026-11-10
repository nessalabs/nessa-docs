---
name: map-implicit-states
description: "Find the states a program is in but never names (flags, nullable fields and status values that change together) and write them as Nessa Docs statecharts with the gaps they reveal. Use when a module's behaviour depends on combinations of fields, when a bug came from a combination nobody handled, or when asked to map the real lifecycle of an entity."
---

# Map implicit states

An implicit state is one the program is in but no type names. A chat with
`closedAt` set while `pendingTurn` is still present is in some state; the code
just never says which, so nothing owns what happens there. This skill finds
those states and writes them as a statechart, so a person can see every
combination the code allows and which ones nothing handles.

Write the result in the Nessa Docs format. [The nessa-docs skill](../nessa-docs/SKILL.md)
owns how pages are written, checked and opened, and its
[format reference](../nessa-docs/references/format.md) owns the fields, cards
and roles. Read both before writing. Read the project's
`docs/state/nessa-docs.yaml` too, when it has one.

## 1. Find the signals

Pick one entity or operation: a chat, an upload, a lease. Read where it is
created, changed and read. List the fields that decide what happens next:

- booleans and nullable fields set or cleared together (`isOpen`, `closedAt`)
- status fields, strings or numbers compared in branches
- timers, leases, retries and counters that gate a step
- checks repeated in several places (`if (a && !b)` in three files)
- comments such as "this must be set when that is"

A field that never changes after creation is not a state. Leave it out.

## 2. List the combinations

Write each real combination of those signals. A combination the code treats
differently from the others is a state: give it one plain name a reader would
use. Two combinations the code treats the same are one state. Keep the list to
what the code distinguishes, not every value a type allows.

Record, for each state, the exact field values that define it. That table is
the evidence a reader checks against the source.

## 3. Find what moves it

For every write to a signal field, record the function, the event that calls it
and the condition it checks. Each is a transition: `event [condition] / action`.
Note who calls it (a person, a timer, a reply) and whether the caller can see
the result.

## 4. Name the gaps

These are the reason to do this. Look for:

- a combination nothing prevents but nothing handles
- two writers of the same field that do not coordinate
- a state nothing leaves, or one only a restart leaves
- a check of one field standing in for another (`paid` checked where `status`
  decides)

Write each as a finding with source links and the concrete sequence that
reaches it. Do not fix code in the same change; a finding is a claim for the
owner to confirm, ideally by replaying it as a test.

## 5. Write the page

Write a `statechart` page under `docs/state`, in the owning service's folder,
with `sourceRevision` set to the commit you read. On it:

- one `card=lifecycle` chart of the states and transitions you found, each
  state tagged with a role: `waiting`, `working`, `done`, `refused`,
  `uncertain`, `ended` or `start`
- an **Implicit in** table: state, the field values that define it, and where
  the code checks for it
- a **Gaps** section with the findings from step 4
- `diagramDetails` for any state or transition that needs a sentence of
  explanation

Mark the page `implemented` only for what you traced in the source; use
`mixed` when the gaps section describes behaviour you could not confirm.

## Check

Run the nessa-docs checks (`validate:docs`) and open the page. Then reread the
Implicit in table against the source one row at a time: each row must name
fields that exist and values the code really compares.
