// Settings: General (appearance, diagram detail) and Health (what the loader accepted and
// rejected, and reading docs/state again). The tab is in the URL
// (/settings, /settings?tab=health), so it deep-links and Back/Forward move
// between tabs. Health reads the catalog App owns; it never fetches its own.

import { useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { SettingsGroup, SettingsRow } from '@nessa-ui/react/settings-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@nessa-ui/react/tabs';
import type { CatalogState } from './app';
import type { ProjectSource } from './project-opening/read-port';
import type { CheckerStatus } from '../shared/model-check';
import { setAppearance, useAppearance } from './appearance';
import { parseDiagramDetail, setDiagramDetail, useDiagramDetail } from './diagram-detail';
import { IssueList } from './document-page';
import { AppLink, navigate, parseSettingsTab, settingsPath, useSearch } from './router';
import { Titlebar } from './shell';
import { QuietButton, SegmentedControl, SegmentedControlOption } from './ui';

export function SettingsPage({
  catalogState,
  onReload,
  focusOnLoad,
  projectTitle,
  source,
}: {
  catalogState: CatalogState;
  onReload: () => void;
  focusOnLoad: boolean;
  projectTitle: string | null;
  source: ProjectSource;
}) {
  const tab = parseSettingsTab(useSearch());
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = 'Settings · Nessa Docs';
    if (focusOnLoad) heading.current?.focus({ preventScroll: true });
  }, [focusOnLoad]);
  return (
    <>
      <Titlebar current="Settings" />
      <div className="page settings-page" data-page-state="settings">
        <h1 ref={heading} tabIndex={-1}>
          Settings
        </h1>
        <Tabs value={tab} onValueChange={(value) => navigate(settingsPath(value === 'health' ? 'health' : 'general'))} className="settings-tabs">
          <TabsList aria-label="Settings">
            <TabsTrigger value="general" data-settings-tab="general">
              General
            </TabsTrigger>
            <TabsTrigger value="health" data-settings-tab="health">
              Health
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="settings-panel">
            <GeneralSettings projectTitle={projectTitle} />
          </TabsContent>
          <TabsContent value="health" className="settings-panel">
            <HealthSettings catalogState={catalogState} onReload={onReload} source={source} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function GeneralSettings({ projectTitle }: { projectTitle: string | null }) {
  const appearance = useAppearance();
  const detail = useDiagramDetail();
  return (
    <>
    <SettingsGroup title="Project">
      <SettingsRow label={projectTitle ?? 'No project open'} control={<QuietButton asChild><AppLink to="/open" data-action="open-project">{projectTitle ? 'Change project…' : 'Open project…'}</AppLink></QuietButton>} />
    </SettingsGroup>
    <SettingsGroup title="Appearance">
      <SettingsRow
        label="Theme"
        detail="Remembered in this browser."
        control={
          <SegmentedControl
            aria-label="Theme"
            value={appearance}
            onValueChange={(value) => setAppearance(value === 'light' ? 'light' : 'dark')}
          >
            <SegmentedControlOption value="dark" data-appearance-option="dark">
              Dark
            </SegmentedControlOption>
            <SegmentedControlOption value="light" data-appearance-option="light">
              Light
            </SegmentedControlOption>
          </SegmentedControl>
        }
      />
    </SettingsGroup>
    <SettingsGroup title="Diagrams">
      <SettingsRow
        label="Diagram detail"
        detail={
          <span data-testid="diagram-detail-help">
            Compact hides transition and edge labels and notes; they still open their details. Standard shows the chart as written and
            opens a short explanation. Full opens the whole authored section. Remembered in this browser.
          </span>
        }
        control={
          <SegmentedControl aria-label="Diagram detail" value={detail} onValueChange={(value) => setDiagramDetail(parseDiagramDetail(value))}>
            <SegmentedControlOption value="compact" data-diagram-detail-option="compact">
              Compact
            </SegmentedControlOption>
            <SegmentedControlOption value="standard" data-diagram-detail-option="standard">
              Standard
            </SegmentedControlOption>
            <SegmentedControlOption value="full" data-diagram-detail-option="full">
              Full
            </SegmentedControlOption>
          </SegmentedControl>
        }
      />
    </SettingsGroup>
    </>
  );
}

function HealthSettings({ catalogState, onReload, source }: { catalogState: CatalogState; onReload: () => void; source: ProjectSource }) {
  const reading = catalogState.kind === 'loading' || catalogState.reloading;
  const catalog = catalogState.kind === 'loaded' ? catalogState.catalog : null;
  const errors = catalog?.issues.filter((issue) => issue.severity === 'error') ?? [];
  const warnings = catalog?.issues.filter((issue) => issue.severity === 'warning') ?? [];
  return (
    <div className="health" data-health-state={catalogState.kind} data-reading={reading ? '' : undefined}>
      <SettingsGroup title="Documentation" footnote="A file with an error appears only here, with the reason.">
        <SettingsRow
          label="docs/state"
          detail={
            <span aria-live="polite" data-testid="health-summary">
              {catalog ? (
                <>
                  <span data-testid="accepted-count">{catalog.documents.length}</span> documents accepted
                </>
              ) : catalogState.kind === 'failed' ? (
                'Could not be read'
              ) : null}
              {reading ? `${catalog || catalogState.kind === 'failed' ? ' · ' : ''}Reading docs/state…` : null}
              {!reading && catalogState.kind === 'loaded' ? ` · read at ${new Date(catalogState.readAt).toLocaleTimeString()}` : null}
            </span>
          }
          control={
            <QuietButton onClick={onReload} aria-busy={reading || undefined} data-action="reload-catalog">
              <RotateCw aria-hidden="true" />
              Reload documentation
            </QuietButton>
          }
        />
      </SettingsGroup>
      <CheckerHealth source={source} />
      {catalogState.kind === 'failed' ? (
        <div className="health-failure" role="alert">
          {catalogState.message}
        </div>
      ) : null}
      {catalog ? (
        errors.length + warnings.length === 0 ? (
          <p className="quiet health-ok" data-health="healthy">
            No errors or warnings.
          </p>
        ) : (
          <>
            {errors.length > 0 ? <IssueList title={`Errors · ${errors.length}`} issues={errors} /> : <p className="quiet">No errors.</p>}
            {warnings.length > 0 ? <IssueList title={`Warnings · ${warnings.length}`} issues={warnings} /> : <p className="quiet">No warnings.</p>}
          </>
        )
      ) : null}
    </div>
  );
}

function CheckerHealth({ source }: { source: ProjectSource }) {
  const [status, setStatus] = useState<CheckerStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => {
    const controller = new AbortController();
    source.checker(controller.signal).then((outcome) => {
      if (controller.signal.aborted) return;
      if (outcome.kind === 'ok') setStatus(outcome.value);
      else if (outcome.kind === 'failed') setMessage(outcome.message);
    }, () => undefined);
    return () => controller.abort();
  };
  useEffect(load, [source]);
  const install = async () => {
    setBusy(true);
    setMessage('Downloading the rule checker…');
    const outcome = await source.installChecker();
    setBusy(false);
    if (outcome.kind === 'ok') {
      setStatus(outcome.value);
      setMessage(outcome.value.message ?? '');
    } else if (outcome.kind === 'failed') setMessage(outcome.message);
  };
  const installed = status?.state === 'ready';
  return (
    <SettingsGroup title="Rule checker" footnote="The checker downloads into a per-user cache. It is not part of the project. A model checks the design, not the code.">
      <SettingsRow
        label={installed ? 'Installed' : status?.state === 'downloading' || busy ? 'Downloading' : 'Not installed'}
        detail={
          <span data-testid="checker-status">
            <span data-testid="checker-version">{status?.version ?? 'tlc'}</span>
            {status?.cachePath ? <> · <code data-testid="checker-cache">{status.cachePath}</code></> : null}
            {message ? ` · ${message}` : status?.message ? ` · ${status.message}` : null}
          </span>
        }
        control={
          <QuietButton data-testid="checker-install" onClick={() => void install()} disabled={busy || installed} aria-busy={busy || undefined}>
            {installed ? 'Installed' : busy ? 'Installing…' : 'Install checker'}
          </QuietButton>
        }
      />
    </SettingsGroup>
  );
}
