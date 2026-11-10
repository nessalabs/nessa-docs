import { describe, expect, it } from 'vitest';
import type { DocumentResponse } from '../shared/api.js';
import { compileRules, findReferences, glossaryRegex, referenceKey } from '../shared/references.js';
import { loadCatalog } from './catalog.js';
import { firstParagraph, GIST_MAX_CHARS, readGlossary, unlistedAcronyms } from './glossary.js';
import { lexMarkdown } from '../shared/markdown.js';
import { documentResponse } from './responses.js';
import { doc, REPO, STATE } from './testing/documents.js';
import { memoryFiles } from './testing/memory-files.js';

const ROOT_GLOSSARY = '# Glossary\n\n## SDK\n\nSoftware development kit. The library every agent links.\n\n## ADR\n\nArchitecture decision record.\n\n## MCP\n\nModel Context Protocol, the root meaning.\n';
const SDK_GLOSSARY = '# SDK glossary\n\n## MCP\n\nThe SDK\'s MCP relay, nearer than the root.\n\n## WAL\n\nWrite-ahead log. See [storage](storage.md).\n';

function tree(pages: Record<string, string>, config = '') {
  return memoryFiles({
    [`${STATE}/README.md`]: doc('nessa', null, {}, '# Nessa\n\nThe SDK speaks MCP.\n'),
    [`${STATE}/glossary.md`]: doc('glossary', 'nessa', { kind: 'guide', status: 'reference' }, ROOT_GLOSSARY),
    [`${STATE}/sdk/README.md`]: doc('sdk', 'nessa', {}, '# SDK\n\nThe SDK writes a WAL and relays MCP.\n'),
    [`${STATE}/sdk/glossary.md`]: doc('sdk-glossary', 'sdk', { kind: 'guide', status: 'reference' }, SDK_GLOSSARY),
    [`${STATE}/sdk/storage.md`]: doc('storage', 'sdk', {}, '# Storage\n'),
    ...(config ? { [`${STATE}/nessa-docs.yaml`]: config } : {}),
    ...pages,
  });
}

async function open(id: string, pages: Record<string, string> = {}, config = '') {
  const files = tree(pages, config);
  const catalog = await loadCatalog(files, REPO);
  return { catalog, response: (await documentResponse(catalog, id, files)) as DocumentResponse };
}

describe('glossary pages', () => {
  it('reads one entry per ## heading, with its anchor and first paragraph', () => {
    const read = readGlossary('g', 'docs/state/glossary.md', ROOT_GLOSSARY);
    expect(read.problems).toEqual([]);
    expect(read.entries.map((entry) => [entry.term, entry.fragment, entry.gist])).toEqual([
      ['SDK', 'sdk', 'Software development kit. The library every agent links.'],
      ['ADR', 'adr', 'Architecture decision record.'],
      ['MCP', 'mcp', 'Model Context Protocol, the root meaning.'],
    ]);
  });

  it('refuses a heading that is not a term, a term listed twice, and a term with no meaning', () => {
    const read = readGlossary('g', 'g.md', '## Two words\n\nNo.\n\n## API\n\nOne.\n\n## API\n\nTwo.\n\n## TLA+\n\n```\ncode only\n```\n');
    expect(read.entries.map((entry) => entry.term)).toEqual(['API']);
    expect(read.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('"## Two words" is not a term'),
      expect.stringContaining('"API" is listed twice'),
      expect.stringContaining('"TLA+" has no meaning'),
    ]);
  });

  it('cuts a long first paragraph at a word', () => {
    const gist = firstParagraph(lexMarkdown(`${'word '.repeat(200)}\n`));
    expect(gist.length).toBeLessThanOrEqual(GIST_MAX_CHARS + 1);
    expect(gist.endsWith('word…')).toBe(true);
  });
});

