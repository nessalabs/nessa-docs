# Nessa Docs in MCP Apps

This adapter adds a transient document explorer to the existing standalone
browser. Nessa Docs is the agent-authored system map/flow browser; its charts
are Mermaid diagrams, not a generic analytics or spreadsheet product.

## Research and design

Checked against current official sources on 2026-10-31:

- [OpenAI UI guide](https://developers.openai.com/plugins/build/chatgpt-ui):
  use `_meta.ui.resourceUri` and the MCP Apps bridge; retain text fallback.
- [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) and
  [SDK](https://apps.extensions.modelcontextprotocol.io/api/): Apps is an
  extension to MCP. Generic MCP support alone does not establish UI support.
  The current official SDK is `@modelcontextprotocol/ext-apps` 2.x, using the
  modular MCP SDK 2.x. Its wire format interoperates with 1.x Apps hosts.
- [OpenAI connection/testing](https://developers.openai.com/plugins/deploy/connect-chatgpt):
  ChatGPT custom MCP servers need a reachable HTTPS endpoint or Secure MCP
  Tunnel, plugin creation/installation and workspace permission. A local stdio
  process alone is not a ChatGPT connection.
- [Nessa extensions](https://github.com/nessalabs/nessa-extensions) already
  targets MCP Apps. The laptop checkout is behind main: its packages are empty,
  but current GitHub main implements `app-shell` (bridge, React binding, fake
  host, build helper) and `server-kit` (tool/view definitions, negotiation,
  stdio and loopback HTTP). Both remain private version 0.0.0 workspace
  packages, bundled by extensions rather than published for independent use.
  This standalone repository therefore uses the official SDK without a sibling
  checkout or private workspace dependency. If this adapter moves into the
  extensions workspace, compose it with those kits rather than duplicate them.
  Current server-kit handles 2025 initialization and 2026-07-28 request-envelope
  negotiation; this slice deliberately negotiates the initialize-based core
  revisions listed below. The gateway hosts extension servers; Nessa Docs
  remains independent of that gateway.

The portable standard is the implementation target. Older `mcp-ui` HTML
resource conventions and OpenAI `window.openai` aliases are unnecessary here.
OpenAI documentation explicitly describes iframe UI in ChatGPT; its mention of
Codex tool support is not proof that every Codex surface renders MCP Apps.
Actual ChatGPT, Codex desktop, Codex CLI and Nessa host behavior must be recorded
separately. CLI users receive the full text/structured fallback.

Design review: compose `server/mcp` around the existing catalog and link
resolver, using a closed virtual repository instead of the local filesystem
adapter. Compose `src/mcp` around the existing Markdown and Mermaid components,
with an injected chart-navigation callback. Browser onboarding is not part of
this adapter. Do not move model content into the HTML template. Do not turn the
local read-only HTTP API into a remotely writable filesystem service.

## Run and tool flow

```sh
npm ci
npm run build
npm run start:mcp
```

For a local host with stdio MCP support, configure a server command equivalent
to `node /absolute/checkout/dist/server/server/mcp/main.js`. Use `node` directly
rather than npm if the host requires clean protocol stdout. This checkout does
not install that connection or change host configuration.

1. The model calls `replace_docs` with `expectedRevision: 0` and
   `files: [{ path: "docs/state/README.md", markdown: "…" }]`. Include the complete
   frontmatter and all linked pages, following the existing
   [format](../skills/nessa-docs/references/format.md).
2. The catalog validates the bundle and returns revision 1. Invalid bundles do
   not replace an accepted version.
3. The model calls `show_docs`. A capable host reads
   `ui://nessa-docs/explorer-v1.html` and supplies the tool result to that iframe.
4. The user follows diagram nodes or document buttons, switches between
   diagrams and details, pans/zooms charts, and opens chart explanations.
5. For an edit, the model calls `read_docs`, reconciles the complete returned
   `snapshot.files`, then calls `replace_docs` with the current revision and all
   files. Refresh in the explorer reads the latest bundle through the host.

`replace_docs` is model-visible and mutating/destructive (whole-bundle
replacement). `read_docs` is read-only, model/app-visible. `show_docs` is
read-only and model-visible. All tools declare schemas, annotations and text
fallback; only `show_docs` advertises the UI resource after capability
negotiation. Handlers are registered before SDK connection; the HTML resource
starts disabled. The server supports the initialize-based MCP revisions
2025-11-25, 2025-06-18 and 2024-11-05. The Apps bridge negotiates independently.

## State and refusal contract

| Current state | Input | Guard/result | Next state |
| --- | --- | --- | --- |
| Empty | Read/show | Tool error, no content | Empty |
| Empty or revision N | Replace | Schema, size, catalog and expected revision pass | Publish revision N+1 atomically |
| Any | Cancellation observed before commit | Refuse publication; release validation admission | Unchanged |
| Any | Invalid bundle | Error, no mutation | Unchanged |
| Revision N | Stale expected revision | Conflict; read/reconcile before retry | Unchanged |
| Concurrent replacements | Same expected revision | One commit wins; check revision again after async validation | One newer revision |
| Explorer at N | Result older than N | Ignore | N |
| Explorer in scope A | Result from scope B | Show refusal, retain accepted content | A |
| Explorer | Refresh/open-link refused | Show readable error | Accepted content retained |
| Process exits/restarts | Any | Bundle is lost; recreate from authored files | Empty new scope |

Only one replacement is validated at a time; overlapping attempts are refused
before entering the parser queue. One stdio process owns one bundle, limited to 16 files, 64 Ki characters per
file and 256 KiB of total UTF-8 Markdown. There is no tenant/account service,
network listener, durable storage, background synchronization or filesystem
write. Scope is the MCP process/session, not a chat conversation: a host that
reuses the process across conversations shares the same bundle. Run separate
processes for separate document sessions. Cancellation observed before commit
prevents publication; if a result is lost after commit, read the revision before
retrying. A session restart loses documents. A UI reload needs the host to replay
its tool result; Refresh obtains the current accepted revision. When the host advertises text context updates, selecting a page shares only its
scope/revision/document ID through `ui/update-model-context`, without triggering
a new model turn. Presentation
state stays inside each iframe, and Web Storage denial falls back to memory.

The bundle cannot read the laptop. Paths are relative, constrained Markdown
paths; symlinks and external file lookup do not exist in its virtual repository.
Cross-page links resolve only inside this bundle. Source references can display
authored paths but cannot reveal file contents or prove those files exist.
Model HTML is shown as text; Mermaid uses the existing strict renderer. The
static UI carries all its JS/CSS inline and declares empty connection/resource/
frame domain lists and no requested permissions. External links go through the
host's open-link request, which may refuse them.

The packaged HTML currently includes the complete Mermaid bundle (about
5.8 MB uncompressed). Host payload limits and startup behavior need testing in
actual target hosts; local browser success does not establish those limits.

See [host connection and persistence decisions](host-integration.md) for exact
setup steps, inspected laptop configuration, published capability evidence and
the minimal durable-storage proposal.

## Verification and remaining host work

```sh
npm run typecheck
npm test
npm run build
npm run verify:mcp
npm run verify:browser
```

`verify:mcp` uses the official SDK as a real stdio client, then Chromium and
WebKit inside a local test host with an opaque, script-only iframe and restrictive
CSP. It tests the protocol, rendering/navigation, refresh, stale/cross-session
results, HTML injection, host refusal and responsive layout. This is not an
independent conformance certification or an actual ChatGPT/Codex session.

Actual installation is pending: no plugin enrollment, tunnel, public deployment,
credentials, trust-warning acceptance or persistent host configuration was
performed. A production remote version needs an authenticated, tenant-scoped
store/HTTP adapter; do not expose this transient process as a shared service.
Use synthetic documents when doing the next actual host test. See [the recorded local results](../verification/MCP-RESULTS.md). Record the host
version, capability advertisement, UI result, permissions/refusals, payload
limit and reconnect behavior before claiming that host is supported.
