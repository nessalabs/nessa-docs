---
id: track-work
title: Track work on a chart
kind: feature
status: mixed
summary: The plan is a page's work block; progress is one record file per change, replayed through the lifecycle.
parent: nessa-docs
sources:
  - server/work.ts
  - shared/lifecycle.ts
  - skills/nessa-docs/references/lifecycle.json
  - src/work-view.tsx
diagramLinks:
  Replay: work-lifecycle
work:
  - id: record-format
    title: Read record files and refuse bad ones in Health
    anchor: { diagram: 0, node: Records }
  - id: lifecycle-replay
    title: Replay records through the lifecycle file
    anchor: { diagram: 0, node: Replay }
    dependsOn: [record-format]
  - id: reader
    title: Draw task states on boxes, the sidebar and a Work tab
    anchor: { diagram: 0, node: Reader }
    dependsOn: [lifecycle-replay]
  - id: skill
    title: Teach agents to plan and record work
    anchor: { diagram: 0, node: Plan }
---

# Track work on a chart

Agents record progress as plain files in the repository. Nessa Docs only reads
those files and draws them. Nothing here needs the app to be open, and nothing
depends on which agent wrote a record or whether it is still running.

This page is itself tracked this way: its `work` block is the plan for building
the feature, and its records are in `docs/state/work/track-work/`.

```mermaid card=map title="From plan to reader"
flowchart LR
    Plan[Plan: work block on a page] --> Records[Records: one file per change]
    Records --> Replay[Replay through the lifecycle]
    Replay --> Reader[Reader: boxes, pill, Work tab]
    Replay --> Health[Health: refused records]
```

## The plan

A page lists its tasks in a `work` block. Each task points at the box or arrow
it makes real, using the same `node` or `edge` form as `diagramDetails`. The
person reviews the plan like any other change to the page.

## The records

Each change of a task's state is a new file under
`docs/state/work/<page>/<task>/`. A record names the event (`start`, `submit`,
`merge` and so on), the state it leads to, when, and who wrote it. It is never
edited. A mistake is fixed by a newer record.

## The replay

Nessa Docs reads every record for a page, oldest first, and replays them
through [the lifecycle](work-lifecycle.md). A record whose event is not allowed
from the current state, or that lacks what the event needs, is refused. Health
lists it, and it does not move the box. The state the reader shows is worked
out from the records on every read. It is never saved anywhere else.

## What is built and what is not

Built: the lifecycle file, reading and checking records, the replay, the
reader's Work tab, box outlines and sidebar pill, the `stale` and quiet marks,
and the skill's "Track work" section. Not built: reading records from other
branches, and folding a finished task's records into one summary.
