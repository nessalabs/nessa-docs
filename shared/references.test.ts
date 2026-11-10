import { describe, expect, it } from 'vitest';
import { compileRule, compileRules, fillTemplate, findReferences, splitReferences } from './references.js';

const adr = compileRules([{ name: 'adr', match: 'ADR-?\\s?(?<n>\\d{1,4})' }]);

describe('reference patterns', () => {
  it('finds each match with its named groups', () => {
    expect(findReferences('See ADR-202 and ADR 7.', adr).map((m) => [m.text, m.groups.n])).toEqual([['ADR-202', '202'], ['ADR 7', '7']]);
  });

  it('never splits a word', () => {
    expect(findReferences('XADR-1 and ADR-12a and (ADR-3)', adr).map((m) => m.text)).toEqual(['ADR-3']);
  });

  it('keeps the earlier rule when two rules start at the same place, and drops overlaps', () => {
    const rules = compileRules([
      { name: 'first', match: 'ADR-\\d+' },
      { name: 'second', match: 'ADR-\\d+-x' },
      { name: 'issue', match: '#\\d+' },
    ]);
    expect(findReferences('ADR-1-x and #4', rules).map((m) => `${m.rule}:${m.text}`)).toEqual(['first:ADR-1', 'issue:#4']);
  });

  it('cuts text into plain strings and matches', () => {
    const pieces = splitReferences('a ADR-1 b', adr);
    expect(pieces.map((piece) => (typeof piece === 'string' ? piece : `[${piece.text}]`))).toEqual(['a ', '[ADR-1]', ' b']);
    expect(splitReferences('nothing here', adr)).toEqual(['nothing here']);
  });

  it('refuses patterns that are empty, slow or not regular expressions', () => {
    expect(compileRule({ name: 'x', match: '' }).kind).toBe('invalid');
    expect(compileRule({ name: 'x', match: '(a+)+' }).kind).toBe('invalid');
    expect(compileRule({ name: 'x', match: '(\\w*)*b' }).kind).toBe('invalid');
    expect(compileRule({ name: 'x', match: '(a)\\1' }).kind).toBe('invalid');
    expect(compileRule({ name: 'x', match: '[' }).kind).toBe('invalid');
    expect(compileRule({ name: 'x', match: 'a*' }).kind).toBe('invalid');
    expect(compileRule({ name: 'x', match: 'x'.repeat(300) }).kind).toBe('invalid');
    expect(compileRule({ name: 'x', match: '(?:ADR|RFC)-\\d+' }).kind).toBe('ok');
  });

  it('refuses repetition hidden behind more groups, choices or counted repeats', () => {
    for (const match of ['(?:(a+))+$', '((?:a*))*b', '(?:(?:(\\w+)))+!', '(a|a)+$', '(?:(x|y))*z', '(a+){2,}', '(a?){3}', '[](a+)+', '(?<n>\\d+)+']) {
      expect(compileRule({ name: 'x', match }).kind, match).toBe('invalid');
    }
    for (const match of ['ADR-(?<n>\\d+)', '(?:ADR|RFC)-(?<n>\\d{1,5})', '\\p{L}{2,}-\\d+', '[(+)]+x', '(?:ab){2}', '(?:a+)?b', '\\(a+\\)+']) {
      expect(compileRule({ name: 'x', match }).kind, match).toBe('ok');
    }
  });

  it('a refused near-miss pattern is never run, and accepted shapes stay fast', () => {
    const rules = compileRules([{ name: 'slow', match: '(?:(a+))+$' }, { name: 'adr', match: 'ADR-(?<n>\\d+)' }]);
    expect(rules.map((rule) => rule.name)).toEqual(['adr']);
    const started = performance.now();
    findReferences(`${'a'.repeat(40)}!`, rules);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('steps over a whole emoji when skipping a zero-length or word-splitting match', () => {
    const lookahead = compileRules([{ name: 'look', match: '(?=😀)' }]);
    expect(lookahead).toHaveLength(1);
    expect(findReferences('a 😀 b 😀', lookahead)).toEqual([]);
    const emojiWord = compileRules([{ name: 'tag', match: '😀a' }]);
    expect(findReferences('😀ab 😀a', emojiWord).map((match) => match.start)).toEqual([5]);
  });

  it('fills templates, pads numbers and refuses a missing group', () => {
    const match = { text: 'ADR-7', groups: { n: '7' } };
    expect(fillTemplate('docs/adr/{n:04}-*.md', match)).toBe('docs/adr/0007-*.md');
    expect(fillTemplate('{0} is {n}', match)).toBe('ADR-7 is 7');
    expect(fillTemplate('{missing}', match)).toBeNull();
    expect(fillTemplate('https://x/{n}', { text: 'a b', groups: { n: 'a b' } }, encodeURIComponent)).toBe('https://x/a%20b');
  });

  it('splits a megabyte of text quickly', () => {
    const rules = compileRules([
      { name: 'adr', match: 'ADR-?\\s?(?<n>\\d{1,4})' },
      { name: 'issue', match: '(?<repo>nessa-agent|nessa_ui)#(?<n>\\d+)' },
      { name: 'page', match: '\\[\\[(?<id>[a-z0-9-]+)\\]\\]' },
    ]);
    const text = 'Some words about ADR-202 and nessa-agent#1234 then [[pairing]]. '.repeat(16_000);
    const start = performance.now();
    const matches = findReferences(text, rules);
    const took = performance.now() - start;
    expect(matches).toHaveLength(48_000);
    expect(took).toBeLessThan(1_000);
  });
});
