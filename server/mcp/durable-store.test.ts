import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DocumentBundle } from './bundle';
import { DurableBundleStore, storeIo } from './durable-store';
import { doc } from '../testing/documents';
import { loadCatalog } from '../catalog';
import { nodeRepositoryFiles } from '../files';

const roots: string[] = [];
const opened: DurableBundleStore[] = [];
afterEach(async () => { for (const store of opened.splice(0)) await store.close().catch(() => undefined); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const files = (body = 'Version one') => [{ path: 'docs/state/README.md', markdown: doc('system', null, { status: 'fixture' }, body) }];
async function location() { const root = await fs.mkdtemp(join(tmpdir(), 'nessa-docs-durable-')); roots.push(root); return join(root, 'store'); }
async function open(path: string, io = storeIo) { const store = await DurableBundleStore.open(path, io); opened.push(store); try { return { store, bundle: await DocumentBundle.open(store) }; } catch (error) { await store.close(); throw error; } }
async function manifest(path: string) { return JSON.parse(await fs.readFile(join(path, 'current.json'), 'utf8')); }
function fail(code = 'EIO') { return Object.assign(new Error('Injected filesystem failure'), { code }); }

it('restores exact scope/revision/Markdown after restart and opens as a standalone project', async () => {
  const path = await location();
  const first = await open(path);
  const saved = await first.bundle.replace({ expectedRevision: 0, files: files() });
  expect(saved.storage).toMatchObject({ kind: 'durable', status: 'synced' });
  await first.store.close();
  const second = await open(path);
  expect(second.bundle.read().scope).toBe(saved.scope);
  expect(second.bundle.read().revision).toBe(1);
  expect(second.bundle.read().files).toEqual(saved.files);
  await expect(second.bundle.replace({ expectedRevision: 0, files: files('Stale') })).rejects.toThrow('Revision conflict');
  const project = second.bundle.read().storage;
  if (project.kind !== 'durable') throw new Error('Wrong storage mode');
  const catalog = await loadCatalog(nodeRepositoryFiles(), project.projectPath);
  expect(catalog.rootId).toBe('system');
  expect(catalog.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
});

it('admits one initializer/writer and one concurrent update', async () => {
  const path = await location();
  const starts = await Promise.allSettled([DurableBundleStore.open(path), DurableBundleStore.open(path)]);
  expect(starts.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
  const winner = starts.find((value) => value.status === 'fulfilled');
  if (winner?.status !== 'fulfilled') throw new Error('No writer');
  opened.push(winner.value);
  const bundle = await DocumentBundle.open(winner.value);
  const updates = await Promise.allSettled([bundle.replace({ expectedRevision: 0, files: files('A') }), bundle.replace({ expectedRevision: 0, files: files('B') })]);
  expect(updates.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
  expect((await manifest(path)).current.revision).toBe(1);
  await expect(DurableBundleStore.open(path)).rejects.toThrow('lock');
});

it.each(['write', 'rename'])('keeps the last committed revision on pre-publication %s failure', async (stage) => {
  const path = await location(); let armed = false;
  const io = { ...storeIo,
    open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (!(armed && stage === 'write' && String(args[0]).endsWith('README.md') && (Number(args[1]) & constants.O_CREAT))) return handle;
      return new Proxy(handle, { get(target, key) {
        if (key === 'writeFile') return async () => { await target.writeFile('Partial staging write'); throw fail(); };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
    }) as typeof fs.open,
    rename: (async (...args: Parameters<typeof fs.rename>) => { if (armed && stage === 'rename') throw fail(); return fs.rename(...args); }) as typeof fs.rename,
  };
  const owner = await open(path, io);
  await owner.bundle.replace({ expectedRevision: 0, files: files() });
  armed = true;
  await expect(owner.bundle.replace({ expectedRevision: 1, files: files('Never committed') })).rejects.toThrow('not published');
  expect(owner.bundle.read().revision).toBe(1);
  expect((await manifest(path)).current.revision).toBe(1);
  expect(await fs.readdir(join(path, 'generations'))).toHaveLength(1);
  await owner.store.close();
  expect((await open(path)).bundle.read().files).toEqual(files());
});

it.each(['rename-after-effect', 'directory-sync'])('reports visible but unconfirmed commits on %s failure', async (stage) => {
  const path = await location(); let armed = false; let published = false;
  const io = { ...storeIo,
    rename: (async (...args: Parameters<typeof fs.rename>) => { await fs.rename(...args); published = true; if (armed && stage === 'rename-after-effect') throw fail(); }) as typeof fs.rename,
    open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return new Proxy(handle, { get(target, key) {
        if (key === 'sync' && stage === 'directory-sync' && armed && published && String(args[0]) === path.replace(/^\/var\//, '/private/var/')) return async () => { throw fail(); };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
    }) as typeof fs.open,
  };
  const owner = await open(path, io);
  await owner.bundle.replace({ expectedRevision: 0, files: files() });
  published = false; armed = true;
  await expect(owner.bundle.replace({ expectedRevision: 1, files: files('Visible two') })).rejects.toThrow('Revision 2 is visible');
  expect(owner.bundle.read()).toMatchObject({ revision: 2, storage: { kind: 'durable', status: 'unconfirmed' } });
  expect((await manifest(path)).current.revision).toBe(2);
  armed = false;
  await owner.store.close();
  const restored = await open(path);
  expect(restored.bundle.read()).toMatchObject({ revision: 2, storage: { status: 'synced' } });
  expect(restored.bundle.read().files).toEqual(files('Visible two'));
});

it('poisons the owner when a failed publication cannot be classified', async () => {
  const path = await location(); let armed = false;
  const io = { ...storeIo, rename: (async (...args: Parameters<typeof fs.rename>) => {
    if (!armed) return fs.rename(...args);
    await fs.writeFile(args[1], '{corrupt'); throw fail();
  }) as typeof fs.rename };
  const owner = await open(path, io);
  await owner.bundle.replace({ expectedRevision: 0, files: files() }); armed = true;
  await expect(owner.bundle.replace({ expectedRevision: 1, files: files('Unknown') })).rejects.toThrow('outcome is unknown');
  expect(() => owner.bundle.read()).toThrow('outcome is unknown');
  await expect(owner.bundle.replace({ expectedRevision: 1, files: files() })).rejects.toThrow('outcome is unknown');
  await owner.store.close();
  await expect(open(path)).rejects.toThrow();
});

it('honors cancellation before publication and never rolls back a published commit', async () => {
  const path = await location(); let before = false; let after = false; let controller = new AbortController();
  const io = { ...storeIo,
    open: (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (before && String(args[0]).includes('.manifest-')) controller.abort();
      return handle;
    }) as typeof fs.open,
    rename: (async (...args: Parameters<typeof fs.rename>) => { await fs.rename(...args); if (after) controller.abort(); }) as typeof fs.rename,
  };
  const owner = await open(path, io);
  await owner.bundle.replace({ expectedRevision: 0, files: files() }); before = true;
  await expect(owner.bundle.replace({ expectedRevision: 1, files: files('Cancelled') }, controller.signal)).rejects.toThrow('not published');
  expect(owner.bundle.read().revision).toBe(1);
  before = false; after = true; controller = new AbortController();
  expect((await owner.bundle.replace({ expectedRevision: 1, files: files('Published') }, controller.signal)).revision).toBe(2);
});

it('refuses corrupt/traversing manifests and hash corruption without reading another store', async () => {
  const path = await location(); const owner = await open(path);
  const saved = await owner.bundle.replace({ expectedRevision: 0, files: files() }); await owner.store.close();
  const original = await manifest(path);
  const changed = structuredClone(original); changed.current.files[0].path = '../outside.md';
  await fs.writeFile(join(path, 'current.json'), JSON.stringify(changed));
  await expect(open(path)).rejects.toThrow();
  await fs.writeFile(join(path, 'current.json'), JSON.stringify(original));
  if (saved.storage.kind !== 'durable') throw new Error('Wrong mode');
  await fs.writeFile(join(saved.storage.projectPath, 'docs/state/README.md'), 'Tampered');
  await expect(open(path)).rejects.toThrow('size/hash');
});

it('rejects symlinked roots, parents and Markdown and refuses unrelated directories', async () => {
  const path = await location(); const parent = join(path, '..');
  const real = join(parent, 'ordinary'); await fs.mkdir(real, { mode: 0o700 }); await fs.writeFile(join(real, 'sentinel'), 'Keep');
  await fs.symlink(real, path);
  await expect(DurableBundleStore.open(path)).rejects.toThrow();
  expect(await fs.readFile(join(real, 'sentinel'), 'utf8')).toBe('Keep');
  await fs.unlink(path); await expect(DurableBundleStore.open(real)).rejects.toThrow('not an empty');
  const owner = await open(path); const snapshot = await owner.bundle.replace({ expectedRevision: 0, files: files() }); await owner.store.close();
  if (snapshot.storage.kind !== 'durable') throw new Error('Wrong mode');
  const data = join(snapshot.storage.projectPath, 'docs/state/README.md'); const outside = join(parent, 'outside.md');
  await fs.writeFile(outside, files()[0]!.markdown, { mode: 0o600 }); await fs.unlink(data); await fs.symlink(outside, data);
  await expect(open(path)).rejects.toThrow();
  expect(await fs.readFile(outside, 'utf8')).toBe(files()[0]!.markdown);
});

it('keeps stores and cross-document references isolated after restart', async () => {
  const a = await location(); const b = await location(); const first = await open(a); const second = await open(b);
  await first.bundle.replace({ expectedRevision: 0, files: files('A only') }); await second.bundle.replace({ expectedRevision: 0, files: files('B only') });
  expect(first.bundle.read().scope).not.toBe(second.bundle.read().scope);
  await expect(second.bundle.replace({ expectedRevision: 1, files: [{ path: 'docs/state/README.md', markdown: doc('system', null, { diagramLinks: { A: 'foreign' } }, '```mermaid\nflowchart LR\n A-->B\n```') }] })).rejects.toThrow('Invalid document bundle');
  expect(second.bundle.read().files).toEqual(files('B only'));
  await first.store.close(); await second.store.close();
  await fs.copyFile(join(a, 'current.json'), join(b, 'current.json'));
  await expect(open(b)).rejects.toThrow('scope');
  expect((await open(a)).bundle.read().files).toEqual(files('A only'));
});

it('retains two committed generations and cleans recognizable interrupted staging', async () => {
  const path = await location(); const owner = await open(path);
  for (let revision = 0; revision < 5; revision++) await owner.bundle.replace({ expectedRevision: revision, files: files(`Revision ${revision + 1}`) });
  expect(await fs.readdir(join(path, 'generations'))).toHaveLength(2);
  const m = await manifest(path); expect(m.previous.revision).toBe(4);
  const orphan = { ...m.current, generation: randomUUID() };
  const dir = join(path, 'generations', orphan.generation); await fs.mkdir(dir, { mode: 0o700 });
  await fs.writeFile(join(dir, '.generation.json'), JSON.stringify(orphan), { mode: 0o600 });
  await owner.store.close();
  const restored = await open(path); expect(restored.bundle.read().revision).toBe(5);
  expect(await fs.readdir(join(path, 'generations'))).toHaveLength(2);
});

it('fails closed for a lost manifest and never removes a replaced writer lock', async () => {
  const path = await location(); const owner = await open(path);
  await owner.bundle.replace({ expectedRevision: 0, files: files() }); await owner.store.close();
  await fs.unlink(join(path, 'current.json')); await expect(open(path)).rejects.toThrow('Manifest is missing');
  const empty = await location(); const other = await open(empty);
  await fs.rename(join(empty, '.writer.lock'), join(empty, 'old-lock'));
  await fs.writeFile(join(empty, '.writer.lock'), JSON.stringify({ token: randomUUID() }), { mode: 0o600 });
  await expect(other.store.close()).rejects.toThrow('another writer');
  expect(await fs.readFile(join(empty, '.writer.lock'), 'utf8')).toContain('token');
});

it('holds the writer lock through an admitted publication while shutdown drains it', async () => {
  const path = await location();
  let delay = false; let entered!: () => void; let release!: () => void;
  const atRename = new Promise<void>((resolve) => { entered = resolve; });
  const continueRename = new Promise<void>((resolve) => { release = resolve; });
  const io = { ...storeIo, rename: (async (...args: Parameters<typeof fs.rename>) => {
    if (delay) { entered(); await continueRename; }
    await fs.rename(...args);
  }) as typeof fs.rename };
  const owner = await open(path, io);
  await owner.bundle.replace({ expectedRevision: 0, files: files() }); delay = true;
  const update = owner.bundle.replace({ expectedRevision: 1, files: files('Drained commit') });
  await atRename;
  const close = owner.store.close();
  try {
    await expect(DurableBundleStore.open(path)).rejects.toThrow('lock');
    await expect(owner.store.load()).rejects.toThrow('closing');
  } finally { release(); }
  expect((await update).revision).toBe(2);
  await close;
  const reopened = await open(path);
  expect(reopened.bundle.read().revision).toBe(2);
  expect(reopened.bundle.read().files).toEqual(files('Drained commit'));
  if (reopened.bundle.read().storage.kind !== 'durable') throw new Error('Wrong mode');
});

it('refuses a symlinked Markdown parent without following it', async () => {
  const path = await location(); const owner = await open(path);
  const snapshot = await owner.bundle.replace({ expectedRevision: 0, files: files() }); await owner.store.close();
  if (snapshot.storage.kind !== 'durable') throw new Error('Wrong mode');
  const docs = join(snapshot.storage.projectPath, 'docs');
  await fs.rename(docs, join(snapshot.storage.projectPath, 'old-docs'));
  const outside = join(path, '..', 'outside-docs'); await fs.mkdir(join(outside, 'state'), { recursive: true, mode: 0o700 });
  await fs.writeFile(join(outside, 'state/README.md'), files()[0]!.markdown, { mode: 0o600 });
  await fs.symlink(outside, docs);
  await expect(open(path)).rejects.toThrow();
  expect(await fs.readFile(join(outside, 'state/README.md'), 'utf8')).toBe(files()[0]!.markdown);
});

it('requires private permissions and never steals a stale lock', async () => {
  const path = await location(); await fs.mkdir(path, { mode: 0o700 }); await fs.chmod(path, 0o755);
  await expect(DurableBundleStore.open(path)).rejects.toThrow('private'); expect(await fs.readdir(path)).toEqual([]);
  await fs.chmod(path, 0o700); const owner = await open(path); await owner.store.close();
  const lock = JSON.stringify({pid: 99999999, token: randomUUID()});
  await fs.writeFile(join(path, '.writer.lock'), lock, { mode: 0o600 });
  await expect(DurableBundleStore.open(path)).rejects.toThrow('lock');
  expect(await fs.readFile(join(path, '.writer.lock'), 'utf8')).toBe(lock);
});

it('refuses foreign orphan ownership and bounds unverified incomplete generations', async () => {
  const path = await location(); const owner = await open(path);
  await owner.bundle.replace({ expectedRevision: 0, files: files() }); await owner.store.close();
  const m = await manifest(path); const generation = randomUUID(); const dir = join(path, 'generations', generation);
  await fs.mkdir(dir, { mode: 0o700 });
  await fs.writeFile(join(dir, '.generation.json'), JSON.stringify({...m.current, generation, scope:randomUUID()}), {mode:0o600});
  await expect(open(path)).rejects.toThrow('another store');
  expect(await fs.readdir(dir)).toEqual(['.generation.json']);
  await fs.rm(dir, {recursive:true});
  for (let n=0;n<4;n++) { const partial=join(path,'generations',randomUUID()); await fs.mkdir(partial,{mode:0o700}); await fs.writeFile(join(partial,'partial'),'unfinished',{mode:0o600}); }
  await expect(open(path)).rejects.toThrow('operator recovery');
  expect(await fs.readdir(join(path,'generations'))).toHaveLength(5);
});

it('rejects a corrupt catalog even when the edited hash matches its bytes', async () => {
  const path = await location(); const owner = await open(path);
  const snapshot = await owner.bundle.replace({ expectedRevision: 0, files: files() }); await owner.store.close();
  if (snapshot.storage.kind !== 'durable') throw new Error('Wrong mode');
  const m = await manifest(path); const invalid = 'No frontmatter';
  m.current.files[0].bytes = Buffer.byteLength(invalid); m.current.files[0].sha256 = createHash('sha256').update(invalid).digest('hex');
  await fs.writeFile(join(snapshot.storage.projectPath,'docs/state/README.md'),invalid);
  await fs.writeFile(join(snapshot.storage.projectPath,'.generation.json'),JSON.stringify(m.current));
  await fs.writeFile(join(path,'current.json'),JSON.stringify(m));
  await expect(open(path)).rejects.toThrow('Invalid document bundle');
});

it('rejects noncanonical case-folded generation aliases before cleanup', async () => {
  const path = await location(); const owner = await open(path);
  const snapshot = await owner.bundle.replace({expectedRevision:0,files:files()}); await owner.store.close();
  const m = await manifest(path); m.current.generation = m.current.generation.toUpperCase();
  await fs.writeFile(join(path,'current.json'),JSON.stringify(m));
  await expect(open(path)).rejects.toThrow();
  if(snapshot.storage.kind!=='durable') throw new Error('Wrong mode');
  expect(await fs.readFile(join(snapshot.storage.projectPath,'docs/state/README.md'),'utf8')).toBe(files()[0]!.markdown);
});

it('round-trips Unicode exactly and refuses lossy surrogate input', async () => {
  const path = await location(); const owner = await open(path);
  const content = files('Synthetic 日本語 العربية 🙂 text');
  await owner.bundle.replace({expectedRevision:0,files:content});
  await expect(owner.bundle.replace({expectedRevision:1,files:files('Bad '+String.fromCharCode(0xd800))})).rejects.toThrow('well-formed Unicode');
  expect(owner.bundle.read().revision).toBe(1); await owner.store.close();
  expect((await open(path)).bundle.read().files).toEqual(content);
});
