import { describe, expect, it } from 'vitest';
import type { DocumentResponse } from '../shared/api.js';
import { referenceKey } from '../shared/references.js';
import { loadCatalog } from './catalog.js';
import { documentResponse } from './responses.js';
import { doc, REPO, STATE } from './testing/documents.js';
import { memoryFiles } from './testing/memory-files.js';

const CONFIG = `
references:
  - name: adr
    match: 'ADR-?(?<n>\\d{1,4})'
    label: 'ADR {n}'
    open:
      - { file: 'docs/adr/{n:04}-*.md' }
      - { file: 'docs/decisions.md', heading: 'ADR-{n} *' }
  - name: page
    match: '\\[\\[(?<id>[a-z0-9-]+)\\]\\]'
    open: { document: '{id}' }
  - name: issue
    match: 'nessa#(?<n>\\d+)'
    open: { url: 'https://github.com/nessalabs/nessa/issues/{n}' }
  - name: spec
    match: 'SPEC-(?<n>\\d+)'
    open: { file: 'specs/{n}.md' }
notes: [docs/adr, docs/decisions.md]
`;

function tree(body: string, extra: Record<string, string> = {}) {
  return {
    [`${STATE}/README.md`]: doc('nessa', null, {}, body),
    [`${STATE}/services/pairing.md`]: doc('pairing', 'nessa', {}, '# Pairing\n\n## Scan\n\nThe phone scans a code.\n\n## Accept\n\nThe Mac accepts.\n'),
    [`${STATE}/nessa-docs.yaml`]: CONFIG,
    [`${REPO}/docs/adr/0202-migrations.md`]: '---\nstatus: accepted\n---\n# ADR 202: Migrations\n\nEvery schema change raises the version. See [the guide](../guide.md).\n',
    [`${REPO}/docs/adr/0007-a.md`]: '# ADR 7 one\n',
    [`${REPO}/docs/adr/0007-b.md`]: '# ADR 7 two\n',
    [`${REPO}/docs/decisions.md`]: '# Decisions\n\n## ADR-9 Keep one store\n\nOne store owns it.\n\n### Why\n\nFewer copies.\n\n## ADR-10 Other\n\nOther.\n',
    [`${REPO}/docs/guide.md`]: '# Guide\n',
    [`${REPO}/specs/4.md`]: '# Spec four\n',
    ...extra,
  };
}

async function page(body: string, extra: Record<string, string> = {}) {
  const files = memoryFiles(tree(body, extra));
  const catalog = await loadCatalog(files, REPO);
  const response = (await documentResponse(catalog, 'nessa', files)) as DocumentResponse;
  return { catalog, response, files };
}

const ref = (response: DocumentResponse, rule: string, text: string) => response.references[referenceKey(rule, text)];

