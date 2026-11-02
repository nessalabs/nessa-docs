// Downloads the pinned TLC jar and a Java runtime into the per-user cache.
// A verified directory is reused. A checksum mismatch is deleted, never run.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECKER_ID, TLC_VERSION, type CheckerStatus } from '../../shared/model-check.js';
import { JAVA_PINS, TLA_JAR, javaPin, type DownloadPin } from './pins.js';

export interface CacheEnvironment {
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly home?: string;
}

/** The version directory. `NESSA_DOCS_TLC_HOME` replaces the platform `tlc` folder. */
export function tlcCacheDirectory({ env = process.env, platform = process.platform, home = homedir() }: CacheEnvironment = {}): string {
  const override = env.NESSA_DOCS_TLC_HOME;
  if (override && override.trim() !== '') return join(override, TLC_VERSION);
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'nessa-docs', 'tlc', TLC_VERSION);
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA && env.LOCALAPPDATA.trim() !== '' ? env.LOCALAPPDATA : join(home, 'AppData', 'Local');
    return join(local, 'nessa-docs', 'Cache', 'tlc', TLC_VERSION);
  }
  const xdg = env.XDG_CACHE_HOME && env.XDG_CACHE_HOME.trim() !== '' ? env.XDG_CACHE_HOME : join(home, '.cache');
  return join(xdg, 'nessa-docs', 'tlc', TLC_VERSION);
}

export interface DownloadResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: Uint8Array;
}

export type Downloader = (url: string, signal: AbortSignal) => Promise<DownloadResponse>;

const MARKER = 'ready.json';

