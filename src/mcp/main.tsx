import { App } from '@modelcontextprotocol/ext-apps';
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { BundleSnapshot } from '../../shared/mcp';
import { lexMarkdown, markdownSections, markdownDiagrams } from '../../shared/markdown';
import { collectHeadings, MarkdownBody } from '../markdown';
import { Diagram } from '../diagram';
import { setAppearance } from '../appearance';
import { snapshotFromResult } from '../../shared/mcp-payload';
import '../styles.css';
import './styles.css';

const app = new App({ name: 'Nessa Docs', version: '0.1.0' }, { availableDisplayModes: ['inline'] }, { autoResize: true });
let current: BundleSnapshot | null = null;
let publish: (snapshot: BundleSnapshot) => void = () => undefined;
let report: (message: string) => void = () => undefined;
function accept(value: unknown) {
  const next = snapshotFromResult(value);
  if (current && next.scope !== current.scope) throw new Error('This explorer belongs to a different document session. Open a new explorer.');
  if (current && next.revision < current.revision) return;
  current = next;
  publish(next);
}
app.ontoolresult = (result) => {
  try {
    if (result.isError) throw new Error('The document tool failed. Ask the model to retry.');
    accept(result.structuredContent);
  } catch (error) { report(error instanceof Error ? error.message : 'Invalid document result.'); }
};
app.ontoolcancelled = () => report('Document tool cancelled.');
app.onhostcontextchanged = (context) => { if (context.theme) setAppearance(context.theme); };