describe('reference pills', () => {
  it('opens a note file found by glob, with its preview and links resolved from that file', async () => {
    const { response, catalog } = await page('# Nessa\n\nWe follow ADR-202.\n');
    expect(catalog.issues).toEqual([]);
    expect(response.referenceRules.map((rule) => rule.name)).toEqual(['adr', 'page', 'issue', 'spec']);
    const adr = ref(response, 'adr', 'ADR-202');
    expect(adr).toMatchObject({ rule: 'adr', label: 'ADR 202', target: { kind: 'repo-file', path: 'docs/adr/0202-migrations.md', exists: true } });
    expect(adr?.preview?.title).toBe('ADR 202: Migrations');
    expect(adr?.preview?.body).not.toContain('status: accepted');
    expect(adr?.preview?.links['../guide.md']).toMatchObject({ kind: 'repo-file', path: 'docs/guide.md', exists: true });
  });

  it('falls through to a heading in a shared file and shows only that section', async () => {
    const { response } = await page('# Nessa\n\nPer ADR-9.\n');
    const adr = ref(response, 'adr', 'ADR-9');
    expect(adr?.target).toMatchObject({ kind: 'repo-file', path: 'docs/decisions.md', fragment: 'adr-9-keep-one-store' });
    expect(adr?.preview?.title).toBe('ADR-9 Keep one store');
    expect(adr?.preview?.body).toContain('Fewer copies.');
    expect(adr?.preview?.body).not.toContain('ADR-10');
  });

  it('refuses to guess between two files and says why', async () => {
    const { response } = await page('# Nessa\n\nADR-7.\n');
    const adr = ref(response, 'adr', 'ADR-7');
    expect(adr?.target.kind).toBe('unresolved');
    expect(adr?.target.kind === 'unresolved' && adr.target.reason).toContain('matches 2 files');
    expect(response.issues.map((issue) => issue.code)).toContain('unresolved-reference');
  });

  it('opens a page, a section of a page and a URL', async () => {
    const { response } = await page('# Nessa\n\n[[pairing]] and nessa#12.\n');
    expect(ref(response, 'page', '[[pairing]]')).toMatchObject({ target: { kind: 'document', id: 'pairing', fragment: null } });
    expect(ref(response, 'page', '[[pairing]]')?.preview?.title).toBe('Title pairing');
    expect(ref(response, 'issue', 'nessa#12')).toMatchObject({ target: { kind: 'external', url: 'https://github.com/nessalabs/nessa/issues/12' }, preview: null });
  });

  it('links a file outside the notes folders without reading it', async () => {
    const { response, files } = await page('# Nessa\n\nSPEC-4.\n');
    expect(ref(response, 'spec', 'SPEC-4')).toMatchObject({ target: { kind: 'repo-file', path: 'specs/4.md', exists: true }, preview: null });
    expect(files.reads).not.toContain(`${REPO}/specs/4.md`);
  });

  it('does not follow a symlink in a notes folder to a file elsewhere', async () => {
    const files = memoryFiles({ ...tree('# Nessa\n\nADR-300.\n'), [`${REPO}/docs/adr/0300-x.md`]: { symlink: `${REPO}/secret.md` }, [`${REPO}/secret.md`]: '# Secret\n' });
    const catalog = await loadCatalog(files, REPO);
    const response = (await documentResponse(catalog, 'nessa', files)) as DocumentResponse;
    // A glob lists regular files only, so the symlink is not a match; nothing outside the notes is read.
    expect(ref(response, 'adr', 'ADR-300')).toMatchObject({ target: { kind: 'unresolved' }, preview: null });
    expect(files.reads).not.toContain(`${REPO}/secret.md`);
  });

  it('names a file reached through a symlink without showing it', async () => {
    const config = CONFIG.replace("open: { file: 'specs/{n}.md' }", "open: { file: 'docs/adr/{n}.md' }");
    const files = memoryFiles({ ...tree('# Nessa\n\nSPEC-5.\n'), [`${STATE}/nessa-docs.yaml`]: config, [`${REPO}/docs/adr/5.md`]: { symlink: `${REPO}/secret.md` }, [`${REPO}/secret.md`]: '# Secret\n' });
    const catalog = await loadCatalog(files, REPO);
    const response = (await documentResponse(catalog, 'nessa', files)) as DocumentResponse;
    expect(ref(response, 'spec', 'SPEC-5')).toMatchObject({ target: { kind: 'repo-file', path: 'docs/adr/5.md', exists: true }, preview: null });
    expect(files.reads).not.toContain(`${REPO}/secret.md`);
  });

  it('skips code and link text', async () => {
    const { response } = await page('# Nessa\n\n`ADR-202`, [ADR-202](https://x.test) and\n\n```\nADR-202\n```\n');
    expect(response.references).toEqual({});
  });

  it('warns about unknown or unfitting cards and missing checkpoints', async () => {
    const body = '# Nessa\n\n```mermaid card=nope\nflowchart LR\n A-->B\n```\n\n```mermaid card=handoff\nstateDiagram-v2\n [*] --> A\n```\n\n```mermaid card=lifecycle title="Ok"\nstateDiagram-v2\n [*] --> A\n```\n';
    const files = memoryFiles({ ...tree(body), [`${STATE}/nessa-docs.yaml`]: 'authoring:\n  requireSourceRevision: true\n' });
    const catalog = await loadCatalog(files, REPO);
    const codes = catalog.issues.map((issue) => issue.code);
    expect(codes.filter((code) => code === 'unknown-card')).toHaveLength(1);
    expect(codes.filter((code) => code === 'card-family-mismatch')).toHaveLength(1);
    expect(codes.filter((code) => code === 'missing-source-revision')).toHaveLength(2);
  });

  it('reports a broken config as an error on the config file and keeps defaults', async () => {
    const files = memoryFiles({ ...tree('# Nessa\n\nADR-202\n'), [`${STATE}/nessa-docs.yaml`]: 'references: nope\n' });
    const catalog = await loadCatalog(files, REPO);
    expect(catalog.issues).toEqual([expect.objectContaining({ file: 'docs/state/nessa-docs.yaml', code: 'invalid-config', severity: 'error' })]);
    const response = (await documentResponse(catalog, 'nessa', files)) as DocumentResponse;
    expect(response.references).toEqual({});
    expect(Object.keys(response.cards).sort()).toEqual(['handoff', 'lifecycle', 'map', 'plain']);
  });

  it('changes the catalog version when the config changes', async () => {
    const a = await loadCatalog(memoryFiles(tree('# Nessa\n')), REPO);
    const b = await loadCatalog(memoryFiles({ ...tree('# Nessa\n'), [`${STATE}/nessa-docs.yaml`]: 'notes: []\n' }), REPO);
    expect(a.version).not.toBe(b.version);
  });

  it('resolves a page of many references quickly, reading each note once', async () => {
    const body = `# Nessa\n\n${Array.from({ length: 2000 }, (_, i) => `ADR-202 and [[pairing]] and nessa#${i}.`).join('\n\n')}\n`;
    const files = memoryFiles(tree(body));
    const catalog = await loadCatalog(files, REPO);
    const start = performance.now();
    const response = (await documentResponse(catalog, 'nessa', files)) as DocumentResponse;
    const took = performance.now() - start;
    expect(Object.keys(response.references)).toHaveLength(2002);
    expect(files.reads.filter((path) => path.endsWith('0202-migrations.md'))).toHaveLength(1);
    expect(took).toBeLessThan(2_000);
  });
});
