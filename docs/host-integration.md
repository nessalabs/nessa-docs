# Host connection and persistence decisions

Verified against official documentation on 2026-10-31. This separates published
host capabilities from the local checks performed for this patch.

## What the host documentation establishes

| Host | Documented connection | UI support established by the source | Tested here |
| --- | --- | --- | --- |
| ChatGPT | Public HTTPS streamable HTTP endpoint, or Secure MCP Tunnel to a private stdio/HTTP server; create/install a custom MCP plugin | MCP Apps iframe UI explicitly documented | No actual installation/session; local protocol/browser harness only |
| Codex CLI/TUI | Local stdio or streamable HTTP, configured by CLI/TOML; `/mcp` lists active servers | Tools documented; no iframe/chart surface documented | Actual Codex app-server calls pass; model selected tools but writes blocked by CLI approval policy |
| Codex IDE extension | MCP server settings: stdio or streamable HTTP, then restart extension | MCP tools documented; these sources do not establish MCP Apps rendering | Not installed/tested |
| Codex desktop app | Account/plugin availability depends on the actual app/version | Current shared plugin quickstart says optional UI in ChatGPT; it is insufficient evidence for every Codex desktop surface | Unknown until the actual host advertises Apps capability and renders the resource |

Sources:

- [MCP server/UI quickstart](https://developers.openai.com/plugins/build/app-quickstart):
  explicitly distinguishes MCP tools for ChatGPT and Codex from optional iframe
  UI in ChatGPT.
- [Add UI](https://developers.openai.com/plugins/build/chatgpt-ui) and
  [UI reference](https://developers.openai.com/plugins/reference): standard
  resource/bridge, CSP and state contracts.
- [Connect/test](https://developers.openai.com/plugins/deploy/connect-chatgpt):
  endpoint preparation, custom MCP plugin creation, authentication/risk warning,
  installation, fresh conversation and metadata refresh.
- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli): supported
  transports, CLI/TOML setup and IDE settings.
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels):
  private stdio forwarding, organization/workspace roles, runtime key and client
  setup. A tunnel is for private development/use, not public plugin submission.

## Read-only inspection of this laptop

After the user approved registration, `~/.codex/config.toml` now contains an enabled
`nessa-docs` stdio entry. Unrelated server endpoints, environment values and credentials
were not printed or used. Installed Codex is `codex-cli 0.155.1`. The installed `codex mcp add --help` confirms the
stdio and streamable-HTTP forms. `tunnel-client` was not found on PATH; this does
not prove that no tunnel exists in the user's Platform organization. The known per-user tunnel-client config/state locations and Homebrew service
profile were absent. A read-only visit to Platform tunnel settings reached the
sign-in page in the available browser, so existing organization tunnels and
workspace associations could not be verified. No login, credential entry,
provisioning, grants or connection changes were performed.
Only the approved local Nessa Docs connection was added. No tunnel, plugin,
credential or security policy was changed.

## Exact next connection actions

### Local Codex tool test

Registration completed with the user's explicit approval:

```sh
codex mcp add nessa-docs -- /opt/homebrew/bin/node /Users/nessa/Documents/Codex/2026-10-31/task/nessa-docs/dist/server/server/mcp/main.js
```

`codex mcp get nessa-docs --json` confirms enabled stdio, that exact Node/build
path, and no environment overrides. Storage remains memory-only.

Actual `codex-cli 0.155.1 app-server` discovery connected and exposed all three
tools. Its `mcpServer/tool/call` RPC created synthetic revision 1, showed the
same scope, updated to revision 2, rejected a stale revision-1 write, and read
the updated text. This is actual Codex runtime routing, without model selection.
The test client advertised no Apps capability: no UI metadata/resources were
returned. This verifies the text/structured fallback only.

A separate ephemeral `codex exec` model turn selected `read_docs`,
`replace_docs`, and `show_docs` in the requested order. Both writes failed with
**“MCP tool call requires approval, but approval policy is never”**. Empty reads
and shows returned the expected empty-bundle error. No approval policy was
changed or blocked write retried; model-driven create/update remains blocked.
This host error is an approval-policy refusal, not proof that an automatic
reviewer evaluated or rejected the document content.

The desktop automation inventory exposes a Codex MCP Apps surface, but it had
no app tabs. This does not establish whether that desktop version supports this
registered server's iframe UI. Desktop rendering, chart interaction and reload
remain unverified. A successful CLI call is not embedded-chart verification.

`verification/codex-host.mjs` is an explicit opt-in runtime harness for an
already registered memory-mode server in this checkout. Set
`NESSA_DOCS_CODEX_OVERRIDES` to a reviewed JSON argv file containing only paired
`-c`, `mcp_servers.<other-server>.enabled=false` entries to isolate unrelated
configured servers for the test process. It never edits registration or approval
policy; generated plugin servers may not support configuration overrides.
`NESSA_DOCS_CODEX_BINARY` optionally selects the installed Codex binary.
Synthetic results are retained at `verification/results/codex-host.json` and
`verification/results/codex-model-host.jsonl`. Re-running requires Codex's normal
local state-directory access; no alternate credentials/state directory is used.

### Private ChatGPT UI test

Use the current stdio implementation through Secure MCP Tunnel; no public HTTP
server or public tunnel is necessary. The concrete steps are:

1. Select the Platform organization and target ChatGPT workspace. Creating a
   tunnel requires **Tunnels Read + Manage**; running/selecting it requires
   **Tunnels Read + Use**. The tunnel must include the target workspace.
2. Obtain permission to add and use custom MCP servers under the target
   workspace's current policy. This is separate from Platform tunnel roles.
   If the host requires an additional security/developer setting, have the user
   review that specific change; do not silently enable it.
3. Create/select a tunnel in Platform tunnel settings. Obtain a runtime API key
   through the approved credential flow; explicitly settle reuse versus new.
   Never place the key in repo files, tool arguments or screenshots.
4. Install `tunnel-client` from Platform's download link or the official
   `openai/tunnel-client` release. Set its runtime key in the environment, and
   initialize a named local stdio profile pointing at the fixed Node command:

   ```sh
   tunnel-client init --sample sample_mcp_stdio_local --profile nessa-docs \
     --tunnel-id <approved-tunnel-id> \
     --mcp-command "node /absolute/checkout/dist/server/server/mcp/main.js"
   tunnel-client doctor --profile nessa-docs --explain
   tunnel-client run --profile nessa-docs
   ```

5. In ChatGPT Plugins, choose **+ → Add custom MCP server**, name it Nessa Docs,
   select **Tunnel**, choose that tunnel, and configure the connection's
   authentication. The user reviews and accepts the displayed risk warning;
   then create/install the plugin. Do not bypass or accept that warning silently.
6. In a fresh conversation select the plugin, create the synthetic bundle,
   show it, explore chart explanations and links, change a page, refresh, and
   reconnect. Record desktop/mobile UI behavior and actual resource limits.

Approval needed before these actions: permission to configure the named private
stdio tunnel and custom ChatGPT plugin in the selected organization/workspace,
plus the user's credential choice and review of the host warning. These steps
remain pending; none was attempted with uncertain outcome or denied by review.
Public deployment and repository push/merge remain separate authorizations.

## HTML resource size

The current single-file build is approximately 5.78 MB uncompressed and 1.60 MB
with gzip (gzip settings differ slightly from Vite's report). The real stdio
SDK, Inspector, Chromium and WebKit tests load this payload successfully.
The inspected official MCP SDK exposes a 10,485,760-byte default stdio buffer;
this resource's JSON envelope is about 5.84 MB, below that particular transport
bound. It does not establish ChatGPT's, Codex desktop's or a tunnel's bound.
Gzip size is a comparison, not a claim that stdio transmits compressed HTML.

The checked official UI guide, UI reference, quickstart and troubleshooting
pages do **not publish a numeric HTML-resource byte ceiling**. This research
therefore cannot classify 5.78 MB as within or beyond an actual ChatGPT/Codex
limit. A plugin ZIP limit or API file-upload limit would measure a different
thing and is not used here. Host acceptance remains unverified. The current official Secure MCP Tunnel
limits section separately documents **10 MiB for the complete serialized
request/response envelope**, including headers/protocol metadata, and a
**120-second end-to-end deadline**. The measured resource JSON is about 5.84 MB;
that is not a measured complete tunnel envelope or a successful host load.

The build includes all Mermaid diagram families. Keep that behavior for this
patch; dropping chart families would change the authored-document contract.
If an actual host rejects the resource or measured startup is unacceptable,
first record its byte limit/error. Then evaluate a separately versioned scoped
renderer for the documented chart families, or audited hosted assets with exact
CSP domains and explicit hosting approval. Do not fetch model-specified scripts
or weaken CSP to work around a limit.

## Durable local bundles

Memory is still the default. The implemented opt-in owner is described in
[durable bundles](durable-bundles.md): absolute startup-selected directory,
private modes, a persistent scope, full catalog/hash validation on restore,
one atomically renamed current/previous manifest, explicit uncertainty and
writer-lock draining on shutdown. No source project is selected or modified by
tools. Current/previous generation paths are snapshots, not a stable live
standalone directory; read/refresh for the current path before opening it.

Remote/multi-user persistence still requires authentication and storage keyed by
the authenticated owner before bundle ID. No remote service was configured. The approved Codex stdio registration uses
memory mode; it does not select the synthetic durable demo or real user docs.
