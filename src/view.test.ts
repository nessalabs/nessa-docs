import { describe, expect, it } from 'vitest';
import { lexMarkdown } from '../shared/markdown';
import { chooseView, opensWithSummary } from './document-page';

describe('chooseView', () => {
  it('opens a page with diagrams on its diagrams', () => {
    expect(chooseView('', '', true)).toBe('diagrams');
  });
  it('opens Details for ?view=details and for a section link', () => {
    expect(chooseView('?view=details', '', true)).toBe('details');
    expect(chooseView('', '#trace', true)).toBe('details');
    expect(chooseView('?view=diagrams', '#trace', true)).toBe('diagrams');
  });
  it('has no other view names: the old ?view=read is not an alias', () => {
    expect(chooseView('?view=read', '', true)).toBe('diagrams');
    expect(chooseView('?view=read', '#trace', true)).toBe('details');
    expect(chooseView('?view=source', '', true)).toBe('diagrams');
  });
  it('always shows Details for a page without diagrams', () => {
    expect(chooseView('?view=diagrams', '', false)).toBe('details');
  });
  it('opens Work only on a page that has tasks or records', () => {
    expect(chooseView('?view=work', '', true, true)).toBe('work');
    expect(chooseView('?view=work', '', false, true)).toBe('work');
    expect(chooseView('?view=work', '', true, false)).toBe('diagrams');
    expect(chooseView('?view=work', '', false, false)).toBe('details');
  });
});

// Details shows the header summary unless the body's own first paragraph already says it: the whole paragraph, or
// its complete first sentence. One table of what a reader sees, so every clause of the rule has an example here.
const VALIDATED = 'Validated values have no runtime lifecycle.';
const summaryExamples: readonly { case: string; summary: string; body: string; said: boolean }[] = [
  // The whole first paragraph
  { case: 'whole paragraph, spacing and a final stop aside', summary: VALIDATED, body: '\nValidated values have\nno runtime lifecycle\n\nMore.\n', said: true },
  // A complete first sentence
  { case: 'first sentence ending in a full stop, links aside', summary: VALIDATED, body: '[Validated values](x.md) have\nno runtime lifecycle. Storage is elsewhere.\n', said: true },
  { case: 'first sentence ending in its own ?', summary: 'Is it ready?', body: 'Is it ready? Yes, once signed in.\n', said: true },
  { case: 'first sentence ending in its own !', summary: 'Stop the agent!', body: 'Stop the agent! Its tools stop with it.\n', said: true },
  { case: 'first sentence ending in a quoted stop', summary: 'Mode is "on."', body: 'Mode is "on." More follows.\n', said: true },
  { case: 'first sentence ending in a bracketed stop', summary: 'Values are final (for now.)', body: 'Values are final (for now.) More follows.\n', said: true },
  // Not a complete sentence: the header keeps the summary
  { case: 'own ? with no space after it', summary: 'Is it ready?', body: 'Is it ready?Yes.\n', said: false },
  { case: 'quoted stop with no space after it', summary: 'Mode is "on."', body: 'Mode is "on."More follows.\n', said: false },
  { case: 'a stop inside a number', summary: 'Calls use version 2', body: 'Calls use version 2.5 today.\n', said: false },
  { case: 'a shared start that stops mid-sentence', summary: VALIDATED, body: 'Validated values have no runtime lifecycle beyond construction. More.\n', said: false },
  { case: 'a summary missing the sentence’s closing quote', summary: 'Mode is "on', body: 'Mode is "on." More follows.\n', said: false },
  { case: 'a summary missing the sentence’s closing quote and bracket', summary: 'Values are final (see “Values', body: 'Values are final (see “Values.”) More.\n', said: false },
  // Not the first paragraph
  { case: 'a different first paragraph', summary: VALIDATED, body: 'An introduction in other words.\n', said: false },
  { case: 'a later paragraph saying it', summary: VALIDATED, body: `First.\n\n${VALIDATED} More.\n`, said: false },
  { case: 'a first block that is a heading', summary: VALIDATED, body: `## ${VALIDATED}\n`, said: false },
];

describe('opensWithSummary', () => {
  it.each(summaryExamples)('$case: $said', ({ summary, body, said }) => {
    expect(opensWithSummary(lexMarkdown(body), summary)).toBe(said);
  });
});
