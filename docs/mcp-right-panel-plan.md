# Nessa Docs MCP right-panel plan

## Goal

Calling `show_docs` in a ChatGPT desktop conversation opens the Nessa Docs MCP
explorer beside that conversation. Users can navigate the charts and pages there,
without opening the separate localhost website.

## Finding and change

The local server previously registered its UI resource and `show_docs` thread
entrypoint only when the MCP client advertised an Apps capability during
initialization. The Codex `app-server` test connected to the server and could
call all three tools, but reported `ui: null` for each tool and no resources.
That left this host with no resource or entrypoint to open.

The server now advertises `ui://nessa-docs/explorer-v1.html` and the
`show_docs` thread entrypoint at registration time. Clients without a UI can
ignore the metadata and continue using the text/structured tool result. The
resource retains its restrictive CSP and requests no browser permissions.
This matches the [OpenAI plugin UI guide](https://developers.openai.com/plugins/build/chatgpt-ui)
and [thread entrypoint metadata](https://developers.openai.com/plugins/build/extensions).

## Evidence so far

- The SDK stdio protocol check passes both with and without an Apps capability.
  Both clients list the HTML resource and `show_docs` thread entrypoint; create,
  read, show, revision conflict, and text fallback still pass.
- A fresh Codex CLI 0.155.1 `app-server` test now reports the UI resource with
  `text/html;profile=mcp-app` and `show_docs` entrypoints `[{"type":"thread"}]`.
  It also completes synthetic create/show/update/read calls.
- The current desktop conversation has not been reconnected to the rebuilt MCP
  server. A `show_docs` call after the build still returned the existing
  memory bundle at revision 2 and the desktop MCP Apps tab inventory remained
  empty. Its right-side browser tab is the separate localhost website.
  Model context from the MCP app did arrive for revision 2 with document ID
  `payment-contract` and view `diagrams`, which shows the app bridge ran, but
  does not show where the UI rendered. Neither protocol nor `app-server` tool
  calls prove that the desktop opened a right-side explorer tab.

## Desktop completion check

1. Reconnect the desktop MCP session to this build. The existing memory-only
   synthetic bundle may be lost on reconnect; read the revision first and load
   `examples/mcp/replace-docs.json` only if the bundle is empty.
2. Call `show_docs` in that conversation. Confirm the right-side tab is an MCP
   Apps explorer showing the same scope/revision, rather than `127.0.0.1:4311`.
3. Navigate from the system chart to an order page, zoom a chart, select a
   transition explanation, and confirm the explanation appears beside the
   chart on a wide panel.
4. Confirm the selected document, view, and explanation arrive as model context.
   Update the bundle through `replace_docs`, refresh, and confirm the new
   revision appears in the same MCP surface.
5. If the tab still does not appear, capture the host's reported tool metadata,
   resource list, client capability advertisement, and UI refusal or console
   error. If the metadata is present, check whether the desktop surface accepts
   thread entrypoints from a raw local MCP registration or requires an installed
   plugin. Determine whether the remaining block is host discovery, plugin
   packaging, or resource loading before changing the adapter again.

For distribution to other users, the local stdio command alone is not an
installation experience. Use the documented
[desktop-only plugin path](https://developers.openai.com/plugins/deploy/desktop-only)
if local execution is required, subject to that path's eligibility and review,
or a supported remote plugin connection. Keep the right-panel acceptance check
the same for either delivery path.

The localhost browser is useful for standalone docs, but is not evidence for
the MCP right-panel goal.
