// The extension builds the catalog in the page from files GitHub sends. These
// checks run that composition over the bundled example, read the way GitHub
// would hand it over, and compare it with the local app's own reading.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../server/catalog';
import { readDiagram } from '../../server/diagram-reader';
import { nodeRepositoryFiles } from '../../server/files';
import { catalogResponse } from '../../server/responses';
import type { RepoPort } from './port-client';
import type { ListedEntry, ReadAnswer } from './protocol';
import { githubProject } from './project-source';
import { repoFiles } from './repo-files';

const EXAMPLE = fileURLToPath(new URL('../../examples/store/', import.meta.url));

/** A content script answering from a folder, as GitHub answers for a repository: `prefix` is where the project sits. */
function folderPort(folder: string, prefix: string, asked: string[] = []): RepoPort {
  const local = (path: string) => (path.startsWith(prefix.replace(/\/$/, '')) ? join(folder, path.slice(prefix.length)) : null);
  return {
    async list(path) {
      asked.push(path);
      const at = path === prefix.replace(/\/$/, '') ? folder : local(path);
      if (!at) return null;
      try {
        return (await readdir(at, { withFileTypes: true })).map((entry): ListedEntry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other' }));
      } catch {
        return null;
      }
    },
    async read(path, maxBytes): Promise<ReadAnswer> {
      const at = local(path);
      if (!at) return { kind: 'missing' };
      const size = (await stat(at).catch(() => null))?.size;
      if (size === undefined) return { kind: 'missing' };
      return size > maxBytes ? { kind: 'too-large', size } : { kind: 'text', text: await readFile(at, 'utf8') };
    },
    tell() {},
  };
}

describe('the extension catalog', () => {
  it('matches the local app for the same files, wherever the folder sits in the repository', async () => {
    const local = catalogResponse(await loadCatalog(nodeRepositoryFiles(), EXAMPLE.replace(/\/$/, '')));
    for (const prefix of ['', 'examples/store/']) {
      const project = githubProject(repoFiles(folderPort(EXAMPLE, prefix), prefix), 'example/store', readDiagram);
      const fetched = await project.source.reads('github').catalog();
      expect(fetched.kind).toBe('ok');
      if (fetched.kind !== 'ok') return;
      expect(fetched.value.rootId).toBe(local.rootId);
      expect(fetched.value.documents.map((doc) => [doc.id, doc.file, doc.title])).toEqual(local.documents.map((doc) => [doc.id, doc.file, doc.title]));
      expect(fetched.value.issues.map((issue) => issue.code)).toEqual(local.issues.map((issue) => issue.code));
      expect(fetched.value.version).toBe(local.version);
    }
  });

  it('answers documents, unknown ids and search, and refuses local-only work', async () => {
    const project = githubProject(repoFiles(folderPort(EXAMPLE, ''), ''), 'example/store', readDiagram);
    const reads = project.source.reads('github');
    const catalog = await reads.catalog();
    if (catalog.kind !== 'ok' || !catalog.value.rootId) throw new Error('no catalog');
    const root = await reads.document(catalog.value.rootId);
    expect(root.kind).toBe('ok');
    expect((await reads.document('no-such-page')).kind).toBe('unknown-document');
    const search = await reads.search('order');
    expect(search.kind === 'ok' && search.value.results.length > 0).toBe(true);
    expect((await reads.startModelCheck(catalog.value.rootId)).kind).toBe('failed');
    expect(await project.source.open({ example: true })).toMatchObject({ kind: 'refused' });
  });

  it('never asks GitHub for a path outside the project', async () => {
    const asked: string[] = [];
    const files = repoFiles(folderPort(EXAMPLE, 'examples/store/', asked), 'examples/store/');
    expect(await files.inspect('/repo/../secret')).toEqual({ kind: 'missing' });
    expect(await files.inspect('/elsewhere/x')).toEqual({ kind: 'missing' });
    expect(await files.readText('/repo/src/../../x.md', 1000, '/repo/docs/state')).toMatchObject({ kind: 'unreadable' });
    expect(asked.every((path) => path.startsWith('examples/store'))).toBe(true);
  });
});
