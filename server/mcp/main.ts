import { readFile } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createDocsMcpServer } from './server.js';

// Only the packaged UI is read. No project selection or network listener.
const html = await readFile(new URL('../../../mcp/mcp.html', import.meta.url), 'utf8');
await createDocsMcpServer(html).connect(new StdioServerTransport());