interface ReadyMarker {
  readonly jarSha256: string;
  readonly javaSha256: string;
  readonly javaBin: string;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileSha256(path: string): Promise<string | null> {
  try {
    return sha256(await readFile(path));
  } catch {
    return null;
  }
}

export function createCheckerCache(options: {
  directory?: string;
  download?: Downloader;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Tests pass small stand-ins. Production uses the published pins. */
  pins?: { readonly jar: DownloadPin; readonly java: DownloadPin };
} = {}) {
  const directory = options.directory ?? tlcCacheDirectory({ platform: options.platform });
  const download = options.download ?? fetchBytes;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const jarPin = options.pins?.jar ?? TLA_JAR;
  const java = options.pins?.java ?? javaPin(platform, arch);
  if (!java) {
    const missing: CheckerStatus = { version: CHECKER_ID, cachePath: directory, state: 'failed', message: `No pinned Java runtime for ${platform} ${arch}. The rule checker was not installed.` };
    return { directory, status: async () => missing, install: async () => missing, runtime: async () => null };
  }
  const pins = { jar: jarPin, java };
  let activity: { state: CheckerStatus['state']; message?: string } = { state: 'not-installed' };
  let pending: Promise<CheckerStatus> | null = null;

  const status = async (): Promise<CheckerStatus> => {
    const base = { version: CHECKER_ID, cachePath: directory };
    if (pending) return { ...base, state: 'downloading', message: activity.message ?? 'Downloading the rule checker…' };
    const ready = await readReady(directory, pins, platform);
    if (ready) return { ...base, state: 'ready', message: 'The rule checker is installed.' };
    if (activity.state === 'failed') return { ...base, state: 'failed', message: activity.message };
    return { ...base, state: 'not-installed', message: activity.message ?? 'The rule checker is not installed.' };
  };

  const install = (signal: AbortSignal): Promise<CheckerStatus> => {
    if (pending) return pending;
    pending = installOnce(directory, download, pins, platform, signal, (message) => {
      activity = { state: 'downloading', message };
    }).then((result) => {
      activity = result.state === 'ready' ? { state: 'not-installed' } : { state: result.state === 'failed' ? 'failed' : 'not-installed', message: result.message };
      if (result.state === 'ready') activity = { state: 'not-installed' };
      return result;
    }).finally(() => {
      pending = null;
    });
    activity = { state: 'downloading', message: 'Downloading the rule checker…' };
    return pending;
  };

  const runtime = async (): Promise<{ java: string; jar: string } | null> => {
    const marker = await readReady(directory, pins, platform);
    if (!marker) return null;
    return { java: join(directory, marker.javaBin), jar: join(directory, 'tla2tools.jar') };
  };

  return { directory, status, install, runtime };
}

async function readReady(directory: string, pins: { jar: DownloadPin; java: DownloadPin }, platform: NodeJS.Platform): Promise<ReadyMarker | null> {
  let marker: ReadyMarker;
  try {
    marker = JSON.parse(await readFile(join(directory, MARKER), 'utf8')) as ReadyMarker;
  } catch {
    return null;
  }
  if (marker.jarSha256 !== pins.jar.sha256 || marker.javaSha256 !== pins.java.sha256 || !marker.javaBin || marker.javaBin.split(/[/\\]/).includes('..')) return null;
  const jar = await fileSha256(join(directory, 'tla2tools.jar'));
  if (jar !== pins.jar.sha256) return null;
  const javaPath = join(directory, marker.javaBin);
  try {
    await access(javaPath, platform === 'win32' ? constants.F_OK : constants.X_OK);
  } catch {
    return null;
  }
  return marker;
}

async function installOnce(
  directory: string,
  download: Downloader,
  pins: { jar: DownloadPin; java: DownloadPin },
  platform: NodeJS.Platform,
  signal: AbortSignal,
  report: (message: string) => void,
): Promise<CheckerStatus> {
  const base = { version: CHECKER_ID, cachePath: directory };
  const existing = await readReady(directory, pins, platform);
  if (existing) return { ...base, state: 'ready', message: 'The rule checker is already installed.' };
  try {
    signal.throwIfAborted();
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    report('Downloading TLC…');
    const jar = await downloadPin(download, pins.jar, signal);
    report('Downloading Java…');
    const jre = await downloadPin(download, pins.java, signal);
    report('Installing the rule checker…');
    await writeFile(join(directory, 'tla2tools.jar'), jar);
    const javaBin = await extractJava(jre, pins.java.format, directory);
    const marker: ReadyMarker = { jarSha256: pins.jar.sha256, javaSha256: pins.java.sha256, javaBin };
    await writeFile(join(directory, MARKER), JSON.stringify(marker));
    const ready = await readReady(directory, pins, platform);
    if (!ready) return { ...base, state: 'failed', message: 'The rule checker was downloaded but did not verify. It was not saved as ready.' };
    return { ...base, state: 'ready', message: 'The rule checker is installed.' };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    if (signal.aborted) return { ...base, state: 'not-installed', message: 'The rule checker download was cancelled.' };
    const reason = error instanceof Error ? error.message : 'The download failed.';
    return { ...base, state: 'not-installed', message: `The rule checker is not installed. ${reason}` };
  }
}

async function downloadPin(download: Downloader, pin: DownloadPin, signal: AbortSignal): Promise<Uint8Array> {
  let response: DownloadResponse;
  try {
    response = await download(pin.url, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('The download failed because the network is unavailable.', { cause: error });
  }
  if (!response.ok) throw new Error(`The download answered HTTP ${response.status}.`);
  const digest = await sha256(response.body);
  if (digest !== pin.sha256) throw new Error('The download checksum did not match the pinned release. It was not installed.');
  return response.body;
}

async function extractJava(bytes: Uint8Array, format: DownloadPin['format'], directory: string): Promise<string> {
  const archive = join(directory, format === 'zip' ? 'jre.zip' : 'jre.tar.gz');
  const staging = join(directory, 'java-staging');
  await writeFile(archive, bytes);
  await mkdir(staging, { recursive: true });
  const names = await listArchive(archive, format);
  if (names.some((name) => name.split(/[/\\]/).includes('..') || name.startsWith('/') || name.startsWith('\\'))) {
    throw new Error('The Java archive contains a path outside the cache. It was not extracted.');
  }
  await extractArchive(archive, format, staging);
  await rm(archive, { force: true });
  const relative = await findJava(staging);
  if (!relative) throw new Error('The Java archive did not contain bin/java.');
  await rename(staging, join(directory, 'java'));
  return join('java', relative);
}

async function findJava(root: string): Promise<string | null> {
  const { readdir } = await import('node:fs/promises');
  const stack = [''];
  while (stack.length > 0) {
    const current = stack.pop() ?? '';
    const entries = await readdir(join(root, current), { withFileTypes: true });
    for (const entry of entries) {
      const relative = join(current, entry.name);
      if (entry.isDirectory()) stack.push(relative);
      else if (entry.isFile() && (entry.name === 'java' || entry.name === 'java.exe') && relative.split(/[/\\]/).includes('bin')) {
        await chmodExecutable(join(root, relative));
        return relative;
      }
    }
  }
  return null;
}

async function chmodExecutable(path: string): Promise<void> {
  const { chmod } = await import('node:fs/promises');
  await chmod(path, 0o755);
}

function listArchive(archive: string, format: DownloadPin['format']): Promise<string[]> {
  const command = format === 'zip'
    ? archiveCommand('unzip', ['-Z', '-1', archive])
    : archiveCommand('tar', ['-tzf', archive]);
  return command.then((text) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

function extractArchive(archive: string, format: DownloadPin['format'], dest: string): Promise<void> {
  const command = format === 'zip'
    ? archiveCommand('unzip', ['-q', archive, '-d', dest])
    : archiveCommand('tar', ['-xzf', archive, '-C', dest]);
  return command.then(() => undefined);
}

function archiveCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `tar exited ${code ?? 'unknown'}`));
    });
  });
}

async function fetchBytes(url: string, signal: AbortSignal): Promise<DownloadResponse> {
  const response = await fetch(url, { signal, redirect: 'follow' });
  const body = new Uint8Array(await response.arrayBuffer());
  return { ok: response.ok, status: response.status, body };
}

export const supportedJavaPlatforms = Object.keys(JAVA_PINS);

/** A place tests can point at without touching the real user cache. */
export function temporaryCacheDirectory(): string {
  return join(tmpdir(), 'nessa-docs-tlc-test');
}
