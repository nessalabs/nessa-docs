// Source checkpoints are page-owned authored evidence, visible before and after navigation.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startVerificationServer } from './server.mjs';
import { checks, loadPlaywright, openPage, waitForDocument, writeResult } from './lib.mjs';

export async function runSourceRevision(engine) {
  const project = await mkdtemp(join(tmpdir(), 'nessa-docs-revision-'));
  const revision = '1234567890abcdef1234567890abcdef12345678';
  const pageText = (id, parent, checkpoint) => `---\nid: ${id}\ntitle: ${id}\nkind: ${parent ? 'flow' : 'system'}\nstatus: fixture\nsummary: Source checkpoint verification fixture\nparent: ${parent ?? 'null'}\nsources: []\ndiagramLinks: {}\n${checkpoint ? `sourceRevision: "${checkpoint}"\n` : ''}---\n# ${id}\n\nThis fixture has no running provider.\n`;
  await mkdir(join(project, 'docs/state'), { recursive: true });
  await writeFile(join(project, 'docs/state/README.md'), pageText('revision-root', null, revision));
  await writeFile(join(project, 'docs/state/unknown.md'), pageText('revision-unknown', 'revision-root'));
  const server = await startVerificationServer(project);
  let browser;
  const c = checks();
  const pageErrors = [];
  try {
    browser = await loadPlaywright()[engine].launch();
    for (const width of [1440, 390]) {
      const { page, context, errors } = await openPage(browser, { width, height: 900 });
      await page.goto(`${server.url}/docs/revision-root`);
      await waitForDocument(page, 'revision-root');
      const checkpoint = page.getByTestId('source-revision');
      c.check(`${width}: reviewed commit visible`, await checkpoint.textContent() === `Reviewed at ${revision.slice(0, 12)}`);
      await checkpoint.focus();
      await page.keyboard.press('Enter');
      c.check(`${width}: full exact commit available`, (await page.getByTestId('source-revision-full').innerText()).includes(revision));
      c.check(`${width}: revision opens provenance by keyboard`, await page.getByTestId('source-revision-full').isVisible());
      c.check(`${width}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.goto(`${server.url}/docs/revision-unknown`);
      await waitForDocument(page, 'revision-unknown');
      c.check(`${width}: child never inherits root revision`, await page.getByTestId('source-revision').textContent() === 'Source revision not recorded');
      await page.getByTestId('source-revision').click();
      c.check(`${width}: unknown explained in provenance`, (await page.getByTestId('source-revision-full').innerText()).includes('Not recorded for this page'));
      pageErrors.push(...errors.page);
      await context.close();
    }
    c.check('no page errors', pageErrors.length === 0, { pageErrors });
    const result = { engine, script: 'source-revision', ok: c.ok, passed: c.list.filter(x => x.pass).length, total: c.list.length, checks: c.list };
    writeResult(`source-revision-${engine}`, result);
    return result;
  } finally {
    await browser?.close();
    server.stop();
    await rm(project, { recursive: true, force: true });
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runSourceRevision(process.argv[2] || 'chromium');
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
