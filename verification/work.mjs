// Work records drawn in the reader: box outlines from task states, the sidebar
// pill, the Work view with its open question and a refused record. The fixture
// is written fresh so record ages are known.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { startVerificationServer } from './server.mjs';
import { checks, loadPlaywright, openPage, waitForDiagrams, waitForDocument, writeResult } from './lib.mjs';

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function runWork(engine) {
  const project = await mkdtemp(join(tmpdir(), 'nessa-docs-work-'));
  const now = Date.now();
  const write = async (path, text) => {
    await mkdir(dirname(join(project, path)), { recursive: true });
    await writeFile(join(project, path), text);
  };
  const record = (task, event, state, at, by, body = '', extra = '') =>
    write(`docs/state/work/run/${task ? `${task}/` : ''}${iso(at).replace(/:/g, '-')}-${by}.md`, `---\npage: run\n${task ? `task: ${task}\n` : ''}event: ${event}\nstate: ${state}\nat: ${iso(at)}\nby: ${by}\n${extra}---\n${body}\n`);
  await write('docs/state/README.md', '---\nid: root\ntitle: Root\nkind: system\nstatus: fixture\nsummary: Work view fixture\nparent: null\nsources: []\ndiagramLinks: {}\n---\n# Root\n');
  await write('docs/state/nessa-docs.yaml', 'work:\n  people: [person]\n  quietAfter: 1h\n');
  await write('docs/state/run.md', `---\nid: run\ntitle: Run a command\nkind: statechart\nstatus: proposed\nsummary: A command starts, runs, or is cleaned up.\nparent: root\nsources: []\ndiagramLinks: {}\nwork:\n  - id: start-it\n    title: Start the command\n    anchor: { diagram: 0, node: Running }\n  - id: cleanup\n    title: Clean up a timed out start\n    anchor: { diagram: 0, edge: { from: Starting, to: Cleaning, label: timed out } }\n---\n# Run a command\n\n\`\`\`mermaid\nstateDiagram-v2\n  [*] --> Starting\n  Starting --> Running: started\n  Starting --> Cleaning: timed out\n\`\`\`\n`);
  await record(null, 'accept', 'planned', now - 5 * 3600_000, 'person', 'Plan accepted.');
  await record('start-it', 'start', 'working', now - 4 * 3600_000, 'codex');
  await record('start-it', 'ask', 'blocked', now - 3 * 3600_000, 'codex', 'Retry a failed start, or give up? I recommend one retry.');
  await record('cleanup', 'start', 'working', now - 10 * 60_000, 'claude');
  await record('cleanup', 'merge', 'implemented', now - 5 * 60_000, 'claude', '', `evidence:\n  - commit: "${'a'.repeat(40)}"\n`);
  const server = await startVerificationServer(project);
  let browser;
  const c = checks();
  const pageErrors = [];
  try {
    browser = await loadPlaywright()[engine].launch();
    for (const width of [1440, 390]) {
      const { page, context, errors } = await openPage(browser, { width, height: 900 });
      await page.goto(`${server.url}/docs/run`);
      await waitForDocument(page, 'run');
      await waitForDiagrams(page);
      const marks = await page.evaluate(() => [...document.querySelectorAll('figure.diagram svg [data-work-state]')].map((element) => ({
        tag: element.tagName.toLowerCase(),
        state: element.getAttribute('data-work-state'),
        quiet: element.hasAttribute('data-work-quiet'),
        title: element.querySelector(':scope > title')?.textContent ?? '',
      })));
      c.check(`${width}: blocked task outlines its box, quiet after an hour`, marks.some((mark) => mark.tag === 'g' && mark.state === 'blocked' && mark.quiet && mark.title.startsWith('Start the command')), { marks });
      c.check(`${width}: working task outlines its arrow`, marks.some((mark) => mark.state === 'working' && !mark.quiet), { marks });
      c.check(`${width}: legend names the states drawn`, (await page.locator('.work-legend').innerText()).includes('Blocked'));
      if (width === 1440) c.check(`${width}: sidebar pill shows the page state`, (await page.locator('.tree-link[data-doc-id="run"] .row-work').innerText()) === 'Blocked');
      await page.goto(`${server.url}/docs/run?view=work`);
      await waitForDocument(page, 'run');
      await page.locator('.work-view').waitFor();
      c.check(`${width}: open question shown`, (await page.locator('[data-task="start-it"] .work-question').innerText()).includes('I recommend one retry'));
      c.check(`${width}: refused record shown and named`, (await page.locator('.work-record[data-refused]').innerText()).includes('is not allowed from working'));
      c.check(`${width}: refused merge did not move the task`, (await page.locator('[data-task="cleanup"] [data-work-state]').first().getAttribute('data-work-state')) === 'working');
      c.check(`${width}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      pageErrors.push(...errors.page);
      await context.close();
    }
    c.check('no page errors', pageErrors.length === 0, { pageErrors });
    const result = { engine, script: 'work', ok: c.ok, passed: c.list.filter((x) => x.pass).length, total: c.list.length, checks: c.list };
    writeResult(`work-${engine}`, result);
    return result;
  } finally {
    await browser?.close();
    server.stop();
    await rm(project, { recursive: true, force: true });
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runWork(process.argv[2] || 'chromium');
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
