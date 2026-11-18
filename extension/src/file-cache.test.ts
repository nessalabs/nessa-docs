import { describe, expect, it } from 'vitest';
import { cachedPort, type Kept, type KeptStore } from './file-cache';
import type { RepoPort } from './port-client';
import type { ReadAnswer } from './protocol';

const root = { owner: 'o', repo: 'r', ref: 'main', commit: 'a'.repeat(40), prefix: '' };

function mapStore(): KeptStore & { rows: Map<string, Kept> } {
  const rows = new Map<string, Kept>();
  return { rows, get: async (key) => rows.get(key), put: (key, value) => void rows.set(key, value) };
}

function countingPort(answers: Record<string, ReadAnswer>) {
  const calls: string[] = [];
  const port: RepoPort = {
    list: async (path) => { calls.push(`list ${path}`); return path === 'gone' ? null : [{ name: 'a.md', kind: 'file' }]; },
    read: async (path) => { calls.push(`read ${path}`); return answers[path] ?? { kind: 'missing' }; },
    tell: () => undefined,
  };
  return { port, calls };
}

describe('cachedPort', () => {
  it('answers a second read and listing from the store', async () => {
    const store = mapStore();
    const first = countingPort({ 'a.md': { kind: 'text', text: 'hello' } });
    const one = cachedPort(first.port, root, store);
    expect(await one.read('a.md', 100)).toEqual({ kind: 'text', text: 'hello' });
    expect(await one.list('docs')).toEqual([{ name: 'a.md', kind: 'file' }]);
    expect(await one.list('gone')).toBeNull();
    expect(await one.read('nope.md', 100)).toEqual({ kind: 'missing' });

    const again = countingPort({});
    const two = cachedPort(again.port, root, store);
    expect(await two.read('a.md', 100)).toEqual({ kind: 'text', text: 'hello' });
    expect(await two.list('docs')).toEqual([{ name: 'a.md', kind: 'file' }]);
    expect(await two.list('gone')).toBeNull();
    expect(await two.read('nope.md', 100)).toEqual({ kind: 'missing' });
    expect(again.calls).toEqual([]);
  });

  it('applies each read limit to kept text', async () => {
    const store = mapStore();
    await cachedPort(countingPort({ 'a.md': { kind: 'text', text: 'hello' } }).port, root, store).read('a.md', 100);
    expect(await cachedPort(countingPort({}).port, root, store).read('a.md', 3)).toEqual({ kind: 'too-large', size: 5 });
  });

  it('asks again for a larger limit than a kept too-large answer, and never keeps failures', async () => {
    const store = mapStore();
    const first = countingPort({ 'big.md': { kind: 'too-large', size: 500 }, 'flaky.md': { kind: 'failed', reason: '503' } });
    const port = cachedPort(first.port, root, store);
    await port.read('big.md', 100);
    expect(await port.read('big.md', 50)).toEqual({ kind: 'too-large', size: 500 });
    await port.read('big.md', 1000);
    await port.read('flaky.md', 100);
    await port.read('flaky.md', 100);
    expect(first.calls).toEqual(['read big.md', 'read big.md', 'read flaky.md', 'read flaky.md']);
  });

  it('keeps each commit apart', async () => {
    const store = mapStore();
    await cachedPort(countingPort({ 'a.md': { kind: 'text', text: 'old' } }).port, root, store).read('a.md', 100);
    const next = countingPort({ 'a.md': { kind: 'text', text: 'new' } });
    expect(await cachedPort(next.port, { ...root, commit: 'b'.repeat(40) }, store).read('a.md', 100)).toEqual({ kind: 'text', text: 'new' });
    expect(next.calls).toEqual(['read a.md']);
  });
});
