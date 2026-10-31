# Host connection and persistence decisions

Verified against official documentation on 2026-10-31. This separates published
host capabilities from the local checks performed for this patch.

## What the host documentation establishes

| Host | Documented connection | UI support established by the source | Tested here |
| --- | --- | --- | --- |
| ChatGPT | Public HTTPS streamable HTTP endpoint, or Secure MCP Tunnel to a private stdio/HTTP server; create/install a custom MCP plugin | MCP Apps iframe UI explicitly documented | No actual installation/session; local protocol/browser harness only |
| Codex CLI/TUI | Local stdio or streamable HTTP, configured by CLI/TOML; `/mcp` lists active servers | Tools documented; no iframe/chart surface documented | SDK stdio equivalent tested; no Codex model turn run |
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

The current `~/.codex/config.toml` contains eight MCP server sections and no
Nessa Docs entry. Unrelated server endpoints, environment values and credentials
were not printed or used. Installed Codex is `codex-cli 0.155.1`. The installed `codex mcp add --help` confirms the
stdio and streamable-HTTP forms. `tunnel-client` was not found on PATH; this does
not prove that no tunnel exists in the user's Platform organization. Account
roles, tunnel enrollment and runtime credentials have not been inspected.
No persistent connection, security setting or credential was created/changed.

## Exact next connection actions

### Local Codex tool test

The supported persistent setup is:

```sh
codex mcp add nessa-docs -- node /absolute/checkout/dist/server/server/mcp/main.js
```

This changes Codex's MCP configuration. It needs approval to register/enable this
specific command; it needs no provider API key or public listener. After saving,
start/reload the applicable Codex surface, inspect `/mcp` in the CLI, and ask it
to send the synthetic `examples/mcp/replace-docs.json` input, call `show_docs`,
then modify one page at the returned revision. Record actual selected tools,
arguments and output. For an iframe-capable desktop surface, additionally record
the initialize capability, HTML load, chart interaction, CSP and reconnect.
A successful CLI tool call still does not verify an embedded chart UI.

### Private ChatGPT UI test

Use the current stdio implementation through Secure MCP Tunnel; no public HTTP
server or public tunnel is necessary. The concrete steps are:

1. Select the Platform organization and target ChatGPT workspace. Creating a
   tunnel requires **Tunnels Read + Manage**; running/selecting it requires
   **Tunnels Read + Use**. The tunnel must include the target workspace.
2. Obtain developer-mode access under the workspace's policy. The user enables
   it in Settings → Security and login where applicable. This is a separate
   permission from Platform tunnel roles.
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
thing and is not used here. Host acceptance remains unverified.

The build includes all Mermaid diagram families. Keep that behavior for this
patch; dropping chart families would change the authored-document contract.
If an actual host rejects the resource or measured startup is unacceptable,
first record its byte limit/error. Then evaluate a separately versioned scoped
renderer for the documented chart families, or audited hosted assets with exact
CSP domains and explicit hosting approval. Do not fetch model-specified scripts
or weaken CSP to work around a limit.

## Minimal durable option — design only

Today the bundle is process-scoped, shared by callers of that stdio process,
and lost on restart. It is not conversation-scoped, tenant storage or a durable
project. `snapshot.files` contains the authored Markdown needed to reconstruct
it, but is not itself persisted by this adapter.

The smallest local durable owner can preserve the existing standalone format:

- The operator selects one application-owned storage directory at process
  startup; model tools cannot choose arbitrary laptop paths.
- Validate a full bundle using the existing virtual catalog, then write one
  generation directory containing exactly its `docs/state/*.md` files.
- Commit a versioned manifest (scope, revision, active generation, content hash)
  with a same-directory temporary file and atomic rename, with fsync ordering.
  A single writer lock prevents two processes from racing the same store.
- Publish tool success only after that manifest is durable. On restart rebuild
  the catalog from the committed generation and restore its scope/revision;
  ignore incomplete generations. A lost acknowledgement is resolved by reading
  the committed revision before retrying.
- Bound retained generations and recover orphaned temporary data under that
  owned directory only. Reject symlink/path escapes at the actual reads/writes.
- The standalone browser can open the committed generation as an ordinary
  project: it already contains `docs/state/README.md`. Parsing, diagram rendering
  and document semantics remain shared, with raw Markdown as the authority.

This is not implemented and creates no disk access to real user documents.
Remote/multi-user persistence additionally requires authentication and storage
keyed by the authenticated owner before bundle ID. The unauthenticated stdio
adapter must not become a shared remote document service.
