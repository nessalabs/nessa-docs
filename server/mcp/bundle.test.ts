import { describe, expect, it } from 'vitest';
import { DocumentBundle } from './bundle';
import { doc } from '../testing/documents';
import { readSnapshot as readPayload } from '../../shared/mcp-payload';
import { configView } from './config-view';
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
    await expect(bundle.replace({ expectedRevision: 0, files: [file(), ...Array.from({ length: 64 }, (_, i) => ({ path: `docs/state/child${i}.md`, markdown: doc(`child${i}`, 'system') }))] })).rejects.toThrow('64');
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


it('loads a 14-page atlas with six linked model pairs into the embedded reader', async () => {
  const { modeledAtlas } = await import('../testing/modeled-atlas');
  const { readSnapshot } = await import('../../shared/mcp-payload');
  const snapshot = await new DocumentBundle().replace({ expectedRevision: 0, files: modeledAtlas() });
  expect(snapshot.files).toHaveLength(26);
  expect(readSnapshot(snapshot).documents).toHaveLength(14);
});

it('carries the project config: pills to bundle pages, cards, and a refusal for a broken config', async () => {
    const bundle = new DocumentBundle();
    const config = { path: 'docs/state/nessa-docs.yaml', text: "references:\n  - name: page\n    match: '\\[\\[(?<id>[a-z-]+)\\]\\]'\n    open: { document: '{id}' }\ncards:\n  pairing: { look: handoff }\n" };
    const snapshot = await bundle.replace({ expectedRevision: 0, files: [file(doc('system', null, {}, 'See [[child]].\n\n```mermaid card=pairing\nsequenceDiagram\n A->>B: x\n```\n')), { path: 'docs/state/child.md', markdown: doc('child', 'system') }, config] });
    const system = snapshot.documents.find((entry) => entry.document.id === 'system');
    expect(system?.references['page\u0000[[child]]']).toMatchObject({ target: { kind: 'document', id: 'child' } });
    expect(system?.cards.pairing).toMatchObject({ look: 'handoff', family: 'sequence' });
    expect(readPayload(JSON.parse(JSON.stringify(snapshot))).documents.length).toBe(2);
    await expect(bundle.replace({ expectedRevision: 1, files: [file(), { ...config, text: 'references: 3\n' }] })).rejects.toThrow('nessa-docs.yaml');
    expect(configView(config.text)).toMatchObject({ present: true, valid: true, references: [{ name: 'page' }] });
    expect(configView(null)).toMatchObject({ present: false, valid: true, stateRoles: expect.arrayContaining(['waiting', 'refused']) });
});
