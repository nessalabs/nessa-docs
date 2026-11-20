---
description: Bring docs/state pages up to date with the code changed since each page's sourceRevision
argument-hint: "[page id or folder to limit the refresh]"
---

Use the nessa-docs skill to refresh this project's `docs/state` pages.

Limit: $ARGUMENTS

For each page in scope, read its `sourceRevision`, list what changed in the
source it describes since that revision (`git diff <sourceRevision>..HEAD`
over the paths the page cites), and trace the current code and tests. Rewrite
only the explanations and charts that no longer match, and advance
`sourceRevision` only on pages you actually reviewed. Leave pages without a
checkpoint unstamped unless you reviewed them in full.

Finish with the checks the skill describes, then tell me which pages changed,
which were already current, and which you skipped and why.
