// Runs the browser verification in Chromium and WebKit and prints one JSON
// summary. Exits non-zero if any contract fails.
// Without supplied URLs, temporary servers read the bundled fixtures and show welcome.
//   WELCOME_URL — optional already-running server with no startup project
//   FIXTURE_URL (otherwise temporary loopback server) — server started on fixtures/demo-repo:
//                 journeys, responsive, sidebar-resize, settings (scope "fixture")
//   REAL_URL    (optional Nessa atlas server) — server on the real repository:
//                 settings (scope "real"), real-data, navigation, brand, and details' real rows
//   DETAILS_URL (otherwise temporary loopback server) — server started on fixtures/details-repo: details
//   REAL_IDS    — optional comma-separated doc IDs for a responsive pass on real data
//   BASELINE_URL — optional server on an older build, for brand.mjs's chart comparison
//   STALE_BUILD_A — root of an OLDER build (dist/ + node_modules) for stale-build.mjs.
//                   Without it that script is reported as skipped, never as passed.

import { fileURLToPath } from 'node:url';
import { startVerificationServer } from './server.mjs';
import { runOnboarding } from './onboarding.mjs';
import { runProjectLayout } from './project-layout.mjs';
import { runReleaseRecovery } from './release-recovery.mjs';
import { runReservedLinks } from './reserved-links.mjs';
import { runBrand } from './brand.mjs';
import { runDetails } from './details.mjs';
import { runJourneys } from './journeys.mjs';
import { runNavigation } from './navigation.mjs';
import { runRealData } from './real-data.mjs';
import { runSourceRevision } from './source-revision.mjs';
import { runResponsive } from './responsive.mjs';
import { runSettings } from './settings.mjs';
import { runSidebarResize } from './sidebar-resize.mjs';
import { runStaleBuild } from './stale-build.mjs';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const owned = [];
async function server(configured, project) {
  if (configured) return configured;
  const running = await startVerificationServer(project); owned.push(running); return running.url;
}
const summary = [];
try {
const fixture = await server(process.env.FIXTURE_URL, fileURLToPath(new URL('../fixtures/demo-repo', import.meta.url)));
const details = await server(process.env.DETAILS_URL, fileURLToPath(new URL('../fixtures/details-repo', import.meta.url)));
const welcome = await server(process.env.WELCOME_URL, null);
const real = process.env.REAL_URL || null;
const staleA = process.env.STALE_BUILD_A || null;
for (const engine of ['chromium', 'webkit']) {
  const revision = await runSourceRevision(engine);
  summary.push({ engine, script: revision.script, scope: 'fixture', ok: revision.ok, passed: revision.passed, total: revision.total });
  process.env.BASE_URL = welcome;
  const onboarding = await runOnboarding(engine);
  summary.push({ engine, script: onboarding.script, scope: 'package', baseUrl: welcome, ok: onboarding.ok, passed: onboarding.passed, total: onboarding.total });
  const layout = await runProjectLayout(engine);
  summary.push({ engine, script: layout.script, scope: 'package', baseUrl: welcome, ok: layout.ok, passed: layout.passed, total: layout.total });
  const recovery = await runReleaseRecovery(engine);
  summary.push({ engine, script: recovery.script, scope: 'package', baseUrl: welcome, ok: recovery.ok, passed: recovery.passed, total: recovery.total });
  const reserved = await runReservedLinks(engine);
  summary.push({ engine, script: reserved.script, scope: 'package', ok: reserved.ok, passed: reserved.passed, total: reserved.total });
  process.env.BASE_URL = fixture;
  for (const run of [runJourneys, runResponsive, runSidebarResize]) {
    const r = await run(engine);
    summary.push({ engine, script: r.script, scope: 'fixture', baseUrl: fixture, ok: r.ok, passed: r.passed, total: r.total });
  }
  const sf = await runSettings(engine, 'fixture');
  summary.push({ engine, script: sf.script, scope: 'fixture', baseUrl: fixture, ok: sf.ok, passed: sf.passed, total: sf.total });
  process.env.BASE_URL = details;
  if (real) process.env.REAL_URL = real; else delete process.env.REAL_URL;
  const d = await runDetails(engine);
  summary.push({ engine, script: d.script, scope: real ? 'fixture+real' : 'fixture', baseUrl: details, realUrl: real, ok: d.ok, passed: d.passed, total: d.total });
  if (real) {
  process.env.BASE_URL = real;
  const sr = await runSettings(engine, 'real');
  summary.push({ engine, script: sr.script, scope: 'real', baseUrl: real, ok: sr.ok, passed: sr.passed, total: sr.total });
  const r = await runRealData(engine);
  summary.push({ engine, script: r.script, scope: 'real', baseUrl: real, ok: r.ok, passed: r.passed, total: r.total, facts: { documents: r.facts.documents, errors: r.facts.errors, diagramTotals: r.facts.diagramTotals } });
  const n = await runNavigation(engine);
  summary.push({ engine, script: n.script, scope: 'real', baseUrl: real, ok: n.ok, passed: n.passed, total: n.total });
  const b = await runBrand(engine);
  summary.push({ engine, script: b.script, scope: 'real', baseUrl: real, baselineUrl: b.baselineUrl, ok: b.ok, passed: b.passed, total: b.total });
  if (process.env.REAL_IDS) {
    const rr = await runResponsive(engine, process.env.REAL_IDS.split(','), 'responsive-real');
    summary.push({ engine, script: rr.script, scope: 'real', baseUrl: real, ok: rr.ok, passed: rr.passed, total: rr.total });
  }
  } else summary.push({ engine, script: 'atlas-specific', skipped: 'Set REAL_URL to a server reading the Nessa atlas for real-data, navigation, brand and real settings rows.' });
  if (staleA) {
    const s = await runStaleBuild(engine, staleA, join(HERE, '..'));
    summary.push({ engine, script: s.script, ok: s.ok, passed: s.passed, total: s.total });
  } else {
    summary.push({ engine, script: 'stale-build', skipped: 'set STALE_BUILD_A to an older build root to run it' });
  }
}
} finally { for (const running of owned) running.stop(); }
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.every((s) => s.ok || s.skipped) ? 0 : 1);
