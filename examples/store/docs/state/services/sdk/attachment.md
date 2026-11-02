---
id: attachment
title: Close an attachment
kind: statechart
status: fixture
summary: An open attachment can be closed. A write after close is refused.
parent: sdk
sources:
  - src/attachment.ts
diagramLinks: {}
sourceRevision: "a155e093d0ac65d7d98c945b99db72a945320a2a"
model:
  spec: tla/services/sdk/attachment.tla
  config: tla/services/sdk/attachment.cfg
  steps:
    Init: Start with the attachment open.
    Close: Close the attachment.
    Write: Write bytes.
    Done: The attachment stays closed.
modelCheck:
  sourceRevision: "a155e093d0ac65d7d98c945b99db72a945320a2a"
  checker: tlc-1.7.4
  date: "2026-11-02T08:36:00.000Z"
  config: tla/services/sdk/attachment.cfg
  modelDigest: "96962243e1da8866ae10071bfada85aad78f766699ca5722c275e5b15a6403dd"
  states: 2
  held:
    - NoWriteAfterClose
    - OnlyOpenOrClosed
  broke: []
  unchecked: []
---

# Close an attachment

An open attachment can be closed. Writing is allowed only while it is open.
Closing does not erase bytes that were already stored. This page is a small
example. The model checks this design, not the code.

```mermaid
stateDiagram-v2
    [*] --> Open
    Open --> Closed: Close
    Open --> Open: Write
    Closed --> Closed: Stays closed
```

## What must always hold

A write never happens after the attachment is closed. The attachment is either
open or closed.
