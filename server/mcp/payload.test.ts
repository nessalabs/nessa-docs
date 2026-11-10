import { expect, it } from 'vitest';
import { DocumentBundle } from './bundle';
import { readSnapshot } from '../../shared/mcp-payload';
import { doc } from '../testing/documents';

it('rejects forged cross-bundle references and unsafe external hrefs at the renderer boundary', async () => {
  const snapshot = await new DocumentBundle().replace({ expectedRevision: 0, files: [{ path: 'docs/state/README.md', markdown: doc('system', null) }] });
  expect(readSnapshot(snapshot).files).toEqual(snapshot.files);
  const foreign = structuredClone(snapshot);
  Object.assign(foreign.documents[0]!.links, { bad: { kind: 'document', id: 'foreign', fragment: null } });
  expect(() => readSnapshot(foreign)).toThrow('outside this bundle');
  const unsafe = structuredClone(snapshot);
  Object.assign(unsafe.documents[0]!.links, { bad: { kind: 'external', url: 'javascript:alert(1)' } });
  expect(() => readSnapshot(unsafe)).toThrow();
  expect(() => readSnapshot({ ...snapshot, documents: [] })).toThrow();
});

it('preserves authored special keys and still rejects an unsafe value under them', async () => {
  const files = [
    { path: 'docs/state/README.md', markdown: doc('system', null, { diagramLinks: Object.fromEntries([['__proto__', 'child']]) }, '```mermaid\nflowchart LR\n __proto__ --> End\n```\n\n[Evidence](__proto__)') },
    { path: 'docs/state/child.md', markdown: doc('child', 'system') },
  ];
  const snapshot = await new DocumentBundle().replace({ expectedRevision: 0, files });
  const root = readSnapshot(snapshot).documents.find(doc => doc.document.id === 'system')!;
  expect(Object.hasOwn(root.diagramLinks, '__proto__')).toBe(true);
  expect(root.diagramLinks['__proto__']?.id).toBe('child');
  expect(Object.hasOwn(root.links, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(root.diagramLinks)).toBe(Object.prototype);
  const unsafe = structuredClone(snapshot);
  Object.defineProperty(unsafe.documents[0]!.links, '__proto__', { value: { kind: 'external', url: 'javascript:alert(1)' }, enumerable: true, configurable: true });
  expect(() => readSnapshot(unsafe)).toThrow();
});

it('carries a page\'s tasks and records through a bundle to the explorer', async () => {
  const chart = '```mermaid\nflowchart LR\n  Plan --> Build\n```\n';
  const files = [
    { path: 'docs/state/README.md', markdown: doc('system', null, { work: [{ id: 'build', title: 'Build it', anchor: { diagram: 0, node: 'Build' } }] }, chart) },
    { path: 'docs/state/nessa-docs.yaml', text: 'work:\n  people: [saurav]\n' },
    { path: 'docs/state/work/system/2026-01-01T00-00-00Z-saurav.md', markdown: '---\npage: system\nevent: accept\nstate: planned\nat: 2026-01-01T00:00:00Z\nby: saurav\n---\nAccepted.\n' },
    { path: 'docs/state/work/system/build/2026-01-01T01-00-00Z-codex.md', markdown: '---\npage: system\ntask: build\nevent: start\nstate: working\nat: 2026-01-01T01:00:00Z\nby: codex\n---\nStarted.\n' },
  ];
  const snapshot = await new DocumentBundle().replace({ expectedRevision: 0, files });
  const root = readSnapshot(snapshot).documents[0]!;
  expect(root.document.work).toMatchObject({ state: 'working', tasks: 1, open: 1 });
  expect(root.work?.tasks[0]).toMatchObject({ id: 'build', state: 'working', anchor: { diagram: 0, target: { kind: 'node', node: 'Build' } } });
  expect(root.work?.records.map((record) => record.event)).toEqual(['accept', 'start']);
  expect(snapshot.catalog.issues).toEqual([]);
});
