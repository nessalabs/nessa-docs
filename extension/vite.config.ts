// Builds the extension's two pages (the reader shown over GitHub, and the
// options page). The content script has its own build (build.mjs), since a
// content script must be one classic script.
import { defineConfig, type Alias } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const ui = here('../vendor/nessa-ui/');

/** The Nessa UI subset, and browser stand-ins for the Node modules the catalog imports. */
export const aliases: Alias[] = [
  { find: /^@nessa-ui\/react\/(.*)$/, replacement: `${ui}components/$1` },
  { find: /^@nessa-ui\/styles\.css$/, replacement: `${ui}styles.css` },
  { find: /^node:path$/, replacement: here('./src/shims/path.ts') },
  { find: /^node:crypto$/, replacement: here('./src/shims/crypto.ts') },
  { find: /^node:(worker_threads|child_process)$/, replacement: here('./src/shims/node-only.ts') },
];

export default defineConfig({
  root: here('.'),
  base: './',
  publicDir: here('./public'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: aliases },
  build: {
    outDir: here('../dist/extension/build'),
    emptyOutDir: true,
    // Extension pages may not run inline scripts; keep every chunk a file.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { reader: here('./reader.html'), options: here('./options.html') } },
  },
});
