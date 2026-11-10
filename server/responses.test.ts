import { describe, expect, it } from 'vitest';
import type { DocumentResponse, UnknownDocumentResponse } from '../shared/api.js';
import { loadCatalog } from './catalog.js';
import { classifyReference, resolveReference } from './links.js';
import { documentResponse, markdownHrefs, searchResponse } from './responses.js';
import { doc, REPO, STATE, validTree } from './testing/documents.js';
import { memoryFiles } from './testing/memory-files.js';

async function setup(tree = validTree()) {
  const files = memoryFiles(tree);
  return { files, catalog: await loadCatalog(files, REPO) };
}

const chatFile = { kind: 'file', file: 'docs/state/services/chat/README.md' } as const;

describe('link resolution', () => {
  it('routes Markdown links inside docs/state to document IDs, keeping fragments', async () => {
    const { catalog } = await setup();
    expect(classifyReference('send/README.md', chatFile, catalog)).toEqual({ kind: 'document', id: 'chat-send', fragment: null });
    expect(classifyReference('send/', chatFile, catalog)).toEqual({ kind: 'document', id: 'chat-send', fragment: null });
    expect(classifyReference('send/submit.md#steps', chatFile, catalog)).toEqual({
      kind: 'document',
      id: 'chat-send-submit',
      fragment: 'steps',
    });
    expect(classifyReference('#local-heading', chatFile, catalog)).toEqual({ kind: 'anchor', fragment: 'local-heading' });
  });

  it('explains a link to a missing or rejected document instead of guessing', async () => {
    const tree = validTree();
    tree[`${STATE}/services/chat/broken.md`] = '# no frontmatter';
    const { catalog } = await setup(tree);
    expect(classifyReference('nope.md', chatFile, catalog)).toEqual({
      kind: 'unresolved',
      reason: 'no document at docs/state/services/chat/nope.md',
    });
    const rejected = classifyReference('broken.md', chatFile, catalog);
    expect(rejected).toMatchObject({ kind: 'unresolved' });
    expect(rejected.kind === 'unresolved' && rejected.reason).toContain('was rejected');
  });

  it('marks repository evidence with existence, without reading it', async () => {
    const { catalog, files } = await setup();
    expect(await resolveReference('../../../../src/chat.ts#L3', chatFile, catalog, files)).toEqual({
      kind: 'repo-file',
      path: 'src/chat.ts',
      fragment: 'L3',
      exists: true,
    });
    expect(await resolveReference('src/missing.ts', { kind: 'repository' }, catalog, files)).toMatchObject({ exists: false });
    expect(files.reads.filter((path) => !path.endsWith('.md'))).toEqual([]);
  });

  it('marks traversal out of the repository as an outside-repo reference and never touches it', async () => {
    const { catalog, files } = await setup();
    const before = files.reads.length;
    expect(await resolveReference('../../../../../../../etc/passwd', chatFile, catalog, files)).toEqual({
      kind: 'outside-repo',
      path: '../../../etc/passwd',
      fragment: null,
    });
    expect(await resolveReference('../nessa-ui/src/x.ts', { kind: 'repository' }, catalog, files)).toMatchObject({
      kind: 'outside-repo',
      path: '../nessa-ui/src/x.ts',
    });
    expect(files.reads.length).toBe(before);
  });

  it('refuses a repository path that escapes through a symlink', async () => {
    const tree = validTree();
    tree[`${REPO}/link`] = { symlink: '/etc' };
    tree['/etc/passwd'] = 'x';
    const { catalog, files } = await setup(tree);
    expect(await resolveReference('link/passwd', { kind: 'repository' }, catalog, files)).toMatchObject({ kind: 'unresolved' });
  });

  it('allows only http, https and mailto URLs, and refuses absolute and malformed paths', async () => {
    const { catalog } = await setup();
    expect(classifyReference('https://example.com/a b', chatFile, catalog)).toEqual({ kind: 'external', url: 'https://example.com/a%20b' });
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '/etc/passwd', '%zz', 'a\\b']) {
      expect(classifyReference(href, chatFile, catalog).kind, href).toBe('unresolved');
    }
  });
});

