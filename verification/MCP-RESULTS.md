# Local MCP Apps verification — 2026-10-31

Implemented in an isolated clone of `nessalabs/nessa-docs`, based on main
`c0bc062`. Existing local checkouts were not modified. Current open Docs PRs
#2–#5 were inspected for overlapping work. Extension packages were checked on
GitHub main because the laptop's extension checkout was behind it.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass (client/shared/server) |
| `npm test` | 188 tests pass across 24 files |
| `npm run build` | Pass for standalone client, embedded HTML and server |
| `node verification/mcp-protocol.mjs` | Pass: real official SDK stdio client; create/read/show, negotiation, errors, conflict, resource/CSP, text fallback |
| `npm run verify:mcp` | Pass: protocol plus Chromium/WebKit sandboxed UI journeys |
| `npm run verify:browser` | Pass: 1,138/1,138 available fixture checks across 20 engine/script results |
| Official MCP Inspector CLI `tools/list --strict` | 0 errors, 0 portability warnings; nullable schema types use equivalent anyOf branches |
| `npm audit` | 0 vulnerabilities after compatible dependency updates |
| `git diff --check` | Pass |

The repository has no separate lint script. Vite emits existing future
config-loader warnings about extensionless imports; these are not failures.
The initial test run lacked sandbox loopback permission; the authorized rerun
passed. No automatic approval rejection remains outstanding.

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
and malformed/unsafe renderer payloads.

Generated evidence (ignored from Git, retained in this task checkout):

- `verification/results/mcp-browser.json`
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
The 5.8 MB HTML payload also needs testing against actual host limits.

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
No GitHub issue/PR, push, merge, approval or deployment was performed.

Exact host transports, read-only configuration findings, pending setup actions,
payload-bound evidence and a minimal durable-storage design are recorded in
[host integration](../docs/host-integration.md).
