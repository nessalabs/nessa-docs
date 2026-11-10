import { describe, expect, it } from 'vitest';
import { BUILT_IN_CARDS, chartFamily, parseProjectConfig } from './project-config.js';

describe('project config', () => {
  it('reads cards, references, notes and authoring rules', () => {
    const { config, problems } = parseProjectConfig(`
version: 1
cards:
  pairing: { look: handoff, label: Pairing }
references:
  - name: adr
    match: 'ADR-?(?<n>\\d+)'
    label: 'ADR {n}'
    open:
      - { file: 'docs/adr/{n:04}-*.md' }
      - { file: 'docs/decisions.md', heading: 'ADR-{n}*' }
  - name: issue
    match: '#(?<n>\\d+)'
    open: { url: 'https://github.com/o/r/issues/{n}' }
notes: [docs/adr/]
authoring:
  requireSourceRevision: true
`);
    expect(problems).toEqual([]);
    expect(config.cards.pairing).toEqual({ name: 'pairing', look: 'handoff', family: 'sequence', label: 'Pairing' });
    expect(config.cards.lifecycle).toEqual(BUILT_IN_CARDS.lifecycle);
    expect(config.references.map((reference) => [reference.source.name, reference.open.length])).toEqual([['adr', 2], ['issue', 1]]);
    expect(config.references[0]?.open[1]).toEqual({ kind: 'file', file: 'docs/decisions.md', heading: 'ADR-{n}*' });
    expect(config.notes).toEqual(['docs/adr']);
    expect(config.requireSourceRevision).toBe(true);
  });

  it('reports each problem and keeps the parts that are valid', () => {
    const { config, problems } = parseProjectConfig(`
version: 2
colors: {}
cards:
  Bad: { look: handoff }
  odd: { look: spiral }
references:
  - name: slow
    match: '(a+)+'
    open: { url: 'https://x/{0}' }
  - name: ok
    match: 'OK-\\d+'
    open: { url: 'https://x/{0}' }
  - name: ok
    match: 'OK2'
    open: { url: 'https://x' }
  - name: escape
    match: 'E-\\d+'
    open: { file: '../outside/{0}.md' }
  - name: script
    match: 'S-\\d+'
    open: { url: 'javascript:alert(1)' }
notes: [../up]
`);
    const messages = problems.map((problem) => problem.message).join('\n');
    expect(messages).toContain('version must be 1');
    expect(messages).toContain('"colors" is not a config section');
    expect(messages).toContain('card name "Bad"');
    expect(messages).toContain('card "odd" needs a look');
    expect(messages).toContain('reference "slow"');
    expect(messages).toContain('name "ok" is used twice');
    expect(messages).toContain('reference "escape": open[0] file must be a repository-relative path');
    expect(messages).toContain('url must start with http');
    expect(messages).toContain('notes: "../up"');
    expect(config.references.map((reference) => reference.source.name)).toEqual(['ok']);
  });

  it('refuses YAML that is not plain data', () => {
    expect(parseProjectConfig('a: &x 1\nb: *x\n').problems.length).toBeGreaterThan(0);
    expect(parseProjectConfig('- 1\n').problems[0]?.message).toBe('must be a YAML mapping');
    expect(parseProjectConfig('').problems).toEqual([]);
  });

  it('names a chart family from its first keyword', () => {
    expect(chartFamily('stateDiagram-v2\n  [*] --> A')).toBe('state');
    expect(chartFamily('%% note\nsequenceDiagram\n A->>B: x')).toBe('sequence');
    expect(chartFamily('---\ntitle: x\n---\nflowchart LR\n A-->B')).toBe('flowchart');
    expect(chartFamily('pie\n "a": 1')).toBeNull();
  });
});