describe('documentResponse', () => {
  it('preserves accepted reserved and ordinary href/node keys as own JSON entries', async () => {
    const names = ['__proto__', 'constructor', 'ordinary'];
    const targets = names.map((name, index) => [name, `child-${index}`] as const);
    const tree = Object.fromEntries([
      [`${STATE}/README.md`, doc('nessa', null, { diagramLinks: Object.fromEntries(targets) },
        '```mermaid\nflowchart LR\n __proto__ --> constructor --> ordinary\n```\n\n' + names.map((name) => `[${name}](${name})`).join(' '))],
      ...targets.map(([name, id]) => [`${STATE}/${name}/README.md`, doc(id, 'nessa')]),
    ]);
    const { catalog, files } = await setup(tree);
    expect(catalog.issues).toEqual([]);
    const response = (await documentResponse(catalog, 'nessa', files)) as DocumentResponse;
    const wire = JSON.parse(JSON.stringify(response)) as DocumentResponse;
    for (const [name, id] of targets) {
      expect(Object.hasOwn(response.links, name), name).toBe(true);
      expect(Object.hasOwn(wire.links, name), name).toBe(true);
      expect(wire.links[name]).toEqual({ kind: 'document', id, fragment: null });
      expect(Object.hasOwn(response.diagramLinks, name), name).toBe(true);
      expect(Object.hasOwn(wire.diagramLinks, name), name).toBe(true);
      expect(wire.diagramLinks[name]).toEqual({ id, title: `Title ${id}` });
    }
  });

  it('gives each page a chart node links to as an overview: its opening below the title, else its summary', async () => {
    const tree = {
      [`${STATE}/README.md`]: doc('nessa', null, { diagramLinks: { Chat: 'chat', Bare: 'bare' } }, '# Nessa\n\n```mermaid\nflowchart LR\n Chat --> Bare\n```\n'),
      [`${STATE}/chat/README.md`]: doc('chat', 'nessa', {}, '# Chat\n\n```mermaid\nflowchart LR\n A --> B\n```\n\nChat carries messages. See [bare](../bare/README.md).\n\nIt keeps order.\n\n## Steps\n\nNot in the overview.\n'),
      [`${STATE}/bare/README.md`]: doc('bare', 'nessa', {}, '# Bare\n\n## Only sections\n\nText.\n'),
    };
    const { catalog, files } = await setup(tree);
    const response = (await documentResponse(catalog, 'nessa', files)) as DocumentResponse;
    const chat = response.linkedOverviews.chat;
    expect(chat).toMatchObject({ title: 'Title chat', gist: 'Summary of chat', file: 'docs/state/chat/README.md', truncated: false });
    expect(chat?.body).toContain('It keeps order.');
    expect(chat?.body).not.toContain('# Chat');
    expect(chat?.body).not.toContain('mermaid');
    expect(chat?.body).not.toContain('Not in the overview');
    expect(chat?.links['../bare/README.md']).toEqual({ kind: 'document', id: 'bare', fragment: null });
    expect(response.linkedOverviews.bare?.body).toBe('Summary of bare\n');
  });

  it('resolves every body link, the sources, diagram links, breadcrumbs and children', async () => {
    const { catalog, files } = await setup();
    const response = (await documentResponse(catalog, 'chat', files)) as DocumentResponse;
    expect(response.breadcrumbs.map((crumb) => crumb.id)).toEqual(['nessa', 'chat']);
    expect(response.children.map((child) => child.id)).toEqual(['chat-send']);
    expect(response.diagramLinks).toEqual({ Send: { id: 'chat-send', title: 'Title chat-send' } });
    expect(response.sources).toEqual([
      { raw: 'src/chat.ts', target: { kind: 'repo-file', path: 'src/chat.ts', fragment: null, exists: true } },
      { raw: '../nessa-ui/src/x.ts', target: { kind: 'outside-repo', path: '../nessa-ui/src/x.ts', fragment: null } },
    ]);
    expect(Object.keys(response.links).sort()).toEqual(
      markdownHrefs(response.body).sort(),
    );
    expect(response.links['javascript:alert(1)']).toMatchObject({ kind: 'unresolved' });
    expect(response.links['send/submit.md#steps']).toEqual({ kind: 'document', id: 'chat-send-submit', fragment: 'steps' });
  });

  it('answers unknown IDs with the rejections that declared them', async () => {
    const tree = validTree();
    tree[`${STATE}/services/chat/send/submit.md`] = doc('chat-send-submit', 'nowhere');
    const { catalog, files } = await setup(tree);
    const response = (await documentResponse(catalog, 'chat-send-submit', files)) as UnknownDocumentResponse;
    expect(response.error).toBe('unknown-document');
    expect(response.rejected.map((issue) => issue.code)).toEqual(['missing-parent']);
    expect(((await documentResponse(catalog, 'never', files)) as UnknownDocumentResponse).rejected).toEqual([]);
  });

  it('keeps hostile frontmatter text as data', async () => {
    const tree = validTree();
    tree[`${STATE}/services/chat/send/submit.md`] = doc('chat-send-submit', 'chat-send', {
      kind: 'flow',
      title: '<img src=x onerror=alert(1)>',
    });
    const { catalog, files } = await setup(tree);
    const response = (await documentResponse(catalog, 'chat-send-submit', files)) as DocumentResponse;
    expect(response.document.title).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('searchResponse', () => {
  it('finds loaded documents by title, id, summary and body, all terms required', async () => {
    const { catalog } = await setup();
    expect(searchResponse(catalog, 'title chat-send').results.map((result) => result.id)).toEqual(['chat-send', 'chat-send-submit']);
    expect(searchResponse(catalog, 'gateway').results.map((result) => result.id)).toEqual(['nessa']);
    expect(searchResponse(catalog, 'gateway nothing-matches').results).toEqual([]);
    expect(searchResponse(catalog, '   ').results).toEqual([]);
  });
});
