import { McpServer } from '@modelcontextprotocol/server';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { snapshotSchema } from '../../shared/mcp-payload.js';
import { portableSchema } from './schema.js';
import { DocumentBundle, bundleInput } from './bundle.js';
import type { BundleSnapshot } from '../../shared/mcp.js';

export const UI_URI = 'ui://nessa-docs/explorer-v1.html';
const outputSchema = portableSchema(z.object({ snapshot: snapshotSchema }));
const showOutputSchema = portableSchema(z.object({ snapshot: snapshotSchema.nullable() }));
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
function result(snapshot: BundleSnapshot) {
  return {
    content: [{ type: 'text' as const, text: `Nessa Docs revision ${snapshot.revision} (${snapshot.storage.kind === 'memory' ? 'session only' : snapshot.storage.status === 'synced' ? 'saved locally' : 'save unconfirmed'}):\n${snapshot.storage.kind === 'durable' ? `Standalone snapshot: ${snapshot.storage.projectPath}\nRead again for the current path after newer edits.\n` : ''}${snapshot.documents.map(({ document, body }) => `${document.title} [${document.id}]\n${body}`).join('\n\n')}` }],
    structuredContent: { snapshot },
  };
}

export function createDocsMcpServer(html: string, bundle = new DocumentBundle()) {
  const server = new McpServer({ name: 'nessa-docs', version: '0.1.0' }, { supportedProtocolVersions: ['2025-11-25', '2025-06-18', '2024-11-05'] });
  const safely = async (operation: () => BundleSnapshot | null | Promise<BundleSnapshot | null>) => {
    try {
      const snapshot = await operation();
      return snapshot ? result(snapshot) : { content: [{ type: 'text' as const, text: 'No documents yet. Ask the model to create a bundle, then refresh.' }], structuredContent: { snapshot: null } };
    }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Document operation failed.' }] }; }
  };
  server.registerTool('replace_docs', {
    description: 'Create or replace the entire Nessa Docs bundle owned by this MCP process. Validates authored docs/state Markdown and Mermaid bindings; memory-only by default; an operator-selected durable store saves generated Markdown. Tools cannot choose filesystem paths or read source projects. Include all pages on each replacement. Read first after restart; use expectedRevision to avoid overwriting newer content. Then call show_docs to display the explorer.',
    inputSchema: bundleInput,
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ['model'] } },
  }, (input, context) => safely(() => bundle.replace(input, context.mcpReq.signal)));
  server.registerTool('read_docs', {
    description: 'Read the complete current document bundle and revision, including validated links. No source-project files are accessed; output states whether the bundle is saved locally. Use to refresh the explorer or reconcile a revision conflict.',
    inputSchema: z.object({}).strict(),
    annotations: readOnly,
    outputSchema,
    _meta: { ui: { visibility: ['model', 'app'] } },
  }, () => safely(() => bundle.read()));

  registerAppResource(server, 'Nessa Docs explorer', UI_URI, {}, async () => ({ contents: [{
    uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: html,
    _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }, permissions: {} } },
  }] }));
  registerAppTool(server, 'show_docs', {
    title: 'Nessa Docs',
    description: 'Open the interactive Nessa Docs explorer. If the bundle is empty, ask the model to create one and refresh. Returns full text for clients without MCP Apps.',
    inputSchema: z.object({}).strict(),
    annotations: readOnly,
    outputSchema: showOutputSchema,
    _meta: {
      ui: { resourceUri: UI_URI, visibility: ['model'] },
      'openai/ui': { entrypoints: [{ type: 'thread' }] },
    },
  }, () => safely(() => bundle.readOptional()));
  return server;
}
