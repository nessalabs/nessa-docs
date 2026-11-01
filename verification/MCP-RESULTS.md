# Local MCP Apps verification — 2026-10-31

Implemented in an isolated clone of `nessalabs/nessa-docs`, based on main
`c0bc062`. Existing local checkouts were not modified. Current open Docs PRs
#2–#5 were inspected for overlapping work. Extension packages were checked on
GitHub main because the laptop's extension checkout was behind it.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass (client/shared/server) |
| `npm test` | 208 tests pass across 25 files |
| `npm run build` | Pass for standalone client, embedded HTML and server |
| `node verification/mcp-protocol.mjs` | Pass: real official SDK stdio client; create/read/show, negotiation, errors, conflict, resource/CSP, text fallback |
| `npm run verify:mcp` | Pass: protocol plus Chromium/WebKit sandboxed UI journeys |
| `npm run verify:durable` | Pass: process restart, second-process lock exclusion, durable updates, standalone CLI and Chromium/WebKit charts after MCP stops, and durable UI journeys |
| `npm run verify:browser` | Pass: 1,138/1,138 available fixture checks across 20 engine/script results |
| Official MCP Inspector CLI `tools/list --strict` | 0 errors, 0 portability warnings; nullable schema types use equivalent anyOf branches |
| `npm audit` | 0 vulnerabilities after compatible dependency updates |
| `git diff --check` | Pass |

The repository has no separate lint script. Vite emits existing future
config-loader warnings about extensionless imports; these are not failures.
The initial test run lacked sandbox loopback permission; the authorized rerun
passed. The later actual-host model test is blocked by its CLI approval policy, as
described below.

The browser harness uses an opaque iframe with only `allow-scripts`, no external
connection/resource/frame domains and no browser permissions. It checks parent
DOM and network denial, document navigation through chart nodes, model-visible
selection context, zoom, details, chart explanations, revision refresh, malicious
HTML/JavaScript links and Mermaid configuration/image labels, refused host links,
stale results, cross-session results and a 390px viewport. Sanitized Mermaid
image elements can remain; tests assert that executable handlers are removed,
no injected script executes and no external responses occur under CSP.

Unit coverage includes closed bundle paths, invalid catalogs, duplicate paths,
byte/file limits, isolated instances, invalid cross-document references,
compare-and-swap races, retained state on failure, cancellation before commit,
and malformed/unsafe renderer payloads. Durable tests additionally cover private
owned stores, exact Unicode/UTF-8 round-trip, restored scope/revision, partial
staging writes, failed rename, rename-after-effect, unconfirmed sync, poisoned
unknown outcomes, cancellation before/after publication, shutdown/rename drain,
corrupt/lost manifests, case aliases, symlinked roots/parents/data, foreign scope,
bounded orphan retention and lock replacement/stale-lock refusal.

Generated evidence (ignored from Git, retained in this task checkout):

- `verification/results/mcp-browser.json`
- `verification/results/mcp-browser-durable.json`
- `verification/results/mcp-durable.json`
- `verification/results/screenshots/mcp-demo-durable-chromium.png`
- `verification/results/screenshots/mcp-demo-durable-webkit.png`
- `verification/results/screenshots/mcp-demo-chromium.png`
- `verification/results/screenshots/mcp-demo-webkit.png`
- `verification/results/screenshots/mcp-chromium.png`
- `verification/results/screenshots/mcp-webkit.png`
- Existing standalone per-engine JSON results in `verification/results/`

The demo screenshot was visually inspected. `examples/mcp/replace-docs.json` is
synthetic input for `replace_docs`. `docs/mcp-app.md` records the design, source
links, tools, state transitions, local host command and remaining boundaries.

Not run: real ChatGPT/Codex/Nessa host installation or UI sessions. No custom
plugin, tunnel, public endpoint, credentials or persistent host config was
created; no trust/security warning was accepted. These actions need a supported,
authorized host connection. This is pending host verification, not a denied or
uncertain deployment. Generic MCP/Inspector success is not proof of those UIs.
The 5.8 MB HTML payload still needs actual-host acceptance testing. The current
published Secure MCP Tunnel bound is 10 MiB for the complete serialized envelope,
not a host UI acceptance guarantee. Platform settings could only be reached as a
sign-in page in the available browser; no organization/workspace tunnel metadata
was read and no login, key provisioning or grant was attempted. Known local
profile/state locations were absent. Codex registration remains pending the
specific user permission asked in the parent thread.