function Explorer() {
  const [snapshot, setSnapshot] = useState<BundleSnapshot | null>(current);
  const [id, setId] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<number | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const contextGeneration = useRef(0);
  const detailTrigger = useRef<Element | null>(null);
  const [fragment, setFragment] = useState<string | null>(null);
  const [view, setView] = useState<'diagrams' | 'details'>('diagrams');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  publish = (next) => {
    setSnapshot(next);
    setId((previous) => next.documents.some((doc) => doc.document.id === previous) ? previous : next.catalog.rootId);
    setDetailKey(null); setError('');
  };
  report = setError;
  const doc = snapshot?.documents.find((doc) => doc.document.id === id) ?? snapshot?.documents.find((doc) => doc.document.id === snapshot.catalog.rootId);
  const tokens = useMemo(() => lexMarkdown(doc?.body ?? ''), [doc?.body]);
  const { slugs } = useMemo(() => collectHeadings(tokens), [tokens]);
  const sections = useMemo(() => markdownSections(tokens), [tokens]);
  const detailEntries = useMemo(() => doc?.diagramDetails.map((detail, key) => ({ key, detail })) ?? [], [doc]);
  const diagrams = useMemo(() => markdownDiagrams(tokens), [tokens]);
  const detailsByDiagram = useMemo(() => diagrams.map((_, index) => detailEntries.filter((entry) => entry.detail.diagram === index)), [diagrams, detailEntries]);
  const detailEntry = detailEntries.find((entry) => entry.key === detailKey);
  const detailSection = detailEntry?.detail.section.index ?? null;
  const detailNode = detailEntry?.detail.target.kind === 'node' ? detailEntry.detail.target.node : null;
  const deeperPage = detailNode !== null && doc && Object.hasOwn(doc.diagramLinks, detailNode) ? doc.diagramLinks[detailNode] : undefined;
  useEffect(() => { if (detailKey !== null) dialog.current?.focus(); }, [detailKey]);
  useEffect(() => {
    const generation = ++contextGeneration.current;
    if (!snapshot || !doc || !app.getHostCapabilities()?.updateModelContext?.text) return;
    app.updateModelContext({ content: [{ type: 'text', text: JSON.stringify({ scope: snapshot.scope, revision: snapshot.revision, documentId: doc.document.id }) }] }).catch(() => {
      if (contextGeneration.current === generation && current?.revision === snapshot.revision) setError('The host could not share this selection with the model.');
    });
    return () => { contextGeneration.current++; };
  }, [snapshot?.scope, snapshot?.revision, doc?.document.id]);
  useEffect(() => {
    if (fragment !== null) document.getElementById(fragment)?.scrollIntoView();
  }, [doc?.document.id, fragment, view]);
  const closeDetail = () => {
    setDetailKey(null);
    if (detailTrigger.current instanceof HTMLElement || detailTrigger.current instanceof SVGElement) detailTrigger.current.focus();
  };
  const choose = (next: string) => {
    if (!snapshot?.documents.some((doc) => doc.document.id === next)) { setError('That document is outside this bundle.'); return; }
    setDetailKey(null); setFragment(null); setId(next);
  };
  async function refresh() {
    const requested = current;
    setBusy(true); setError('');
    try {
      const result = await app.callServerTool({ name: 'read_docs', arguments: {} });
      if (result.isError) throw new Error('Refresh was refused by the document server.');
      accept(result.structuredContent);
    } catch (error) { if (current === requested) setError(error instanceof Error ? error.message : 'Refresh failed.'); }
    finally { setBusy(false); }
  }
  function link(event: MouseEvent) {
    const anchor = (event.target as Element).closest('a');
    if (!anchor) return;
    event.preventDefault(); event.stopPropagation();
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('/docs/')) {
      const url = new URL(href, 'https://bundle.invalid');
      choose(decodeURIComponent(url.pathname.slice(6))); setFragment(url.hash ? decodeURIComponent(url.hash.slice(1)) : null); setView('details');
    } else if (href.startsWith('#')) document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
    else if (/^(https?:|mailto:)/i.test(href)) {
      const requested = current;
      const generation = contextGeneration.current;
      const stillCurrent = () => current === requested && contextGeneration.current === generation;
      app.openLink({ url: href }).then((result) => { if (result.isError && stillCurrent()) setError('The host refused to open that link.'); }, () => { if (stillCurrent()) setError('The host could not open that link.'); });
    }
  }
  return <main className="mcp-explorer" onClickCapture={link}>
    <header><strong>Nessa Docs</strong><span>{snapshot ? `Revision ${snapshot.revision} · ${snapshot.storage.kind === 'memory' ? 'session only' : snapshot.storage.status === 'synced' ? 'saved locally' : 'save unconfirmed'}` : 'Connecting to documents…'}</span><button disabled={busy || !snapshot} onClick={refresh}>{busy ? 'Refreshing…' : 'Refresh'}</button></header>
    {snapshot?.storage.kind === 'durable' && <p className="mcp-provenance">Standalone snapshot (refresh for current path): <code>{snapshot.storage.projectPath}</code></p>}
    {error && <p role="alert">{error}</p>}
    {!doc ? <p role="status">Ask the model to create a document bundle, then show it here.</p> : <>
      <nav aria-label="Documents">{snapshot?.catalog.documents.map((entry) => <button key={entry.id} aria-current={entry.id === doc.document.id ? 'page' : undefined} onClick={() => choose(entry.id)}>{entry.title}</button>)}</nav>
      <article key={`${doc.document.id}:${snapshot?.revision}`}>
        <h1>{doc.document.title}</h1><p>{doc.document.summary}</p><p className="mcp-provenance">{doc.document.status}{doc.document.sourceRevision ? ` · Reviewed at ${doc.document.sourceRevision}` : ' · Source revision not recorded'}</p>
        <div role="group" aria-label="Document view"><button aria-pressed={view === 'diagrams'} onClick={() => setView('diagrams')}>Diagrams</button><button aria-pressed={view === 'details'} onClick={() => setView('details')}>Details</button></div>
        <MarkdownBody tokens={tokens} slugs={slugs} links={doc.links} className={view === 'diagrams' && diagrams.length > 0 ? 'prose mcp-diagrams' : 'prose'} diagram={(index, source) => <Diagram key={`${index}:${source}`} index={index} source={source} links={doc.diagramLinks} onNavigateDocument={choose} details={detailsByDiagram[index]} selectedDetail={detailKey} onSelectDetail={(key, element) => { detailTrigger.current = element; setDetailKey(key); }} />} />
        {detailSection !== null && sections[detailSection] && <section ref={dialog} tabIndex={-1} role="dialog" aria-label="Diagram details" className="mcp-detail" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closeDetail(); } }}>
          <button onClick={closeDetail}>Close details</button>
          <h2>{sections[detailSection].title}</h2>
          {deeperPage && <button onClick={() => choose(deeperPage.id)}>Open {deeperPage.title}</button>}
          <MarkdownBody tokens={tokens.slice(sections[detailSection].start + 1, sections[detailSection].end)} slugs={slugs} links={doc.links} diagram={(_, source) => <pre>{source}</pre>} />
        </section>}
        {doc.issues.length > 0 && <details><summary>Document warnings ({doc.issues.length})</summary>{doc.issues.map((issue, i) => <p key={i}>{issue.message}</p>)}</details>}
      </article>
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Explorer />);
app.connect(undefined, { timeout: 10000 }).then(() => {
  setAppearance(app.getHostContext()?.theme ?? 'light');
}, () => report('The MCP Apps host connection failed. Reopen this explorer from show_docs.'));
