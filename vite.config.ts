import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { projectProxyGuard } from './scripts/development/project-proxy';
import { readConfig } from './server/config';
import { defineConfig } from 'vitest/config';

const ui = fileURLToPath(new URL('./vendor/nessa-ui/', import.meta.url));

const config = readConfig(process.env);
if (config.kind === 'invalid') throw new Error(config.message);
const target = `http://127.0.0.1:${config.config.port}`;

export default defineConfig({
  plugins: [projectProxyGuard(target, 5173), react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@nessa-ui\/react\/(.*)$/, replacement: `${ui}components/$1` },
      { find: /^@nessa-ui\/styles\.css$/, replacement: `${ui}styles.css` },
    ],
  },
  build: { outDir: 'dist/client', emptyOutDir: true, chunkSizeWarningLimit: 3000 },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': { target, changeOrigin: true } },
  },
  test: { include: ['server/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'], environment: 'node' },
});