describe('glossary links', () => {
  it('links each term to its entry, with the entry as the peek and its first paragraph as the hover', async () => {
    const { response, catalog } = await open('nessa');
    expect(catalog.issues).toEqual([]);
    expect(response.referenceRules).toEqual([{ name: 'glossary', terms: ['ADR', 'MCP', 'SDK'] }]);
    const sdk = response.references[referenceKey('glossary', 'SDK')];
    expect(sdk).toMatchObject({ rule: 'glossary', label: 'SDK', target: { kind: 'document', id: 'glossary', fragment: 'sdk' } });
    expect(sdk?.preview).toMatchObject({ title: 'SDK', gist: 'Software development kit. The library every agent links.', file: 'docs/state/glossary.md' });
    expect(sdk?.preview?.body).not.toContain('ADR');
  });

  it('lets the nearest glossary win a term and adds its own, for that folder and below only', async () => {
    const { response } = await open('sdk');
    expect(response.referenceRules).toEqual([{ name: 'glossary', terms: ['ADR', 'MCP', 'SDK', 'WAL'] }]);
    expect(response.references[referenceKey('glossary', 'MCP')]?.target).toMatchObject({ id: 'sdk-glossary', fragment: 'mcp' });
    const wal = response.references[referenceKey('glossary', 'WAL')];
    expect(wal?.preview?.links['storage.md']).toMatchObject({ kind: 'document', id: 'storage' });
    const root = await open('nessa');
    expect(root.response.references[referenceKey('glossary', 'MCP')]?.target).toMatchObject({ id: 'glossary' });
  });

  it('matches a plural and never part of a word, and leaves a configured pill to its own rule', async () => {
    const config = "references:\n  - name: adr\n    match: 'ADR-(?<n>\\d+)'\n    open: { url: 'https://example.com/{n}' }\n";
    const { response } = await open('nessa', { [`${STATE}/README.md`]: doc('nessa', null, {}, '# Nessa\n\nTwo SDKs, an SDKX, ADR-12 and an ADR.\n') }, config);
    expect(Object.keys(response.references).sort()).toEqual([referenceKey('adr', 'ADR-12'), referenceKey('glossary', 'ADR'), referenceKey('glossary', 'SDKs')].sort());
    expect(response.references[referenceKey('glossary', 'SDKs')]?.target).toMatchObject({ fragment: 'sdk' });
  });

  it('refuses a project reference named glossary', async () => {
    const config = "references:\n  - name: glossary\n    match: 'X-\\d+'\n    open: { url: 'https://example.com' }\n";
    const { catalog } = await open('nessa', {}, config);
    expect(catalog.issues.find((issue) => issue.code === 'invalid-config')?.message).toContain('built-in glossary');
  });

  it('has no glossary rule where no glossary covers the page', async () => {
    const files = memoryFiles({ [`${STATE}/README.md`]: doc('nessa', null, {}, '# Nessa\n\nThe SDK.\n') });
    const catalog = await loadCatalog(files, REPO);
    const response = (await documentResponse(catalog, 'nessa', files)) as DocumentResponse;
    expect(response.referenceRules).toEqual([]);
    expect(catalog.issues).toEqual([]);
  });
});

describe('unlisted acronyms', () => {
  it('names each acronym a covered page uses that no glossary lists, and the glossary to add it to', async () => {
    const { catalog } = await open('nessa', {
      [`${STATE}/sdk/flow.md`]: doc('flow', 'sdk', {}, '# Flow\n\nThe SDK sends a PR over HTTP2, then the CI runs. `GET` and [UI](storage.md) are code and link text.\n'),
    });
    const warning = catalog.issues.find((issue) => issue.code === 'unlisted-acronym');
    expect(warning).toMatchObject({ file: 'docs/state/sdk/flow.md', severity: 'warning' });
    expect(warning?.message).toContain('uses PR, HTTP2, CI,');
    expect(warning?.message).toContain('docs/state/sdk/glossary.md');
    expect(warning?.message).not.toContain('GET');
    expect(warning?.message).not.toContain('UI');
  });

  it('does not check a project that has no glossary', async () => {
    const files = memoryFiles({ [`${STATE}/README.md`]: doc('nessa', null, {}, '# Nessa\n\nThe PR and CI.\n') });
    expect((await loadCatalog(files, REPO)).issues).toEqual([]);
  });
});

