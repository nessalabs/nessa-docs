import { describe, expect, it } from 'vitest';
import { DocumentBundle } from './bundle';
import { doc } from '../testing/documents';
const file = (markdown = doc('system', null)) => ({ path: 'docs/state/README.md', markdown });

describe('transient document bundles', () => {
  it('creates a validated navigable bundle and updates at the matching revision', async () => {
    const bundle = new DocumentBundle();
    const first = await bundle.replace({ expectedRevision: 0, files: [file(doc('system', null, { diagramLinks: { Child: 'child' } }, '```mermaid\nflowchart LR\n Child-->Done\n```\n[Child](child.md)')), { path: 'docs/state/child.md', markdown: doc('child', 'system') }] });
    expect(first.revision).toBe(1);
    expect(first.documents[0]?.links['child.md']).toMatchObject({ kind: 'document', id: 'child' });
    const second = await bundle.replace({ expectedRevision: 1, files: [file()] });
    expect(second.scope).toBe(first.scope);
    expect(second.revision).toBe(2);
    expect(second.documents.map((doc) => doc.document.id)).toEqual(['system']);
  });
  it('keeps the accepted revision after invalid input or stale writes', async () => {
    const bundle = new DocumentBundle();
    const first = await bundle.replace({ expectedRevision: 0, files: [file()] });
    await expect(bundle.replace({ expectedRevision: 1, files: [file('not frontmatter')] })).rejects.toThrow('Invalid document bundle');
    await expect(bundle.replace({ expectedRevision: 0, files: [file()] })).rejects.toThrow('Revision conflict');
    expect(bundle.read()).toBe(first);
  });
  it('publishes only one winner when replacements race', async () => {
    const bundle = new DocumentBundle();
    const outcomes = await Promise.allSettled([bundle.replace({ expectedRevision: 0, files: [file()] }), bundle.replace({ expectedRevision: 0, files: [file()] })]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(bundle.read().revision).toBe(1);
  });
  it('does not let references find documents or files from another session', async () => {
    const first = new DocumentBundle();
    const second = new DocumentBundle();
    await first.replace({ expectedRevision: 0, files: [file(doc('secret', null))] });
    expect(() => second.read()).toThrow('No documents yet');
    const snapshot = await second.replace({ expectedRevision: 0, files: [file(doc('system', null, { sources: ['.env'] }, '[Missing](other.md) [Forbidden](javascript:alert) [Absolute](/etc/passwd)'))] });
    expect(snapshot.scope).not.toBe(first.read().scope);
    expect(snapshot.documents[0]?.sources[0]?.target).toMatchObject({ kind: 'repo-file', exists: false });
    expect(snapshot.documents[0]?.links['javascript:alert']).toMatchObject({ kind: 'unresolved' });
    await expect(second.replace({ expectedRevision: 1, files: [file(doc('system', null, { diagramLinks: { A: 'secret' } }, '```mermaid\nflowchart LR\n A-->B\n```'))] })).rejects.toThrow('Invalid document bundle');
  });
  it.each(['/etc/passwd', 'docs/state/../secret.md', 'docs/state/x/../../README.md', 'docs/state/%2e%2e/x.md', 'docs\\state\\README.md'])('refuses path %s', async (path) => {
    await expect(new DocumentBundle().replace({ expectedRevision: 0, files: [{ path, markdown: doc('system', null) }] })).rejects.toThrow();
  });
  it('bounds file count, content bytes and duplicate paths', async () => {
    const bundle = new DocumentBundle();
    await expect(bundle.replace({ expectedRevision: 0, files: [file(), file()] })).rejects.toThrow('Duplicate');
    await expect(bundle.replace({ expectedRevision: 0, files: [file(),
      { path: 'docs/state/A.md', markdown: doc('upper', 'system') },
      { path: 'docs/state/a.md', markdown: doc('lower', 'system') },
    ] })).rejects.toThrow('Duplicate');
    await expect(bundle.replace({ expectedRevision: 0, files: [file(),
      { path: 'docs/state/A/one.md', markdown: doc('upper', 'system') },
      { path: 'docs/state/a/two.md', markdown: doc('lower', 'system') },
    ] })).rejects.toThrow('Duplicate');
    await expect(bundle.replace({ expectedRevision: 0, files: Array.from({ length: 17 }, (_, i) => ({ path: `docs/state/${i}.md`, markdown: '' })) })).rejects.toThrow();
    await expect(bundle.replace({ expectedRevision: 0, files: Array.from({ length: 5 }, (_, i) => ({ path: `docs/state/${i}.md`, markdown: 'x'.repeat(60000) })) })).rejects.toThrow('256 KiB');
    await expect(bundle.replace({ expectedRevision: 0, files: [file('x'.repeat(65537))] })).rejects.toThrow();
  });
});

it('does not publish a replacement cancelled during validation and releases admission', async () => {
  const bundle = new DocumentBundle();
  const controller = new AbortController();
  const pending = bundle.replace({ expectedRevision: 0, files: [file()] }, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(() => bundle.read()).toThrow('No documents yet');
  expect((await bundle.replace({ expectedRevision: 0, files: [file()] })).revision).toBe(1);
});
