// Disk adapter for one explicitly selected private store. Raw Markdown remains
// authoritative; a single manifest commits current + previous generations.
import * as fs from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';
import { bundlePath, storedBundleSchema, type BundlePersistence, type CommitOutcome, type StoredBundle } from './bundle.js';

type Io = Pick<typeof fs, 'open' | 'mkdir' | 'lstat' | 'realpath' | 'readdir' | 'rename' | 'unlink' | 'rmdir'>;
export const storeIo: Io = fs;
const markerSchema = z.object({ format: z.literal('nessa-docs'), version: z.literal(1), scope: z.uuid() }).strict();
const descriptorSchema = z.object({
  generation: z.uuid().regex(/^[a-f0-9-]+$/), scope: z.uuid(), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  files: z.array(z.object({ path: bundlePath, bytes: z.number().int().min(0).max(256 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(16),
}).strict();
const manifestSchema = z.object({ version: z.literal(1), current: descriptorSchema, previous: descriptorSchema.nullable() }).strict();
type Descriptor = z.infer<typeof descriptorSchema>;
type Manifest = z.infer<typeof manifestSchema>;
const MARKER = '.nessa-docs-store.json';
const LOCK = '.writer.lock';
const MAX_METADATA = 16 * 1024;
const MAX_ORPHANS = 4;
class OwnershipError extends Error {}
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export class DurableBundleStore implements BundlePersistence {
  private closed = false;
  private current: Manifest | null = null;
  private poisoned = false;
  private loaded = false;
  private closing = false;
  private pending: Promise<unknown> | null = null;
  private shutdown: Promise<void> | null = null;
  private constructor(
    readonly directory: string, readonly scope: string, private readonly io: Io,
    private readonly root: Stats, private readonly lock: fs.FileHandle, private readonly lockToken: string,
  ) {}

  static async open(directory: string, io: Io = storeIo): Promise<DurableBundleStore> {
    if (!isAbsolute(directory)) throw new Error('NESSA_DOCS_STORE must be an absolute, explicitly selected directory.');
    const parent = await io.realpath(dirname(directory));
    const rootPath = join(parent, directory.split(sep).filter(Boolean).at(-1)!);
    if (rootPath === parent || directory === sep) throw new Error('Choose a dedicated bundle store directory.');
    try { await io.mkdir(rootPath, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const root = await io.lstat(rootPath);
    privateEntry(root, true);
    if (await io.realpath(rootPath) !== rootPath) throw new Error('Store path is a symlink or changed.');
    // Refuse unrelated nonempty folders before creating even a transient lock.
    const names = await io.readdir(rootPath);
    if (names.length && !names.includes(MARKER)) throw new Error('Store directory is not an empty or marked Nessa Docs store.');
    const token = randomUUID();
    const lock = await io.open(join(rootPath, LOCK), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      .catch(() => { throw new Error('Store writer lock is unavailable. Another writer or a stale lock must be resolved before opening.'); });
    let store: DurableBundleStore | undefined;
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, token })); await lock.sync();
      // The lock owns initialization; two empty-store openers cannot mint scopes.
      const afterLock = await io.readdir(rootPath);
      const scope = afterLock.includes(MARKER)
        ? markerSchema.parse(JSON.parse(await readPrivate(io, rootPath, join(rootPath, MARKER), MAX_METADATA))).scope
        : randomUUID();
      store = new DurableBundleStore(rootPath, scope, io, root, lock, token);
      await store.assertOwner();
      if (!afterLock.includes(MARKER)) {
        if (afterLock.some((name) => name !== LOCK)) throw new Error('Store initialization found unrelated content.');
        await store.writeExclusive(join(rootPath, MARKER), JSON.stringify({ format: 'nessa-docs', version: 1, scope }));
      }
      try { await io.mkdir(join(rootPath, 'generations'), { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      await store.assertDirectories(join(rootPath, 'generations'));
      await store.syncDirectory(rootPath);
      const parentHandle = await io.open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await parentHandle.sync(); } finally { await parentHandle.close(); }
      return store;
    } catch (error) {
      if (store) await store.close().catch(() => undefined);
      else {
        // We still hold the new fd: remove only its own pathname identity.
        const info = await io.lstat(join(rootPath, LOCK)).catch(() => null);
        if (info && same(info, await lock.stat())) await io.unlink(join(rootPath, LOCK)).catch(() => undefined);
        await lock.close();
      }
      throw error;
    }
  }

  private async assertOwner() {
    try {
    if (this.closed || this.poisoned) throw new Error('Durable store is closed or its commit outcome is unknown. Reopen it.');
    const root = await this.io.lstat(this.directory);
    privateEntry(root, true);
    if (!same(root, this.root) || await this.io.realpath(this.directory) !== this.directory) throw new Error('Store directory identity changed.');
    const info = await this.io.lstat(join(this.directory, LOCK));
    privateEntry(info, false);
    if (!same(info, await this.lock.stat())) throw new Error('Store writer lock identity changed.');
    } catch (error) { throw new OwnershipError(error instanceof Error ? error.message : 'Store ownership is unavailable.'); }
  }

  private async assertDirectories(path: string) {
    await this.assertOwner();
    const local = relative(this.directory, path);
    if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error('Store path escaped its owner.');
    let current = this.directory;
    for (const component of local.split(sep).filter(Boolean)) {
      current = join(current, component); privateEntry(await this.io.lstat(current), true);
    }
  }

  private async read(path: string, limit = MAX_METADATA) {
    await this.assertDirectories(dirname(path));
    return readPrivate(this.io, this.directory, path, limit);
  }

  private async syncDirectory(path: string) {
    await this.assertDirectories(path);
    const handle = await this.io.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  }

  private async writeExclusive(path: string, text: string) {
    await this.assertDirectories(dirname(path));
    const handle = await this.io.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  }

  private checkManifest(raw: unknown): Manifest {
    const manifest = manifestSchema.parse(raw);
    for (const descriptor of [manifest.current, manifest.previous].filter((entry): entry is Descriptor => entry !== null)) {
      if (descriptor.scope !== this.scope || new Set(descriptor.files.map((file) => file.path)).size !== descriptor.files.length || descriptor.files.reduce((sum, file) => sum + file.bytes, 0) > 256 * 1024) throw new Error('Stored manifest scope, paths or size are invalid.');
    }
    if (manifest.previous && (manifest.previous.generation === manifest.current.generation || manifest.previous.revision >= manifest.current.revision)) throw new Error('Stored generation history is invalid.');
    return manifest;
  }

  private async admitted<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing || this.closed) throw new Error('Durable store is closing or closed.');
    if (this.pending) throw new Error('A durable store operation is already in progress.');
    const task = operation();
    this.pending = task;
    try { return await task; } finally { if (this.pending === task) this.pending = null; }
  }

  load() { return this.admitted(() => this.loadAccepted()); }

  private async loadAccepted() {
    await this.assertOwner();
    let manifest: Manifest;
    try { manifest = this.checkManifest(JSON.parse(await this.read(join(this.directory, 'current.json')))); }
    catch (error) {
      if (missing(error) && (error as NodeJS.ErrnoException).path === join(this.directory, 'current.json')) {
        if ((await this.io.readdir(join(this.directory, 'generations'))).length) throw new Error('Manifest is missing while generations exist; operator recovery is required.');
        this.current = null; this.loaded = true; return null;
      }
      throw error;
    }
    const descriptor = manifest.current;
    const generation = join(this.directory, 'generations', descriptor.generation);
    await this.assertDirectories(generation);
    const stamp = descriptorSchema.parse(JSON.parse(await this.read(join(generation, '.generation.json'))));
    if (JSON.stringify(stamp) !== JSON.stringify(descriptor)) throw new Error('Generation does not match the committed manifest.');
    const files = [];
    for (const file of descriptor.files) {
      const markdown = await this.read(join(generation, file.path), Math.min(file.bytes, 256 * 1024));
      if (Buffer.byteLength(markdown) !== file.bytes || hash(markdown) !== file.sha256) throw new Error('Committed Markdown failed its size/hash check.');
      files.push({ path: file.path, markdown });
    }
    this.current = manifest;
    await this.syncDirectory(this.directory);
    await this.cleanup();
    this.loaded = true;
    return { state: storedBundleSchema.parse({ scope: this.scope, revision: descriptor.revision, files }), projectPath: generation };
  }

  commit(raw: StoredBundle, signal?: AbortSignal): Promise<CommitOutcome> {
    if (this.closing || this.closed || this.pending) return Promise.resolve({ kind: 'unchanged', message: 'Durable store is closing, closed or busy.' });
    return this.admitted(() => this.commitAccepted(raw, signal));
  }

  private async commitAccepted(raw: StoredBundle, signal?: AbortSignal): Promise<CommitOutcome> {
    if (!this.loaded) return { kind: 'unchanged', message: 'Open and restore the store before writing.' };
    const state = storedBundleSchema.parse(raw);
    if (state.scope !== this.scope || state.revision !== (this.current?.current.revision ?? 0) + 1) return { kind: 'unchanged', message: 'Durable store revision or owner conflict. Read and reconcile.' };
    const descriptor = descriptorSchema.parse({ scope: state.scope, revision: state.revision, generation: randomUUID(), files: state.files.map(({ path, markdown }) => ({ path, bytes: Buffer.byteLength(markdown), sha256: hash(markdown) })) });
    const generation = join(this.directory, 'generations', descriptor.generation);
    const temp = join(this.directory, `.manifest-${randomUUID()}.tmp`);
    const next = this.checkManifest({ version: 1, current: descriptor, previous: this.current?.current ?? null });
    let publishing = false;
    let created = false;
    try {
      await this.assertOwner(); await this.cleanup(); signal?.throwIfAborted();
      await this.io.mkdir(generation, { mode: 0o700 }); created = true;
      await this.writeExclusive(join(generation, '.generation.json'), JSON.stringify(descriptor));
      const directories = new Set([generation]);
      for (const file of state.files) {
        let directory = generation;
        for (const component of file.path.split('/').slice(0, -1)) {
          directory = join(directory, component);
          if (!directories.has(directory)) { await this.io.mkdir(directory, { mode: 0o700 }); directories.add(directory); }
        }
        await this.writeExclusive(join(generation, file.path), file.markdown);
      }
      for (const directory of [...directories].sort((a, b) => b.length - a.length)) await this.syncDirectory(directory);
      await this.syncDirectory(join(this.directory, 'generations'));
      await this.writeExclusive(temp, JSON.stringify(next));
      await this.assertOwner(); signal?.throwIfAborted(); publishing = true;
      await this.io.rename(temp, join(this.directory, 'current.json'));
      await this.syncDirectory(this.directory);
      this.current = next;
      await this.cleanup().catch(() => undefined); // next commit retries before staging more data
      return { kind: 'committed', durable: true, projectPath: generation };
    } catch (error) {
      if (error instanceof OwnershipError) { this.poisoned = true; return { kind: 'unknown', message: 'Store ownership was lost.' }; }
      if (publishing) {
        try {
          const observed = this.checkManifest(JSON.parse(await this.read(join(this.directory, 'current.json'))));
          if (JSON.stringify(observed) === JSON.stringify(next)) {
            this.current = next;
            return { kind: 'committed', durable: false, projectPath: generation };
          }
          if (JSON.stringify(observed) !== JSON.stringify(this.current)) throw new Error('Manifest differs from both commit outcomes.');
        } catch (readError) {
          if (!(this.current === null && missing(readError) && (readError as NodeJS.ErrnoException).path === join(this.directory, 'current.json'))) {
            this.poisoned = true;
            return { kind: 'unknown', message: 'Manifest publication could not be determined.' };
          }
        }
      }
      if (created) await this.removeGeneration(descriptor).catch(() => undefined);
      await this.io.unlink(temp).catch(() => undefined);
      return { kind: 'unchanged', message: `Durable update was not published: ${error instanceof Error ? error.message : 'write failed'}` };
    }
  }

  private async cleanup() {
    await this.assertDirectories(join(this.directory, 'generations'));
    let unknownTemps = 0;
    for (const name of await this.io.readdir(this.directory)) {
      if ([MARKER, LOCK, 'current.json', 'generations'].includes(name)) continue;
      const match = /^\.manifest-([a-f0-9-]+)\.tmp$/.exec(name);
      if (!match || !z.uuid().safeParse(match[1]).success) throw new Error('Unrecognized content in owned store directory.');
      const path = join(this.directory, name);
      try { this.checkManifest(JSON.parse(await this.read(path))); privateEntry(await this.io.lstat(path), false); await this.io.unlink(path); }
      catch (error) { if (error instanceof SyntaxError || error instanceof z.ZodError) unknownTemps++; else throw error; }
    }
    if (unknownTemps >= MAX_ORPHANS) throw new Error('Incomplete manifest files require operator recovery before more writes.');
    const retained = new Set([this.current?.current.generation, this.current?.previous?.generation]);
    const names = await this.io.readdir(join(this.directory, 'generations'));
    if (names.length > 2 + MAX_ORPHANS) throw new Error('Too many unverified store generations; operator recovery is required.');
    let unverified = 0;
    for (const name of names) {
      if (retained.has(name)) continue;
      if (!z.uuid().regex(/^[a-f0-9-]+$/).safeParse(name).success) throw new Error('Unrecognized content in owned generations directory.');
      try {
        const descriptor = descriptorSchema.parse(JSON.parse(await this.read(join(this.directory, 'generations', name, '.generation.json'))));
        if (descriptor.scope !== this.scope || descriptor.generation !== name) throw new Error('Orphan generation belongs to another store.');
        await this.removeGeneration(descriptor);
      } catch (error) {
        if (missing(error)) {
          const path = join(this.directory, 'generations', name);
          await this.assertDirectories(path);
          if ((await this.io.readdir(path)).length === 0) await this.io.rmdir(path);
          else unverified++;
          continue;
        }
        throw error;
      }
    }
    if (unverified >= MAX_ORPHANS) throw new Error('Incomplete unverified generations require operator recovery before more writes.');
  }

  private async removeGeneration(descriptor: Descriptor) {
    const base = join(this.directory, 'generations', descriptor.generation);
    await this.assertDirectories(base);
    const allowed = new Set(['.generation.json', ...descriptor.files.map((file) => file.path)]);
    const directories: string[] = [];
    const walk = async (absolute: string, local: string) => {
      await this.assertDirectories(absolute); directories.push(absolute);
      for (const name of await this.io.readdir(absolute)) {
        const file = local ? `${local}/${name}` : name;
        const target = join(absolute, name);
        const info = await this.io.lstat(target);
        if (info.isSymbolicLink()) throw new Error('Symlink found during generation cleanup.');
        if (info.isDirectory()) {
          if (![...allowed].some((path) => path.startsWith(`${file}/`))) throw new Error('Unrecognized generation directory.');
          await walk(target, file);
        } else if (!info.isFile() || !allowed.has(file)) throw new Error('Unrecognized generation file.');
      }
    };
    await walk(base, ''); // validate all names before removing any file
    for (const file of [...allowed].filter((file) => file !== '.generation.json')) {
      const path = join(base, file);
      try { await this.assertDirectories(dirname(path)); const info = await this.io.lstat(path); privateEntry(info, false); await this.io.unlink(path); }
      catch (error) { if (!missing(error)) throw error; }
    }
    for (const path of directories.filter((path) => path !== base).sort((a, b) => b.length - a.length)) await this.io.rmdir(path);
    try { const stamp = join(base, '.generation.json'); privateEntry(await this.io.lstat(stamp), false); await this.io.unlink(stamp); } catch (error) { if (!missing(error)) throw error; }
    await this.io.rmdir(base);
  }

  close(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.closing = true;
    this.shutdown = this.releaseAfterDrain();
    return this.shutdown;
  }

  private async releaseAfterDrain() {
    await this.pending?.catch(() => undefined);
    this.closed = true;
    try {
      const root = await this.io.lstat(this.directory);
      if (!same(root, this.root) || await this.io.realpath(this.directory) !== this.directory) throw new Error('Refusing to release a lock in a replaced store directory.');
      const info = await this.io.lstat(join(this.directory, LOCK));
      if (!same(info, await this.lock.stat())) throw new Error('Refusing to release another writer lock.');
      const contents = JSON.parse(await readPrivate(this.io, this.directory, join(this.directory, LOCK), 1024));
      if (contents.token !== this.lockToken) throw new Error('Writer lock token changed.');
      await this.io.unlink(join(this.directory, LOCK));
      const rootHandle = await this.io.open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await rootHandle.sync(); } finally { await rootHandle.close(); }
    } finally { await this.lock.close(); }
  }
}

function privateEntry(info: Stats, directory: boolean) {
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error('Store entries must be private, owned, ordinary files/directories without symlinks.');
}

async function readPrivate(io: Io, root: string, path: string, maxBytes: number): Promise<string> {
  const before = await io.realpath(path);
  if (!(before === root || before.startsWith(`${root}${sep}`)) || before !== path) throw new Error('Store read escaped or followed a symlink.');
  const expected = await io.lstat(path); privateEntry(expected, false);
  const handle = await io.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat(); privateEntry(info, false);
    if (!same(info, expected) || info.size > maxBytes) throw new Error('Store read exceeds its bound or changed identity.');
    const buffer = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
    const after = await io.lstat(path); privateEntry(after, false);
    if (!same(info, after) || after.size !== info.size || offset !== info.size || await io.realpath(path) !== before) throw new Error('Store file changed during reading.');
    const text = buffer.toString('utf8');
    if (!buffer.equals(Buffer.from(text, 'utf8'))) throw new Error('Stored file is not valid UTF-8.');
    return text;
  } finally { await handle.close(); }
}
