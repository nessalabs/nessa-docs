---
id: work-lifecycle
title: Work lifecycle
kind: statechart
status: implemented
summary: Every page and task is in one of eight states, and only listed events move it.
parent: track-work
sources:
  - skills/nessa-docs/references/lifecycle.json
  - shared/lifecycle.ts
  - server/work.ts
sourceRevision: "c02ec15ba90462875ecdf673351211caed7e00ff"
diagramLinks: {}
model:
  spec: tla/track-work/WorkLifecycle.tla
  config: tla/track-work/WorkLifecycle.cfg
  steps:
    Init: Start with the page and both tasks in draft.
    Accept: The person accepts the plan.
    Start: An agent starts a task.
    Ask: An agent asks a question and the task waits.
    Answer: The person answers.
    Submit: An agent submits the task for review.
    Rework: Review sends the task back.
    Merge: The task is merged with a commit.
    Reopen: A finished task is opened again.
    DropTask: A task is dropped.
    DropPage: The page is dropped.
    Stamp: The page is stamped with a newer sourceRevision.
    Check: The rule check runs at the page's stamp.
    Verify: The page is verified.
diagramDetails:
  - diagram: 0
    node: blocked
    section: Blocked always carries a question
  - diagram: 0
    edge: { from: review, to: implemented, label: "merge [commit]" }
    section: A page follows its tasks
modelCheck:
  sourceRevision: "c02ec15ba90462875ecdf673351211caed7e00ff"
  checker: tlc-1.7.4
  date: 2026-11-10T08:29:15.587Z
  config: tla/track-work/WorkLifecycle.cfg
  modelDigest: 2b4c2b6d75fab213f8784c9d582a6226c6b3ff368ef2cd544af12865967d6b7d
  states: 993
  held:
    - TypeOK
    - NeverFinishedWithOpenTask
    - ImplementedHasCommit
    - VerifiedNamesStamp
    - NoWorkBeforeAccept
  broke: []
  unchecked: []
---
# Work lifecycle

Every chart page and every task is in exactly one of these states. The list is
fixed and ships with Nessa Docs in
[lifecycle.json](../../../skills/nessa-docs/references/lifecycle.json), so each
word means the same thing in every project and for every agent. The validator,
the reader and the skill all read that one file.

```mermaid card=lifecycle title="Lifecycle of a page or task"
stateDiagram-v2
    [*] --> draft
    draft --> planned: accept (person)
    planned --> working: start
    working --> blocked: ask [question]
    blocked --> working: answer (person)
    working --> review: submit [evidence]
    review --> working: rework
    review --> implemented: merge [commit]
    implemented --> verified: verify [rule check held]
    implemented --> working: reopen
    verified --> working: reopen
    draft --> dropped: drop [reason]
    planned --> dropped: drop [reason]
    working --> dropped: drop [reason]
    review --> dropped: drop [reason]
    class draft start
    class working working
    class blocked waiting
    class review waiting
    class implemented done
    class verified done
    class dropped ended
```

A `note` event keeps the current state. It is for something worth saying that
does not change where the work is.

One more state is never written, only shown: **stale**. A page that is
implemented or verified turns stale when one of its `sources` changed after its
`sourceRevision`. Open work is never stale.

## Blocked always carries a question

`ask` needs the question in the record's body, with the options and a
recommendation. Only a person listed under `work.people` in `nessa-docs.yaml`
may `answer`, and so `accept`. A file cannot prove who wrote it, so this is a
promise the project keeps, not something the reader can check.

## A page follows its tasks

A page with tasks takes its state from them. Its own records may only accept,
drop, verify or note it, so it is never ahead of its tasks:

- It is `review` only when every task that is not dropped is in review or
  finished.
- It is `implemented` only when every task that is not dropped is implemented.
- It is `verified` only while its saved rule check is fresh and names the same
  commit as its `sourceRevision`. Restamping the page without checking again
  takes `verified` away.

A page with no tasks moves on its own records.

## Rules the model checks

The model is one page with two tasks, replayed the way the code replays records.
It checks that a page is never finished while a task is open, that nothing is
implemented without a commit, that verified always names the page's stamp, and
that no task is worked on before the plan is accepted. A task may be dropped
from the draft. The model checks the design, not the code.