Optional pre-existing atlas and stale-build browser checks were skipped because
no real atlas URL or older build was supplied. All fixture checks ran.

Self-review, the React/accessibility checklist and independent code/security/design
review were completed. The independent reviewer found four P2 issues in the
initial commit: shared explanation selection, missing deeper navigation,
stale refresh selection/context and dropped authored `__proto__` keys. Those
were fixed with Chromium/WebKit regressions. Re-review also caught inherited
special-key lookup in the new dialog action; an own-property guard and a
`constructor` detail-only regression fix it. Stale link-refusal callbacks are
guarded as well. The reviewer independently reran the focused schema/payload
checks (4/4) and reported no remaining blocking findings in the reviewed diff.
The durable-storage review also reproduced a shutdown race where releasing the
lock before a pending rename could let a new writer's cleanup delete the just-
committed generation. Admitted storage work is now drained through publication
and outcome classification before lock release; a deterministic regression
holds rename pending, starts close, verifies a new writer remains excluded, then
reopens the committed revision. Startup signals and nested cleanup are covered.
The reviewer independently reran 31 bundle/durable tests after final Unicode and
partial-write hardening and reported no remaining blocker. No GitHub issue/PR,
push, merge, approval or deployment was performed.

Exact host transports, read-only configuration findings, pending setup actions,
payload-bound evidence and the opt-in durable-storage contract are recorded in
[host integration](../docs/host-integration.md).

A synthetic saved demo remains outside the checkout in this task's owned
`nessa-docs-durable-demo` directory. Its machine-readable location/revision is
`../nessa-docs-durable-demo.json`. The MCP process is stopped and its lock has
been released; no host was registered. This generated sample is not a user's
source project. Its current generation can be opened in the standalone app.

## Actual Codex host follow-up

The approved local `nessa-docs` registration is enabled and memory-only. Fresh
build passed. `codex-cli 0.155.1 app-server` discovered the installed server and
routed create/show/update/read calls, with revisions 1→2 and stale-write rejection.
`verification/codex-host.mjs` records synthetic evidence in
`results/codex-host.json`. This test explicitly does not claim model selection
or UI rendering.

The separate ephemeral model turn selected all three tools. Both writes were
blocked: “MCP tool call requires approval, but approval policy is never”. It
therefore only observed empty-bundle errors; no policy was changed or blocked
write retried. `results/codex-model-host.jsonl` retains the actual tool events.
Desktop MCP Apps inventory had no tabs; actual embedded rendering remains
unverified. See [host integration](../docs/host-integration.md) for the exact
installed command, reproducible runtime harness and remaining host requirements.

## Right-panel descriptor follow-up

The desktop conversation could create and update a synthetic bundle, and
`show_docs` returned revision 2, but the right-side browser tab was the separate
localhost website. MCP Apps inventory had no tabs. The server was then found to
hide its HTML resource and thread entrypoint when a client omitted the Apps
capability during initialization. The earlier Codex `app-server` status showed
`ui: null` and no resources for that path.

The server now advertises the resource and entrypoint unconditionally. The real
SDK stdio protocol check passes with and without the capability, and a fresh
Codex CLI 0.155.1 `app-server` status lists the `show_docs` thread entrypoint
and the `text/html;profile=mcp-app` resource. Synthetic host calls still pass.
The running desktop MCP session has not been reconnected to the rebuilt server.
A repeat `show_docs` returned the existing revision 2 and the MCP Apps tab
inventory remained empty. Separately, MCP app model context arrived with
revision 2, document ID `payment-contract` and view `diagrams`; that confirms
bridge activity but not right-panel placement. The next checks are in
the [right-panel plan](../docs/mcp-right-panel-plan.md).
