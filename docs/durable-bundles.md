# Opt-in durable bundles

Design contract for the local MCP adapter. Memory remains the default. An
operator may supply an absolute `NESSA_DOCS_STORE` path at process startup.
Only this owned directory stores generated bundles; model tools cannot select
paths or open real projects. Synthetic tests use temporary task-owned stores.

## Ownership and commit

A new or empty directory receives a versioned Nessa Docs marker and a persistent
bundle scope. A nonempty directory without that marker is refused. An exclusive
writer lock is acquired before marker initialization and held through admitted
storage work and graceful shutdown draining; a second process fails closed.
Observed symlinks and changed directory identities are refused. The lock is not
automatically stolen after a crash; an operator must confirm the old writer has
stopped before removing a stale lock. These checks do not claim confinement
against coordinated mutation by the same OS user.

Each accepted bundle is written as an immutable UUID generation containing the
existing `docs/state` Markdown layout. Files and directories are synced before
a synced temporary manifest is atomically renamed to `current.json`. The root
directory is synced before durable success is returned. Raw Markdown is the
authority; the catalog is rebuilt with existing validation on restart.

One manifest atomically names current and previous descriptors. It names only a
strict lowercase canonical UUID generation and validated Markdown paths,
with scope, revision, UTF-8 byte lengths and SHA-256 hashes. Restore uses bounded,
no-follow reads and checks identity/containment. Rejected/corrupt input never
becomes a silently empty store. Current and previous generations are retained;
cleanup only touches validated owned generation names and never follows links.

| Phase / failure | Authoritative result |
| --- | --- |
| Validation, file write, sync or manifest preparation fails | Previous committed revision remains |
| Cancellation observed before manifest rename | Previous revision remains |
| Manifest rename succeeds, root sync fails | New revision visible; tool reports unconfirmed durability; read before retry |
| Rename outcome cannot be determined | Owner refuses further access until reopen/recovery |
| Acknowledgement is lost after durable commit | Read the committed revision before retry |
| Restart | Restore scope/revision and validate committed Markdown; ignore incomplete generations |
| Another writer/process | Refused by admission/lock; no overwrite |

The committed generation can be opened as a snapshot project in standalone
Nessa Docs. Only current and previous generations are retained: a browser opened
on an older snapshot is not a live view and may lose that folder after subsequent
updates. Refresh/read_docs for the current path before opening it, or explicitly
copy/export a snapshot to a separately selected project if you need to keep it.
Do not edit managed generation files; integrity validation will reject edits.
The MCP UI/tool output distinguishes memory, saved locally and save-unconfirmed
states. Store mode is process-scoped, not a multi-user or conversation store.

Implementation and tests will hold restart, CAS/concurrency, corruption,
traversal/symlink refusal, injected failures before/after commit, scope isolation,
retention bounds and standalone compatibility. No production host connection,
real document persistence, credentials or public endpoint are part of this work.

## Local use

Memory mode (unchanged default):

```sh
npm run build
node dist/server/server/mcp/main.js
```

Opt-in storage, selected by the operator rather than model input:

```sh
NESSA_DOCS_STORE=/absolute/dedicated/private-store npm run start:mcp
```

The parent of a new store must exist. The store is created with mode 0700;
existing stores must be private and owned by this OS user. Do not point this
setting at a source project. The marker/manifest/data files use mode 0600.
`read_docs` returns storage mode, sync status and the current generation path.
Use that path as `NESSA_DOCS_PROJECT` for the existing standalone app:

```sh
NESSA_DOCS_PROJECT=/private-store/generations/<current-id> npm start
```

After a restart, read before replacing; persisted revision numbers do not reset
to zero. A stale write is rejected. A save-unconfirmed error may have published
the new revision; read/reconcile instead of retrying an old revision blindly.
SIGTERM, SIGINT and stdio close drain admitted storage work before lock release.
SIGKILL, power failure, or a host that kills before draining may leave a stale
lock. Never delete it while a writer may still be active; operator recovery must
first establish that the old process is stopped. The adapter never steals locks.

Current/previous generations plus at most a bounded number of unverified
interrupted generations/manifest temporaries are allowed. Known owned staging
is cleaned safely; excessive or unrecognized leftovers fail closed for operator
recovery. A missing current manifest alongside generation data is corruption,
not a silently empty store. Hash checks and full catalog validation run before
restored state is exposed.

```sh
npm test
npm run verify:mcp
npm run verify:durable
```

`verify:durable` creates its own temporary directory, checks real stdio process
restart and two-process lock exclusion, validates the saved project with the
standalone CLI, and exercises durable UI in Chromium/WebKit. It removes its own
synthetic stores afterwards. It neither configures Codex/ChatGPT nor opens user
source projects. Unit tests inject filesystem write, rename, post-effect and sync
failures, cancellation, shutdown/rename ordering, corrupt paths/hashes/catalogs,
case aliases, symlinks, private-mode violations and foreign/unfinished orphans.
Actual power-loss hardware behavior is not tested.
