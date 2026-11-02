---
id: attachment
title: Close an attachment
kind: statechart
status: fixture
summary: An open attachment can be closed. A write after close is refused.
parent: broken-attachment
sources: []
diagramLinks: {}
sourceRevision: "a155e093d0ac65d7d98c945b99db72a945320a2a"
model:
  spec: tla/attachment.tla
  config: tla/attachment.cfg
  steps:
    Init: Start with the attachment open.
    Close: Close the attachment.
    Write: Write bytes.
    Done: The attachment stays closed.
modelCheck:
  sourceRevision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  checker: tlc-1.7.4
  date: "2026-11-02T08:36:00.000Z"
  config: tla/attachment.cfg
  modelDigest: "44162c763a7f69386b7292f3d4f027f5792c95fb555e85655e16ceb040dfc56d"
  states: 3
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
---

# Close an attachment

An open attachment can be closed. Writing is allowed only while it is open.
This copy of the model has the write guard removed, so the saved check shows
the rule that broke. This checks the design, not the code.

```mermaid
stateDiagram-v2
    [*] --> Open
    Open --> Closed: Close
    Open --> Open: Write
    Closed --> Closed: Stays closed
```
