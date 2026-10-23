import { describe, expect, it } from 'vitest';
import type { IssueCode } from '../shared/api.js';
import { loadCatalog } from './catalog.js';
import { doc, markdown, REPO, STATE, validTree } from './testing/documents.js';
import { memoryFiles } from './testing/memory-files.js';

async function load(tree: ReturnType<typeof validTree>, limits?: Parameters<typeof loadCatalog>[2]) {
  const files = memoryFiles(tree);
  return { files, catalog: await loadCatalog(files, REPO, limits) };
}

function codes(catalog: Awaited<ReturnType<typeof loadCatalog>>, file?: string): IssueCode[] {
  return catalog.issues.filter((issue) => file === undefined || issue.file === file).map((issue) => issue.code);
}

describe('loadCatalog: valid tree', () => {
  it('accepts every document and links parents to children in path order', async () => {
    const { catalog } = await load(validTree());
    expect(catalog.issues).toEqual([]);
    expect(catalog.rootId).toBe('nessa');
    expect([...catalog.documents.keys()]).toEqual(['nessa', 'chat', 'chat-send', 'chat-send-submit']);
    expect(catalog.documents.get('nessa')?.summary.children).toEqual(['chat']);
    expect(catalog.documents.get('chat-send')?.summary).toMatchObject({
      parent: 'chat',
      kind: 'feature',
      file: 'docs/state/services/chat/send/README.md',
      children: ['chat-send-submit'],
    });
    expect(catalog.documentByFile.get('docs/state/services/chat/send/submit.md')).toBe('chat-send-submit');
  });

  it('reads only Markdown inside docs/state', async () => {
    const { files } = await load(validTree());
    expect(files.reads.every((path) => path.startsWith(`${STATE}/`) && path.endsWith('.md'))).toBe(true);
    expect(files.reads).not.toContain(`${REPO}/src/chat.ts`);
  });

  it('changes version when any file changes', async () => {
    const a = (await load(validTree())).catalog.version;
    const tree = validTree();
    tree[`${STATE}/services/chat/send/submit.md`] += '\nmore';
    expect((await load(tree)).catalog.version).not.toBe(a);
  });

  it('refuses YAML tags rather than interpreting them', async () => {
    const tree = validTree();
    tree[`${STATE}/services/chat/send/submit.md`] =
      '---\nid: chat-send-submit\ntitle: "<script>alert(1)</script>"\nkind: flow\nstatus: proposed\nsummary: !!js/function "function () {}"\nparent: chat-send\nsources: []\ndiagramLinks: {}\n---\nBody';
    const { catalog } = await load(tree);
    expect(codes(catalog, 'docs/state/services/chat/send/submit.md')).toEqual(['malformed-yaml']);
    expect(catalog.documents.has('chat-send-submit')).toBe(false);
  });
});

describe('loadCatalog: rejected metadata', () => {
  const file = 'docs/state/services/chat/send/submit.md';
  const replace = (text: string) => {
    const tree = validTree();
    tree[`${STATE}/services/chat/send/submit.md`] = text;
    return tree;
  };

  it('reports a file with no frontmatter by name', async () => {
    const { catalog } = await load(replace('# just prose\n'));
    expect(catalog.issues).toEqual([
      expect.objectContaining({ file, code: 'missing-frontmatter', severity: 'error', documentId: null }),
    ]);
    expect(catalog.rejectedFiles.has(file)).toBe(true);
  });

  it('reports malformed YAML', async () => {
    const { catalog } = await load(replace('---\nid: [unclosed\n---\n'));
    expect(codes(catalog, file)).toContain('malformed-yaml');
  });

  it('refuses YAML aliases and a non-mapping frontmatter', async () => {
    expect(codes((await load(replace('---\n- a\n- b\n---\n'))).catalog, file)).toEqual(['malformed-yaml']);
    const aliased = '---\nid: &x chat-send-submit\ntitle: *x\nkind: flow\nstatus: fixture\nsummary: s\nparent: chat-send\nsources: []\ndiagramLinks: {}\n---\n';
    expect(codes((await load(replace(aliased))).catalog, file)).toContain('malformed-yaml');
  });

  it('names every missing field', async () => {
    const { catalog } = await load(replace(markdown({ id: 'chat-send-submit', title: 'T' })));
    const missing = catalog.issues.filter((issue) => issue.code === 'missing-field').map((issue) => issue.message);
    expect(missing).toHaveLength(6);
    expect(missing.join(' ')).toContain('"diagramLinks"');
  });

  it.each([
    ['id', 'Chat_Send'],
    ['id', 'chat--send'],
    ['id', 42],
    ['kind', 'widget'],
    ['status', 'done'],
    ['title', ''],
    ['summary', ['a']],
    ['parent', '../chat'],
    ['sources', 'src/a.ts'],
    ['sources', ['/etc/passwd']],
    ['sources', ['https://example.com']],
    ['diagramLinks', ['a']],
    ['diagramLinks', { 'bad node': 'chat' }],
    ['diagramLinks', { Node: 'Not An Id' }],
  ])('rejects invalid %s %j', async (field, value) => {
    const { catalog } = await load(replace(doc('chat-send-submit', 'chat-send', { [field]: value })));
    expect(codes(catalog, file)).toContain('invalid-field');
    expect(catalog.issues.find((issue) => issue.code === 'invalid-field')?.message).toContain(field);
    expect(catalog.documents.has('chat-send-submit')).toBe(false);
  });

  it('warns about unknown fields without rejecting', async () => {
    const { catalog } = await load(replace(doc('chat-send-submit', 'chat-send', { order: 3 })));
    expect(catalog.issues).toEqual([expect.objectContaining({ file, code: 'unknown-field', severity: 'warning' })]);
    expect(catalog.documents.has('chat-send-submit')).toBe(true);
  });
});

