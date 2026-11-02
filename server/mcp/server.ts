import { McpServer } from '@modelcontextprotocol/server';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { snapshotSchema } from '../../shared/mcp-payload.js';
import { portableSchema } from './schema.js';
import { DocumentBundle, bundleFileText, bundleInput, type BundleFile } from './bundle.js';
import type { BundleSnapshot } from '../../shared/mcp.js';
import { CHECKER_STATES, CHECK_RUN_STATES } from '../../shared/model-check.js';
import { createCheckerCache } from '../model-check/cache.js';
import { diagramNodeIds } from '../model-check/nodes.js';
import { withModelCheck } from '../model-check/record.js';
import { createModelCheckService, type ModelCheckService } from '../model-check/service.js';

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

function modelChecksFor(): ModelCheckService {
  const checker = createCheckerCache();
  return createModelCheckService({
    files: { async list() { return []; }, async inspect() { return { kind: 'missing' as const }; }, async readText() { return { kind: 'unreadable' as const, reason: 'MCP checks pass spec text instead of a project path.' }; } },
    loadCatalog: async () => { throw new Error('MCP checks do not open a source project.'); },
    runtime: () => checker.runtime(),
    status: () => checker.status(),
    install: (signal) => checker.install(signal),
  });
}

const checkInput = z.object({
  action: z.enum(['status', 'install', 'check']).optional().describe('status reports the checker, install downloads it, and check runs TLC. Defaults to check.'),
  page: z.string().max(200).optional().describe('Document id or docs/state page path in the current bundle.'),
  spec: z.string().max(65536).optional().describe('TLA+ spec text. Use this or page, not both.'),
  config: z.string().max(65536).optional().describe('TLC config text. Required with spec.'),
  steps: z.record(z.string().max(80), z.string().max(200)).optional().describe('TLC action name to one plain sentence, used when spec and config are passed directly.'),
}).strict();

const checkOutputSchema = portableSchema(z.object({
  state: z.enum(CHECK_RUN_STATES),
  message: z.string(),
  checker: z.object({ state: z.enum(CHECKER_STATES), version: z.string(), cachePath: z.string(), message: z.string().optional() }),
  result: z.object({
    sourceRevision: z.string().optional(), checker: z.string(), date: z.string(), config: z.string(), modelDigest: z.string(),
    states: z.number(), held: z.array(z.string()), broke: z.array(z.object({ rule: z.string(), path: z.array(z.string()), states: z.array(z.string()) })), unchecked: z.array(z.string()),
  }).optional(),
  snapshot: snapshotSchema.nullable(),
}));

export function createDocsMcpServer(html: string, bundle = new DocumentBundle(), modelChecks = modelChecksFor()) {
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
  server.registerTool('check_model', {
    description: 'Check a statechart page\'s TLA+ model with TLC, the same checker as the app\'s Check rules button. Pass a page path from the current bundle, or spec plus config text. Returns rules held, rules broken with a plain-language path, rules not checked, and the state count. A missing checker is reported and can be installed; it is not a pass. This checks the design, not the code. Not checked is not a pass. A finished check of a bundle page saves modelCheck on that page.',
    inputSchema: checkInput,
    outputSchema: checkOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: { ui: { visibility: ['model', 'app'] } },
  }, async (input, context) => {
    try {
      const checker = await modelChecks.status();
      const action = input.action ?? 'check';
      if (action === 'status') return checkResult(checker.state, checker.message ?? 'Rule checker status.', checker, null, null);
      if (action === 'install') {
        const installed = await modelChecks.install(context.mcpReq.signal);
        const message = installed.state === 'ready' ? `${installed.message ?? 'The rule checker is installed.'} This checks the design, not the code.` : (installed.message ?? 'The rule checker is not installed.');
        return checkResult(installed.state, message, installed, null, null);
      }
      const signal = context.mcpReq.signal;
      if (input.page && (input.spec || input.config)) throw new Error('Pass a page or spec plus config, not both.');
      if (input.spec || input.config) {
        if (!input.spec || !input.config) throw new Error('spec and config are both required when checking text directly.');
        const view = await modelChecks.checkText({ spec: input.spec, config: input.config, steps: input.steps ?? {}, nodeIds: [], configPath: 'tla/inline.cfg' }, signal);
        return checkResult(view.state, view.message, checker, view.result ?? null, null);
      }
      if (!input.page) throw new Error('Pass a page path, or spec plus config. Nothing was checked.');
      const saved = await checkBundlePage(bundle, modelChecks, input.page, signal);
      return checkResult(saved.state, saved.message, checker, saved.result ?? null, saved.snapshot);
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'The rule check failed.' }] };
    }
  });

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

function checkResult(
  state: string,
  message: string,
  checker: { state: string; version: string; cachePath: string; message?: string },
  result: { sourceRevision?: string; checker: string; date: string; config: string; modelDigest: string; states: number; held: readonly string[]; broke: readonly { rule: string; path: readonly string[]; states: readonly string[] }[]; unchecked: readonly string[] } | null,
  snapshot: BundleSnapshot | null,
) {
  const lines = [message];
  if (result) {
    lines.push(`Checker: ${result.checker}`, result.sourceRevision ? `Source revision: ${result.sourceRevision}` : 'Source revision was not recorded.', `Config: ${result.config}`, `States: ${result.states}`, `Held: ${result.held.join(', ') || 'none'}`);
    for (const item of result.broke) {
      lines.push(`Broke: ${item.rule}`, ...item.path.map((step, index) => `${index + 1}. ${step}`));
    }
    lines.push(`Not checked: ${result.unchecked.join(', ') || 'none'}`, 'Not checked is not a pass.');
  }
  if (!lines.some((line) => line.includes('design, not the code'))) lines.push('This checks the design, not the code.');
  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
    structuredContent: { state, message, checker, ...(result ? { result } : {}), snapshot },
  };
}

async function checkBundlePage(bundle: DocumentBundle, modelChecks: ModelCheckService, page: string, signal: AbortSignal) {
  const snapshot = bundle.read();
  const document = snapshot.documents.find((doc) => doc.document.id === page || doc.document.file === page);
  if (!document) throw new Error('That page is not in this bundle.');
  const model = document.document.model;
  if (!model) throw new Error('This page has no model, so nothing was checked.');
  const spec = bundledText(snapshot.files, `docs/state/${model.spec}`);
  const config = bundledText(snapshot.files, `docs/state/${model.config}`);
  if (spec === null || config === null) throw new Error('The linked model files are not in this bundle. Include the .tla and .cfg, or pass spec and config. Nothing was checked.');
  const pageFile = snapshot.files.find((file): file is { path: string; markdown: string } => file.path === document.document.file && 'markdown' in file);
  if (!pageFile) throw new Error('The page text is not in this bundle.');
  const view = await modelChecks.checkText({
    spec, config, steps: model.steps, nodeIds: diagramNodeIds(document.body), sourceRevision: document.document.sourceRevision, configPath: model.config,
  }, signal);
  if (!view.result || (view.state !== 'passed' && view.state !== 'broke' && view.state !== 'not-checked')) return { ...view, snapshot: null };
  const markdown = withModelCheck(pageFile.markdown, view.result);
  const files: BundleFile[] = snapshot.files.map((file) => file.path === pageFile.path && 'markdown' in file ? { path: file.path, markdown } : file);
  const updated = await bundle.replace({ expectedRevision: snapshot.revision, files }, signal);
  return { ...view, snapshot: updated };
}

function bundledText(files: readonly BundleFile[], path: string): string | null {
  const file = files.find((item) => item.path === path);
  return file && 'text' in file ? bundleFileText(file) : null;
}
