---
id: sdk
title: SDK
kind: feature
status: fixture
summary: A small client surface. Attachment close is the flow with a rule model.
parent: services
sources: []
diagramLinks:
  Attachment: attachment
---

# SDK

```mermaid
flowchart LR
    Caller[Caller] --> Attachment[Attachment]
```

Attachment is the SDK flow that can be closed, and then must refuse writes.
