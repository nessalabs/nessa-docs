import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
const ui = fileURLToPath(new URL('./vendor/nessa-ui/', import.meta.url));
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: [
    { find: /^@nessa-ui\/react\/(.*)$/, replacement: `${ui}components/$1` },
    { find: /^@nessa-ui\/styles\.css$/, replacement: `${ui}styles.css` },
  ] },
  build: { outDir: 'dist/mcp', emptyOutDir: true, assetsInlineLimit: 100000000, rollupOptions: { input: 'mcp.html', output: { inlineDynamicImports: true } } },
});
