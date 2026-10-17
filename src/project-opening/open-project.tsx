import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { ProjectOutcome, FolderPickerStatus } from '../../shared/projects';
import type { ProjectSource } from './read-port';
import { Titlebar } from '../shell';
import { Button, Input, QuietButton } from '../ui';
import { IssueList } from '../document-page';
import { selectProject } from '../router';

export const AGENT_PROMPT = 'Use the installed $nessa-docs skill to document this project in docs/state. Read the actual code, map its architecture and behavior, include diagram bindings and evidence, and explicitly mark proposed behavior. Validate the resulting catalog before finishing.';

export function OpenProject({ source, initial }: { source: ProjectSource; initial?: ProjectOutcome }) {
  const [path, setPath] = useState('');
  const [result, setResult] = useState<ProjectOutcome | undefined>(initial);
  const [operation, setOperation] = useState<'opening' | 'choosing' | null>(null);
  const busy = operation !== null;
  const [pickerStatus, setPickerStatus] = useState<FolderPickerStatus | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [copy, setCopy] = useState('Copy agent prompt');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    source.pickerStatus(controller.signal).then((status) => { if (!controller.signal.aborted) setPickerStatus(status); }, () => undefined);
    return () => controller.abort();
  }, [source]);
  useEffect(() => { document.title = 'Open project · Nessa Docs'; }, []);
  const open = async (example = false) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setOperation('opening'); setResult(undefined);
    try {
      const next = await source.open(example ? { example: true } : { path }, controller.signal);
      if (controller.signal.aborted) return;
      setOperation(null); setResult(next);
      if (next.kind === 'opened') selectProject(next.project.id);
    } catch { if (!controller.signal.aborted) setOperation(null); }
  };
  const choose = async () => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setOperation('choosing'); setPickerError(null);
    try {
      const next = await source.chooseFolder(controller.signal);
      if (controller.signal.aborted) return;
      setOperation(null);
      if (next.kind === 'selected') { setPath(next.path); setResult(undefined); }
      else if (next.kind !== 'cancelled') setPickerError(next.message);
      document.getElementById('project-folder')?.focus();
    } catch { if (!controller.signal.aborted) { setOperation(null); setPickerError('The folder chooser could not answer. Try again or paste the path.'); } }
  };
  return <>
    <Titlebar current={t("Open project")} />
    <div className="page open-project" data-page-state="welcome">
      <h1>{t("Open project")}</h1>
      <p>{t("Browse the architecture and behavior of your project. Install the nessa-docs skill and use")} <code>$nessa-docs</code> {t("with your coding agent to create")} <code>docs/state</code>{t(", then open your project folder here.")}</p>
      <p><a href="https://github.com/nessalabs/nessa-docs#install-the-skill" target="_blank" rel="noopener noreferrer">{t("Skill installation instructions")}</a></p>
      <div className="open-project-actions">
        <QuietButton onClick={async () => { try { await navigator.clipboard.writeText(AGENT_PROMPT); setCopy('Copied'); } catch { setCopy('Select the prompt below'); } }}>{t(copy)}</QuietButton>
        <QuietButton disabled={busy} onClick={() => void open(true)}>{t("Browse example")}</QuietButton>
      </div>
      {copy === 'Select the prompt below' ? <pre className="agent-prompt">{AGENT_PROMPT}</pre> : null}
      <form onSubmit={(event) => { event.preventDefault(); void open(); }}>
        <label htmlFor="project-folder">{t("Project folder")}</label>
        <div className="project-folder-input"><Input id="project-folder" dir="ltr" value={path} onChange={(event) => { pending.current?.abort(); setOperation(null); setPath(event.target.value); setResult(undefined); setPickerError(null); }} placeholder="/absolute/path/to/project" aria-describedby="project-folder-hint" autoComplete="off" spellCheck={false} />
        <Button type="button" variant="outline" size="sm" disabled={busy || pickerStatus?.kind !== 'available'} aria-describedby="folder-picker-hint" aria-busy={operation === 'choosing'} onClick={() => void choose()}>{operation === 'choosing' ? t('Choosing…') : t('Browse…')}</Button></div>
        <span id="folder-picker-hint" className={pickerStatus?.kind === 'unsupported' ? 'muted picker-hint' : 'visually-hidden'}>{pickerStatus?.kind === 'unsupported' ? pickerStatus.message : t('Choose a folder on this computer.')}</span>
        <p id="project-folder-hint" className="muted">{t("Paste the absolute path to a folder on the computer running Nessa Docs. Projects are read only.")}</p>
        <Button type="submit" size="sm" disabled={busy} aria-busy={busy}>{operation === 'opening' ? t('Opening…') : t('Open project')}</Button>
      </form>
      {pickerError ? <div className="project-opening-error" role="alert"><p>{pickerError}</p></div> : null}
      {result?.kind === 'refused' ? <div className="project-opening-error" role="alert"><p>{result.message}</p><IssueList title={t("Errors and warnings")} issues={result.issues} /></div> : null}
    </div>
  </>;
}
