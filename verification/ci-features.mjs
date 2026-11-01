// Run the focused checks present in this PR. The original suite runs separately.
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const scripts = [
  'arabic', 'review-flows', 'details-direction',
  'project-brand', 'inspector-header', 'outline-menu',
];
let failed = false;
for (const name of scripts) {
  const script = `verification/${name}.mjs`;
  if (!existsSync(script)) continue;
  const evidence = resolve('verification/results/features', name);
  mkdirSync(evidence, { recursive: true });
  console.log(`::group::Feature: ${name}`);
  const env = { ...process.env, EVIDENCE_DIR: evidence };
  if (existsSync('src/i18n.ts')) env.WITH_ARABIC = '1';
  const result = spawnSync(process.execPath, [script], {
    env, stdio: 'inherit', timeout: 600_000,
  });
  console.log('::endgroup::');
  if (result.error) console.error(result.error);
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
