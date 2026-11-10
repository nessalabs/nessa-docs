// The Work view: a page's tasks and the records that moved them, as the
// server judged them. Nothing here decides a state; it draws what the replay
// in server/work.ts worked out, and says how old the newest record is. It never
// claims an agent is still running: a record says what was last written, and when.

import type { DiagramDetailTarget, PageWork, WorkRecord, WorkTask } from '../shared/api';
import { isOpen, type LifecycleState, type ShownState } from '../shared/lifecycle';
import { WORK_TEXT, WorkStateLabel } from './ui';

/** Open work whose newest record is older than the project's quietAfter. */
export function isQuiet(state: ShownState, lastRecordAt: string | null, quietAfterMs: number, now: number): boolean {
  if (state === 'stale' || state === 'draft' || state === 'planned' || !isOpen(state as LifecycleState) || lastRecordAt === null) return false;
  return now - Date.parse(lastRecordAt) > quietAfterMs;
}

/** "just now", "12 min ago", "3 h ago", "2 d ago". */
export function ago(at: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export interface WorkMark {
  readonly target: DiagramDetailTarget;
  readonly state: LifecycleState;
  readonly quiet: boolean;
  readonly title: string;
}

/** Each chart's anchored tasks, by diagram index, for the box outlines. */
export function workMarks(work: PageWork | null, now: number): ReadonlyMap<number, readonly WorkMark[]> {
  const marks = new Map<number, WorkMark[]>();
  for (const task of work?.tasks ?? []) {
    if (!task.anchor) continue;
    const mark = { target: task.anchor.target, state: task.state, quiet: isQuiet(task.state, task.lastRecordAt, work?.quietAfterMs ?? Infinity, now), title: task.title };
    marks.set(task.anchor.diagram, [...(marks.get(task.anchor.diagram) ?? []), mark]);
  }
  return marks;
}

function anchorText(task: WorkTask): string {
  if (!task.anchor) return 'Not drawn: its anchor names no element (see Health)';
  const target = task.anchor.target;
  return target.kind === 'node' ? `Box ${target.node}` : `Arrow ${target.from} → ${target.to}, “${target.label}”`;
}

function Evidence({ record }: { record: WorkRecord }) {
  if (record.evidence.length === 0) return null;
  return (
    <ul className="work-evidence" aria-label="Evidence">
      {record.evidence.map((entry, at) => (
        <li key={at} data-kind={entry.kind}>
          {entry.kind === 'pr' ? (
            <a href={entry.value} target="_blank" rel="noreferrer">
              Pull request
            </a>
          ) : entry.kind === 'commit' ? (
            <>
              Commit <code title={entry.value}>{entry.value.slice(0, 12)}</code>
            </>
          ) : (
            <>
              {entry.kind === 'check' ? 'Check' : 'Diff'}: {entry.value}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A record's body as plain paragraphs: a blank line starts a new one, a single line break is a space. Never parsed as HTML. */
function Paragraphs({ text, className }: { text: string; className: string }) {
  return (
    <div className={className}>
      {text.split(/\n\s*\n/).map((paragraph, at) => (
        <p key={at}>{paragraph.replace(/\s*\n\s*/g, ' ')}</p>
      ))}
    </div>
  );
}

function RecordItem({ record, titles, now }: { record: WorkRecord; titles: ReadonlyMap<string, string>; now: number }) {
  const moved = record.event === 'note' ? 'note' : `${record.event} → ${WORK_TEXT[record.state].toLowerCase()}`;
  return (
    <li className="work-record" data-refused={record.refused !== null ? '' : undefined} data-event={record.event}>
      <p className="work-record-head">
        <time dateTime={record.at} title={record.at}>
          {ago(record.at, now)}
        </time>
        <span className="work-record-by">
          {record.by}
          {record.model ? ` (${record.model})` : ''}
        </span>
        <span className="work-record-move">{moved}</span>
        <span className="work-record-task">{record.task ? (titles.get(record.task) ?? record.task) : 'The page'}</span>
      </p>
      {record.refused !== null ? (
        <p className="work-record-refused" role="note">
          Refused: {record.refused}. This record does not move the box.
        </p>
      ) : null}
      {record.body ? <Paragraphs text={record.body} className="work-record-body" /> : null}
      <Evidence record={record} />
      <p className="work-record-file">
        <code>{record.file}</code>
      </p>
    </li>
  );
}

export function WorkView({ work, now }: { work: PageWork; now: number }) {
  const { summary, tasks, records } = work;
  const titles = new Map(tasks.map((task) => [task.id, task.title]));
  const question = (task: WorkTask) =>
    task.state === 'blocked' ? [...records].reverse().find((record) => record.task === task.id && record.event === 'ask' && record.refused === null)?.body ?? null : null;
  const pageQuiet = isQuiet(summary.state, summary.lastRecordAt, work.quietAfterMs, now);
  return (
    <section className="work-view" aria-label="Work">
      <p className="work-summary">
        <WorkStateLabel state={summary.state} quiet={pageQuiet} />
        <span>
          {summary.tasks > 0 ? `${summary.tasks} task${summary.tasks === 1 ? '' : 's'}, ${summary.open} open` : 'No tasks; the page moves on its own records'}
          {summary.blocked > 0 ? `, ${summary.blocked} blocked` : ''}
          {summary.lastRecordAt ? ` · last record ${ago(summary.lastRecordAt, now)}` : ' · no records yet'}
          {summary.refused > 0 ? ` · ${summary.refused} refused` : ''}
        </span>
      </p>
      {summary.state === 'stale' ? (
        <p className="work-note" role="note">
          A source file changed after this page's source revision. Review the page against the newer source before trusting it.
        </p>
      ) : null}
      {tasks.length > 0 ? (
        <ol className="work-tasks" aria-label="Tasks">
          {tasks.map((task) => {
            const asked = question(task);
            const quiet = isQuiet(task.state, task.lastRecordAt, work.quietAfterMs, now);
            return (
              <li key={task.id} className="work-task" data-task={task.id}>
                <p className="work-task-head">
                  <WorkStateLabel state={task.state} quiet={quiet} />
                  <span className="work-task-title">{task.title}</span>
                </p>
                <p className="work-task-meta">
                  <code>{task.id}</code>
                  <span>{anchorText(task)}</span>
                  {task.dependsOn.length > 0 ? <span>After {task.dependsOn.map((id) => titles.get(id) ?? id).join(', ')}</span> : null}
                  {task.lastRecordAt ? (
                    <span>
                      Last record by {task.lastBy}, {ago(task.lastRecordAt, now)}
                    </span>
                  ) : null}
                </p>
                {asked ? <Paragraphs text={asked} className="work-question" /> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      <h2 className="work-heading">Records</h2>
      {records.length > 0 ? (
        <ol className="work-records" aria-label="Records, newest first">
          {[...records].reverse().map((record) => (
            <RecordItem key={record.file} record={record} titles={titles} now={now} />
          ))}
        </ol>
      ) : (
        <p className="quiet">No records yet. An agent adds one file under docs/state/work/{'<page>'}/ for each change of state.</p>
      )}
    </section>
  );
}
