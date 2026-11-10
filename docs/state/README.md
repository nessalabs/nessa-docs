---
id: nessa-docs
title: Nessa Docs
kind: system
status: implemented
summary: Nessa Docs reads a project's docs/state Markdown and draws it as pages, charts and the work in progress.
parent: null
sources:
  - server/catalog.ts
  - src/app.tsx
diagramLinks:
  Work: track-work
---

# Nessa Docs

Nessa Docs reads the Markdown under a project's `docs/state` folder and shows it
as a map of pages with charts. It never runs the system a chart describes.

These pages describe Nessa Docs itself. Most of how it works is in
[the architecture](../architecture.md). The pages here cover the parts that are
easiest to follow as a chart.

```mermaid card=map title="What Nessa Docs reads"
flowchart LR
    Pages[Pages in docs/state] --> Catalog[Catalog and Health]
    Work[Work records in docs/state/work] --> Catalog
    Catalog --> Reader[Reader and MCP explorer]
```

- [Track work on a chart](track-work/README.md): how agents record progress, and how
  the reader shows it.
