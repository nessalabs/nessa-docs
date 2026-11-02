// Writes only the modelCheck frontmatter field. The rest of the page stays.

import { createHash } from 'node:crypto';
import { realpath, rename, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseDocument, Scalar } from 'yaml';
import type { ModelCheckRecord } from '../../shared/model-check.js';
import { isInside } from '../path-containment.js';

const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function modelDigest(spec: string, config: string): string {
  return createHash('sha256').update(spec).update('\0').update(config).digest('hex');
}

export function withModelCheck(markdown: string, record: ModelCheckRecord): string {
  const match = FRONTMATTER.exec(markdown);
  if (!match || match.index !== 0) throw new Error('The page has no frontmatter, so the result was not saved.');
  const doc = parseDocument(match[1] ?? '', { uniqueKeys: true });
  const value = doc.createNode({
    ...(record.sourceRevision ? { sourceRevision: record.sourceRevision } : {}),
    checker: record.checker,
    date: record.date,
    config: record.config,
    modelDigest: record.modelDigest,
    states: record.states,
    held: [...record.held],
    broke: record.broke.map((item) => ({ rule: item.rule, path: [...item.path], states: [...item.states] })),
    unchecked: [...record.unchecked],
    ...(record.stop ? { stop: record.stop } : {}),
  });
  const revision = value.get('sourceRevision', true);
  if (revision instanceof Scalar) revision.type = Scalar.QUOTE_DOUBLE;
  doc.set('modelCheck', value);
  const body = markdown.slice(match[0].length).replace(/^\r?\n/, '');
  return `---\n${String(doc).trimEnd()}\n---\n${body}`;
}

/** Replace modelCheck on one page inside docs/state. Refuses any other path. */
export async function writeModelCheckFile(projectRoot: string, relativeFile: string, record: ModelCheckRecord): Promise<void> {
  if (!relativeFile.startsWith('docs/state/') || relativeFile.split('/').includes('..')) {
    throw new Error('Refusing to write outside docs/state.');
  }
  const root = await realpath(projectRoot);
  const state = await realpath(join(root, 'docs/state'));
  const target = await realpath(join(root, relativeFile));
  if (!isInside(target, state)) throw new Error('Refusing to write outside docs/state.');
  const next = withModelCheck(await readFile(target, 'utf8'), record);
  const temporary = join(dirname(target), `.model-check-${process.pid}.tmp`);
  try {
    await writeFile(temporary, next, { flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