describe('glossary pattern', () => {
  it('escapes terms and is fast on a megabyte of text with a thousand terms', () => {
    expect(glossaryRegex(['TLA+', 'I/O']).source).toContain('TLA\\+');
    const [rule] = compileRules([{ name: 'glossary', terms: ['TLA+', 'I/O', 'not a term'] }]);
    expect(findReferences('Check TLA+ and I/O.', [rule!]).map((match) => match.text)).toEqual(['TLA+', 'I/O']);
    const terms = Array.from({ length: 1000 }, (_, at) => `T${at.toString(36).toUpperCase()}X`);
    const [many] = compileRules([{ name: 'glossary', terms }]);
    const text = 'Plain words and T1X here, MORE CAPS there. '.repeat(25_000);
    const started = performance.now();
    const found = findReferences(text, [many!]);
    expect(found.length).toBe(25_000);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('review fixes', () => {
  it('needs two capitals in a term, so a section such as ## Overview is refused and never links', () => {
    const read = readGlossary('g', 'g.md', '## Overview\n\nAbout this page.\n\n## gRPC\n\nRemote calls.\n\n## I/O\n\nInput and output.\n');
    expect(read.entries.map((entry) => entry.term)).toEqual(['gRPC', 'I/O']);
    expect(read.problems[0]?.message).toContain('"## Overview" is not a term');
  });

  it('does not link a glossary page to itself', async () => {
    const { response } = await open('glossary');
    expect(response.referenceRules).toEqual([]);
    expect(response.references).toEqual({});
  });

  it('keeps the nearest override when the cap cuts terms', async () => {
    const many = Array.from({ length: 1000 }, (_, at) => `## T${at}X\n\nTerm ${at}.\n`).join('\n');
    const files = memoryFiles({
      [`${STATE}/README.md`]: doc('nessa', null, {}, '# Nessa\n'),
      [`${STATE}/glossary.md`]: doc('glossary', 'nessa', { kind: 'guide', status: 'reference' }, `# Glossary\n\n## MCP\n\nRoot.\n\n${many}`),
      [`${STATE}/sdk/README.md`]: doc('sdk', 'nessa', {}, '# SDK\n\nThe MCP relay.\n'),
      [`${STATE}/sdk/glossary.md`]: doc('sdk-glossary', 'sdk', { kind: 'guide', status: 'reference' }, '# SDK glossary\n\n## MCP\n\nNear.\n'),
    });
    const catalog = await loadCatalog(files, REPO);
    const scope = catalog.glossary.forFile('docs/state/sdk/README.md');
    expect(scope.size).toBe(1000);
    expect(scope.get('MCP')?.documentId).toBe('sdk-glossary');
  });

  it('does not let glossary entries use up the preview budget of project pills', async () => {
    const terms = Array.from({ length: 120 }, (_, at) => `G${at}X`);
    const config = "references:\n  - name: page\n    match: '\\[\\[(?<id>[a-z-]+)\\]\\]'\n    open: { document: '{id}' }\n";
    const { response } = await open('nessa', {
      [`${STATE}/glossary.md`]: doc('glossary', 'nessa', { kind: 'guide', status: 'reference' }, terms.map((term) => `## ${term}\n\nMeaning.\n`).join('\n')),
      [`${STATE}/README.md`]: doc('nessa', null, {}, `# Nessa\n\n${terms.join(' ')} then [[storage]].\n`),
    }, config);
    expect(response.references[referenceKey('page', '[[storage]]')]?.preview).not.toBeNull();
  });

  it('cuts a hover text and a long summary so the bundle schema accepts them, never inside an emoji', async () => {
    expect(firstParagraph(lexMarkdown(`a${'😀'.repeat(200)}\n`)).match(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)).toBeNull();
    const long = 'word '.repeat(400).trim();
    const files = memoryFiles({
      [`${STATE}/README.md`]: doc('nessa', null, { diagramLinks: { Child: 'child' } }, '# Nessa\n\n```mermaid\nflowchart LR\n Child\n```\n'),
      [`${STATE}/child.md`]: doc('child', 'nessa', { summary: long, title: 'T'.repeat(800) }, '# Child\n'),
    });
    const catalog = await loadCatalog(files, REPO);
    const overview = ((await documentResponse(catalog, 'nessa', files)) as DocumentResponse).linkedOverviews.child;
    expect(overview?.gist.length).toBeLessThanOrEqual(GIST_MAX_CHARS + 1);
    expect(overview?.title.length).toBeLessThanOrEqual(500);
  });

  it('scans a long run of capitals in linear time', async () => {
    const started = performance.now();
    expect(unlistedAcronyms(`${'A'.repeat(64_000)}b and the CI.\n`, [])).toEqual(['CI']);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