describe('loadCatalog: identity and hierarchy', () => {
  it('rejects every file that declares a duplicate ID and the children that depend on it', async () => {
    const tree = validTree();
    tree[`${STATE}/services/other/README.md`] = doc('chat-send', 'nessa');
    const { catalog } = await load(tree);
    const duplicate = catalog.issues.filter((issue) => issue.code === 'duplicate-id');
    expect(duplicate.map((issue) => issue.file).sort()).toEqual([
      'docs/state/services/chat/send/README.md',
      'docs/state/services/other/README.md',
    ]);
    expect(duplicate[0]?.message).toContain('also declared by');
    expect(codes(catalog, 'docs/state/services/chat/send/submit.md')).toEqual(['parent-rejected']);
    expect(catalog.documents.has('chat-send')).toBe(false);
  });

  it('rejects a missing parent', async () => {
    const tree = validTree();
    tree[`${STATE}/services/chat/send/submit.md`] = doc('chat-send-submit', 'nowhere');
    const { catalog } = await load(tree);
    expect(catalog.issues).toEqual([
      expect.objectContaining({ code: 'missing-parent', documentId: 'chat-send-submit', message: expect.stringContaining('"nowhere"') }),
    ]);
  });

  it('rejects a parent cycle and everything below it', async () => {
    const tree = validTree();
    tree[`${STATE}/services/a/README.md`] = doc('a', 'b');
    tree[`${STATE}/services/b/README.md`] = doc('b', 'a');
    tree[`${STATE}/services/b/leaf.md`] = doc('leaf', 'b');
    const { catalog } = await load(tree);
    expect(codes(catalog, 'docs/state/services/a/README.md')).toContain('parent-cycle');
    expect(codes(catalog, 'docs/state/services/b/README.md')).toContain('parent-cycle');
    expect(codes(catalog, 'docs/state/services/b/leaf.md')).toEqual(['parent-rejected']);
    expect(catalog.documents.has('chat')).toBe(true);
  });

  it('rejects a self-parent', async () => {
    const tree = validTree();
    tree[`${STATE}/services/a/README.md`] = doc('a', 'a');
    expect(codes((await load(tree)).catalog, 'docs/state/services/a/README.md')).toEqual(['parent-cycle']);
  });

  it('rejects unknown diagramLinks targets', async () => {
    const tree = validTree();
    tree[`${STATE}/README.md`] = doc('nessa', null, { diagramLinks: { Chat: 'chat', Ghost: 'ghost' } }, '```mermaid\nflowchart LR\nChat-->Ghost\n```\n');
    const { catalog } = await load(tree);
    expect(codes(catalog, 'docs/state/README.md')).toEqual(['unknown-diagram-target']);
    expect(catalog.issues[0]?.message).toContain('Ghost → "ghost"');
    expect(catalog.rootId).toBeNull();
    expect(catalog.documents.size).toBe(0);
  });

  it('requires the root README with parent null and nothing else with parent null', async () => {
    const tree = validTree();
    tree[`${STATE}/services/stray/README.md`] = doc('stray', null);
    expect(codes((await load(tree)).catalog, 'docs/state/services/stray/README.md')).toEqual(['misplaced-root']);

    const noRoot = validTree();
    delete noRoot[`${STATE}/README.md`];
    const { catalog } = await load(noRoot);
    expect(codes(catalog, 'docs/state/README.md')).toEqual(['missing-root']);
    expect(codes(catalog, 'docs/state/services/chat/README.md')).toEqual(['missing-parent']);
  });

  it('warns when the parent disagrees with the directory, and about diagram links no diagram uses', async () => {
    const tree = validTree();
    tree[`${STATE}/services/chat/send/submit.md`] = doc('chat-send-submit', 'chat', { diagramLinks: { Nope: 'chat' } });
    const { catalog } = await load(tree);
    expect(codes(catalog)).toEqual(['parent-location-mismatch', 'unused-diagram-link']);
    expect(catalog.documents.get('chat-send-submit')?.warnings).toHaveLength(2);
  });
});

