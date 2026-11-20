import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
// @ts-expect-error plain ES module without types
import { differences } from './claude-plugin.mjs';

describe('Claude plugin', () => {
  it('ships the same skills as skills/ (run `npm run sync:plugin`)', async () => {
    expect(await differences()).toEqual([]);
  });

  it('keeps the plugin and marketplace versions together', async () => {
    const read = async (path: string) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
    const plugin = await read('../plugins/nessa-docs/.claude-plugin/plugin.json');
    const market = await read('../.claude-plugin/marketplace.json');
    const listed = market.plugins.find((entry: { name: string }) => entry.name === plugin.name);
    expect(listed?.source).toBe('./plugins/nessa-docs');
    expect(listed?.version).toBe(plugin.version);
  });
});
