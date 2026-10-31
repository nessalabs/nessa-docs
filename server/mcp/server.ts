import { McpServer } from '@modelcontextprotocol/server';
import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { snapshotSchema } from '../../shared/mcp-payload.js';
import { portableSchema } from './schema.js';
import { DocumentBundle, bundleInput } from './bundle.js';
import type { BundleSnapshot } from '../../shared/mcp.js';

export const UI_URI = 'ui://nessa-docs/explorer-v1.html';
const outputSchema = portableSchema(z.object({ snapshot: snapshotSchema }));
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
function result(snapshot: BundleSnapshot) {
  return {
    content: [{ type: 'text' as const, text: `Nessa Docs revision ${snapshot.revision} (transient session):\n${snapshot.documents.map(({ document, body }) => `${document.title} [${document.id}]\n${body}`).join('\n\n')}` }],
    structuredContent: { snapshot },
  };
}

export function createDocsMcpServer(html: string) {
  const server = new McpServer({ name: 'nessa-docs', version: '0.1.0' }, { supportedProtocolVersions: ['2025-11-25', '2025-06-18', '2024-11-05'] });
  const bundle = new DocumentBundle();
  const safely = async (operation: () => BundleSnapshot | Promise<BundleSnapshot>) => {
    try { return result(await operation()); }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Document operation failed.' }] }; }
  };
  const replace = server.registerTool('replace_docs', {
    description: 'Create or replace the entire transient Nessa Docs bundle for this MCP session. Validates authored docs/state Markdown and Mermaid bindings; no filesystem reads or writes. Include all pages on each replacement. Use expectedRevision to avoid overwriting newer content. Then call show_docs to display the explorer.',
    inputSchema: bundleInput,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, (input, context) => safely(() => bundle.replace(input, context.mcpReq.signal)));
  const read = server.registerTool('read_docs', {
    description: 'Read the complete current transient document bundle and revision, including validated links. No local files are accessed. Use to refresh the explorer or reconcile a revision conflict.',
    inputSchema: z.object({}).strict(),
    annotations: readOnly,
    outputSchema,
  }, () => safely(() => bundle.read()));

  const resource = registerAppResource(server, 'Nessa Docs explorer', UI_URI, {}, async () => ({ contents: [{
    uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: html,
    _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }, permissions: {} } },
  }] }));
  resource.disable();
  const show = registerAppTool(server, 'show_docs', {
    description: 'Show the current Nessa Docs bundle as an interactive document and Mermaid chart explorer. Call replace_docs first. Returns full text for clients without MCP Apps.',
    inputSchema: z.object({}).strict(),
    annotations: readOnly,
    outputSchema,
    _meta: {},
  }, () => safely(() => bundle.read()));
  // Register handlers before connecting (SDK requirement), then negotiate the
  // optional UI after the legacy MCP initialize handshake. Core revision is
  // pinned above; the UI bridge negotiates its own version independently.
  server.server.oninitialized = () => {
    if (getUiCapability(server.server.getClientCapabilities())?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) {
      resource.enable();
      replace.update({ _meta: { ui: { visibility: ['model'] } } });
      read.update({ _meta: { ui: { visibility: ['model', 'app'] } } });
      show.update({ _meta: { ui: { resourceUri: UI_URI, visibility: ['model'] } } });
    }
  };
  return server;
}