describe('loadCatalog: filesystem boundaries', () => {
  it('reports a missing docs/state directory explicitly', async () => {
    const { catalog } = await load({ [`${REPO}/README.md`]: 'x' });
    expect(codes(catalog)).toEqual(['state-directory-missing']);
  });

  it('refuses a docs/state that is a symlink out of the repository', async () => {
    const { catalog, files } = await load({
      [`${REPO}/docs/state`]: { symlink: '/elsewhere/state' },
      '/elsewhere/state/README.md': doc('nessa', null),
    });
    expect(codes(catalog)).toEqual(['state-directory-escape']);
    expect(files.reads).toEqual([]);
  });

  it('does not follow a symlink that escapes docs/state, and says so', async () => {
    const tree = validTree();
    tree[`${STATE}/services/leak.md`] = { symlink: '/etc/passwd' };
    tree[`${STATE}/services/leakdir`] = { symlink: '../../../../outside' };
    tree['/outside/secret.md'] = doc('secret', 'nessa');
    tree['/etc/passwd'] = 'root:x';
    const { catalog, files } = await load(tree);
    expect(codes(catalog)).toEqual(['symlink-escape', 'symlink-escape']);
    expect(files.reads.some((path) => !path.startsWith(`${STATE}/`))).toBe(false);
    expect(catalog.documents.has('secret')).toBe(false);
  });

  it('reports, but does not follow, a symlink inside docs/state', async () => {
    const tree = validTree();
    tree[`${STATE}/services/alias.md`] = { symlink: 'chat/README.md' };
    const { catalog } = await load(tree);
    expect(catalog.issues).toEqual([expect.objectContaining({ code: 'symlink-not-followed', severity: 'warning' })]);
    expect(catalog.documents.size).toBe(4);
  });

  it('bounds file size, file count, and depth', async () => {
    const tree = validTree();
    tree[`${STATE}/services/big.md`] = doc('big', 'nessa', {}, 'x'.repeat(5000));
    tree[`${STATE}/a/b/c/deep.md`] = doc('deep', 'nessa');
    const { catalog } = await load(tree, { maxBytes: 4000, maxFiles: 100, maxDepth: 2 });
    expect(codes(catalog, 'docs/state/services/big.md')).toEqual(['file-too-large']);
    expect(codes(catalog, 'docs/state/a/b/c')).toEqual(['too-deep']);

    const few = await load(validTree(), { maxBytes: 100_000, maxFiles: 2, maxDepth: 12 });
    expect(codes(few.catalog)).toContain('too-many-files');
    expect(few.files.reads).toHaveLength(2);
  });
});


describe('source review revision', () => {
  it('publishes exact page revisions without inheriting a root checkpoint', async () => {
    const tree = validTree();
    const revision = 'a'.repeat(40);
    tree[`${STATE}/README.md`] = doc('nessa', null, { sourceRevision: revision });
    tree[`${STATE}/services/chat/send/submit.md`] = doc('chat-send-submit', 'chat-send', { sourceRevision: 'b'.repeat(64) });
    const { catalog } = await load(tree);
    expect(catalog.issues).toEqual([]);
    expect(catalog.documents.get('nessa')?.summary.sourceRevision).toBe(revision);
    expect(catalog.documents.get('chat')?.summary.sourceRevision).toBeUndefined();
    expect(catalog.documents.get('chat-send-submit')?.summary.sourceRevision).toBe('b'.repeat(64));
  });
  it.each(['main', 'abcd1234', 'A'.repeat(40), 'a'.repeat(41), '', null, 123, ['a'.repeat(40)]])(
    'rejects a non-exact revision %j rather than displaying it as reviewed', async (sourceRevision) => {
      const tree = validTree();
      tree[`${STATE}/README.md`] = doc('nessa', null, { sourceRevision });
      const { catalog } = await load(tree);
      expect(catalog.issues).toContainEqual(expect.objectContaining({ code: 'invalid-field', file: 'docs/state/README.md' }));
      expect(catalog.rootId).toBeNull();
    },
  );
});
