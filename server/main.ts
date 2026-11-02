// Composition: reads the start-up configuration, builds the real filesystem
// port and the static asset map, and listens on loopback only.

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './catalog.js';
import { createFolderPicker } from './project-opening/folder-picker.js';
import { macFolderDialog, nodeMacDialogProcesses } from './project-opening/macos-dialog.js';
import { createProjects } from './project-opening/projects.js';
import { HOST, readConfig } from './config.js';
import { nodeRepositoryFiles } from './files.js';
import { nodeHandler, type StaticAsset } from './http.js';
import { createCheckerCache } from './model-check/cache.js';
import { createModelCheckService } from './model-check/service.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.map': 'application/json',
};

/** The built client, read once. Only these URL paths are ever served as files. */
function readClientAssets(directory: string): Map<string, StaticAsset> {
  const assets = new Map<string, StaticAsset>();
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const extension = extname(entry.name);
        assets.set(`/${relative(directory, full).split(sep).join('/')}`, {
          body: readFileSync(full),
          contentType: Object.hasOwn(CONTENT_TYPES, extension) ? (CONTENT_TYPES[extension] as string) : 'application/octet-stream',
        });
      }
    }
  };
  try {
    visit(directory);
  } catch {
    console.error(`client build not found at ${directory}; run \`npm run build\``);
  }
  return assets;
}

const outcome = readConfig(process.env);
if (outcome.kind === 'invalid') {
  console.error(outcome.message);
  process.exit(2);
}
const { project, port } = outcome.config;
const files = nodeRepositoryFiles();
const clientDirectory = fileURLToPath(new URL('../../client/', import.meta.url));
const projects = createProjects({ loadCatalog: (root) => loadCatalog(files, root), mintId: randomUUID });
await projects.start(project);
const exampleRoot = fileURLToPath(new URL('../../../examples/store/', import.meta.url));
const checker = createCheckerCache();
const modelChecks = createModelCheckService({
  files,
  loadCatalog: (root) => loadCatalog(files, root),
  runtime: () => checker.runtime(),
  status: () => checker.status(),
  install: (signal) => checker.install(signal),
});
const shutdown = new AbortController();
const folderPicker = createFolderPicker(process.platform === 'darwin' ? macFolderDialog(nodeMacDialogProcesses()) : null, shutdown.signal);
const server = createServer(
  nodeHandler({
    loadCatalog: (root) => loadCatalog(files, root),
    projects,
    folderPicker,
    exampleRoot,
    files,
    assets: readClientAssets(clientDirectory),
    allowedHosts: new Set([`127.0.0.1:${port}`, `localhost:${port}`]),
    modelChecks,
  }),
);
server.listen(port, HOST, () => {
  console.error(`Nessa Docs on http://${HOST}:${port}${project ? ` reading ${project}/docs/state` : ' — open a project in the browser'}`);
});

// F10: active chooser requests settle after the owned process closes, then the server exits.
let closing = false;
const stop = () => {
  if (closing) return;
  closing = true; shutdown.abort();
  server.close(() => process.exit(0));
};
process.once('SIGTERM', stop); process.once('SIGINT', stop);
