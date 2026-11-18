// The extension's options: whether docs folders open in the reader on their
// own, and an optional GitHub token for repositories the github.com session
// does not reach. Both stay in this browser (storage.local).

import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../../src/styles.css';
import './options.css';
import { applyAppearance, readAppearance } from '../../src/appearance';
import { Input, QuietButton, SegmentedControl, SegmentedControlOption } from '../../src/ui';
import { extensionApi } from './extension-api';
import { readSettings, saveSettings, type Settings } from './settings';

applyAppearance(readAppearance());
const api = extensionApi();

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  // Saves run one at a time, each applied to what the last one stored, so a
  // toggle saved during a token removal can not write the old token back.
  const stored = useRef<Settings | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    void readSettings(api).then((read) => { stored.current = read; setSettings(read); setToken(read.token ?? ''); });
  }, []);
  if (!settings) return null;
  const save = (change: Partial<Settings>, said: string) => {
    queue.current = queue.current.then(async () => {
      const next = { ...(stored.current ?? settings), ...change };
      try {
        await saveSettings(api, next);
        stored.current = next;
        setSettings(next);
        setMessage(said);
      } catch {
        setMessage('The browser did not save that. Try again.');
      }
    });
  };
  return (
    <main className="options">
      <h1><span className="brand-name">nessa</span><span className="brand-product">Docs</span></h1>
      <p className="options-lead">Reads <code>docs/state</code> folders on GitHub in the Nessa Docs reader. Everything is read from GitHub as you browse; nothing is sent anywhere else.</p>
      <section className="options-row">
        <div>
          <h2>Open docs folders in the reader</h2>
          <p>Off: GitHub's own view stays, with an Open in Docs button in the corner.</p>
        </div>
        <SegmentedControl aria-label="Open docs folders in the reader" value={settings.autoOpen ? 'on' : 'off'} onValueChange={(value) => save({ autoOpen: value === 'on' }, value === 'on' ? 'Docs folders open in the reader.' : 'GitHub’s view stays until you open the reader.')}>
          <SegmentedControlOption value="on">On</SegmentedControlOption>
          <SegmentedControlOption value="off">Off</SegmentedControlOption>
        </SegmentedControl>
      </section>
      <section className="options-row options-token">
        <div>
          <h2>GitHub token <span className="options-optional">optional</span></h2>
          <p>Not needed while you are signed in to github.com: the reader uses that session. Add one only for repositories the session does not reach. Use a fine-grained token with read-only <b>Contents</b> access to just those repositories.</p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); const trimmed = token.trim(); save({ token: trimmed || null }, trimmed ? 'Token saved in this browser.' : 'Token removed.'); }}>
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="github_pat_…" value={token} onChange={(event) => setToken(event.target.value)} aria-label="GitHub token" />
          <QuietButton type="submit">Save</QuietButton>
          {settings.token ? <QuietButton type="button" onClick={() => { setToken(''); save({ token: null }, 'Token removed.'); }}>Remove</QuietButton> : null}
        </form>
      </section>
      <p className="options-message" role="status">{message}</p>
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><Options /></StrictMode>);
