// The Claude plugin in plugins/nessa-docs ships a copy of the skills, because a
// plugin may only load regular files inside its own folder. skills/ stays the
// one place they are written. `npm run sync:plugin` refreshes the copy, and
// scripts/claude-plugin.test.ts fails when the two differ.
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const SOURCE = join(root, 'skills');
export const COPY = join(root, 'plugins/nessa-docs/skills');
export const SKILLS = ['nessa-docs', 'map-implicit-states'];
// Codex interface metadata; Claude does not read it.
const LEFT_OUT = new Set(['agents']);

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (LEFT_OUT.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path));
    else out.push(path);
  }
  return out;
}

/** Every file that should be in the copy, as paths relative to skills/. */
export async function expectedFiles() {
  const all = [];
  for (const skill of SKILLS) all.push(...await files(join(SOURCE, skill)));
  return all.map((path) => relative(SOURCE, path)).sort();
}

/** Paths whose copy is missing, extra, or differs from skills/. */
export async function differences() {
  const expected = await expectedFiles();
  const actual = (await files(COPY).catch(() => [])).map((path) => relative(COPY, path)).sort();
  const wrong = new Set([
    ...expected.filter((path) => !actual.includes(path)),
    ...actual.filter((path) => !expected.includes(path)),
  ]);
  for (const path of expected.filter((path) => actual.includes(path))) {
    const [a, b] = await Promise.all([readFile(join(SOURCE, path)), readFile(join(COPY, path))]);
    if (!a.equals(b)) wrong.add(path);
  }
  return [...wrong].sort();
}

export async function sync() {
  await rm(COPY, { recursive: true, force: true });
  for (const path of await expectedFiles()) {
    await mkdir(join(COPY, path, '..'), { recursive: true });
    await cp(join(SOURCE, path), join(COPY, path));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await sync();
  console.log(`Copied ${SKILLS.join(', ')} into ${relative(root, COPY)}`);
}
