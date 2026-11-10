// What read_config returns: the parsed project config in plain JSON, with the
// built-in vocabulary a skill may use. One owner (server/project-config.ts)
// parses; this file only presents.

import { STATE_ROLES } from '../../shared/api.js';
import { LIFECYCLE, type Lifecycle } from '../../shared/lifecycle.js';
import { BUILT_IN_CARDS, CONFIG_FILE, EMPTY_WORK_CONFIG, parseProjectConfig, type ProjectConfig } from '../project-config.js';

export const CONFIG_GUIDE = [
  `Project config: ${CONFIG_FILE} (optional). Include it in replace_docs as { path, text }.`,
  'Cards: name one on a Mermaid fence, e.g. ```mermaid card=handoff title="Pair a phone"; the card must suit the chart (lifecycle = stateDiagram-v2, handoff = sequenceDiagram, map = flowchart, plain = any).',
  `State roles: tag a state with Mermaid's class line, e.g. "class Pending waiting". Roles: ${STATE_ROLES.join(', ')}.`,
  'References: plain text matching a pattern becomes a pill, never inside code or link text. open targets are tried in order: { document, heading? }, { file, heading? } or { url }.',
  'Glossary: a page named glossary.md lists the acronyms of its folder and below, one "## TERM" heading each with a paragraph saying what it stands for and is. Every use of a term links to its entry and shows that paragraph on hover; Health warns (unlisted-acronym) when a covered page uses an acronym none of its glossaries lists. A reference may not be named glossary.',
  'Work: a page may plan tasks in a work block ({ id, title, anchor: { diagram, node | edge }, dependsOn? }); progress is one record file per change under docs/state/work/<page>/<task>/<at>-<by>.md, never edited. lifecycle lists the states and events; work.people may accept or answer.',
].join('\n');

export interface ConfigView {
  readonly present: boolean;
  readonly valid: boolean;
  readonly problems: readonly string[];
  readonly cards: readonly { name: string; look: string; family: string; label: string; builtIn: boolean }[];
  readonly stateRoles: readonly string[];
  readonly references: readonly { name: string; match: string; label: string; open: readonly unknown[] }[];
  readonly notes: readonly string[];
  readonly authoring: { readonly requireSourceRevision: boolean };
  readonly work: { readonly people: readonly string[]; readonly quietAfterMs: number; readonly require: Readonly<Record<string, readonly string[]>> };
  /** The fixed lifecycle every page and task follows (skills/nessa-docs/references/lifecycle.json). */
  readonly lifecycle: Lifecycle;
}

export function configView(text: string | null): ConfigView {
  const outcome = text === null ? null : parseProjectConfig(text);
  const config: ProjectConfig | null = outcome?.config ?? null;
  const cards = config?.cards ?? BUILT_IN_CARDS;
  return {
    present: text !== null,
    valid: (outcome?.problems.length ?? 0) === 0,
    problems: outcome?.problems.map((problem) => problem.message) ?? [],
    cards: Object.values(cards).map((card) => ({ ...card, builtIn: Object.hasOwn(BUILT_IN_CARDS, card.name) && BUILT_IN_CARDS[card.name]?.look === card.look })),
    stateRoles: STATE_ROLES,
    references: (config?.references ?? []).map((reference) => ({ name: reference.source.name, match: reference.source.match, label: reference.label, open: reference.open })),
    notes: config?.notes ?? [],
    authoring: { requireSourceRevision: config?.requireSourceRevision ?? false },
    work: config?.work ?? EMPTY_WORK_CONFIG,
    lifecycle: LIFECYCLE,
  };
}
