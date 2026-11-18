// Builds the extension for Chrome and Firefox from one codebase:
//   dist/extension/chrome/   load unpacked in chrome://extensions
//   dist/extension/firefox/  load as a temporary add-on in about:debugging
// The two differ only in their manifest. With --package it also writes the
// downloadable zips in extension/downloads/ (committed, so people can install
// before the store listings exist).
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const out = here('../dist/extension/');
const staging = `${out}build`;
const { version } = JSON.parse(await readFile(here('../package.json'), 'utf8'));

// 1. The reader and options pages.
await build({ configFile: here('./vite.config.ts'), logLevel: 'warn' });

// 2. The content script: one classic script, no imports.
await build({
  configFile: false,
  logLevel: 'warn',
  publicDir: false,
  build: {
    outDir: staging,
    emptyOutDir: false,
    lib: { entry: here('./src/content.ts'), formats: ['iife'], name: 'nessaDocsContent', fileName: () => 'content.js' },
  },
});

const GITHUB = 'https://github.com/*';
const common = {
  manifest_version: 3,
  name: 'Nessa Docs for GitHub',
  short_name: 'Nessa Docs',
  version,
  description: 'Read docs/state folders on GitHub in the Nessa Docs reader: diagrams, linked pages and glossary, straight from the repository.',
  icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  permissions: ['storage'],
  host_permissions: [GITHUB, 'https://api.github.com/*', 'https://raw.githubusercontent.com/*'],
  content_scripts: [{ matches: [GITHUB], js: ['content.js'], run_at: 'document_idle' }],
  web_accessible_resources: [{ resources: ['reader.html'], matches: [GITHUB] }],
  options_ui: { page: 'options.html', open_in_tab: true },
};
const manifests = {
  chrome: { ...common, minimum_chrome_version: '116' },
  firefox: { ...common, browser_specific_settings: { gecko: { id: 'nessa-docs@nessalabs.dev', strict_min_version: '128.0' } } },
};

for (const [target, manifest] of Object.entries(manifests)) {
  const dir = `${out}${target}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await cp(staging, dir, { recursive: true });
  await writeFile(`${dir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
}
await rm(staging, { recursive: true, force: true });
console.log(`Built dist/extension/chrome and dist/extension/firefox (${version}).`);

if (process.argv.includes('--package')) {
  const downloads = here('./downloads/');
  await mkdir(downloads, { recursive: true });
  for (const target of Object.keys(manifests)) {
    const zip = `${downloads}nessa-docs-${target}.zip`;
    await rm(zip, { force: true });
    // -X: no extra file attributes (owner ids and the like) in the archive.
    execFileSync('zip', ['-q', '-X', '-r', zip, '.'], { cwd: `${out}${target}` });
  }
  console.log(`Packaged extension/downloads/nessa-docs-{chrome,firefox}.zip (${version}).`);
}
