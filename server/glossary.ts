// Glossaries: a page named glossary.md lists the acronyms of its folder and
// every folder below it, one `## TERM` heading each with its meaning under it.
// That page is the only list of terms: the reader links each use of a term to
// its entry (as a reference pill, server/references.ts), and Health names any
// acronym a page uses that no glossary in its scope lists.

import { posix } from 'node:path';
import type { Token, Tokens } from 'marked';
import { forEachReferenceText, headingSlugs, lexMarkdown, plainText } from '../shared/markdown.js';
import { type CompiledRule, GLOSSARY_RULE, GLOSSARY_TERM, glossaryRegex, MAX_GLOSSARY_TERMS, splitReferences } from '../shared/references.js';

export const GLOSSARY_FILE = 'glossary.md';
/** A pill's hover text is cut near this many characters. */
export const GIST_MAX_CHARS = 280;
/** At most this many unlisted acronyms are named in one page's warning. */
const UNLISTED_NAMED = 12;

export interface GlossaryEntry {
  readonly term: string;
  readonly documentId: string;
  /** The glossary page's file, repository-relative. */
  readonly file: string;
  /** The heading's anchor on the glossary page. */
  readonly fragment: string;
  /** The entry's Markdown, heading included. */
  readonly body: string;
  readonly gist: string;
}

export interface GlossaryProblem {
  readonly message: string;
}

/** The entries one glossary page lists, and what is wrong with the rest. */
export function readGlossary(documentId: string, file: string, body: string): { entries: GlossaryEntry[]; problems: GlossaryProblem[] } {
  const tokens = lexMarkdown(body);
  const slugs = headingSlugs(tokens);
  const entries: GlossaryEntry[] = [];
  const problems: GlossaryProblem[] = [];
  const seen = new Set<string>();
  for (let at = 0; at < tokens.length; at += 1) {
    const heading = tokens[at] as Token;
    if (heading.type !== 'heading' || (heading as Tokens.Heading).depth !== 2) continue;
    let end = at + 1;
    while (end < tokens.length && !(tokens[end]?.type === 'heading' && (tokens[end] as Tokens.Heading).depth <= 2)) end += 1;
    const term = plainText((heading as Tokens.Heading).tokens).trim();
    const section = tokens.slice(at, end);
    if (!GLOSSARY_TERM.test(term)) {
      problems.push({ message: `"## ${term}" is not a term; a glossary entry's heading is the term alone, with two or more capitals, such as "## SDK" or "## gRPC"` });
      continue;
    }
    if (seen.has(term)) {
      problems.push({ message: `"${term}" is listed twice; keep one entry` });
      continue;
    }
    seen.add(term);
    const gist = firstParagraph(section);
    if (gist === '') {
      problems.push({ message: `"${term}" has no meaning under it; write what it stands for and what it is in a paragraph` });
      continue;
    }
    entries.push({ term, documentId, file, fragment: slugs.get(heading) ?? '', body: section.map((token) => token.raw).join(''), gist });
  }
  return { entries, problems };
}

/** The first paragraph's text, cut at a word near GIST_MAX_CHARS. */
export function firstParagraph(tokens: readonly Token[]): string {
  const paragraph = tokens.find((token) => token.type === 'paragraph') as Tokens.Paragraph | undefined;
  return gistOf(paragraph ? plainText(paragraph.tokens) : '');
}

/** Text as a hover shows it: one line, cut at a word near GIST_MAX_CHARS, never inside a character. */
export function gistOf(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length <= GIST_MAX_CHARS) return text;
  // Cut by code points, so an emoji is never split in half.
  const cut = Array.from(text).slice(0, GIST_MAX_CHARS).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > GIST_MAX_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/** Every glossary page, by the folder it covers. */
export class GlossaryIndex {
  private readonly byFolder = new Map<string, { readonly file: string; readonly entries: ReadonlyMap<string, GlossaryEntry> }>();
  private readonly scopes = new Map<string, ReadonlyMap<string, GlossaryEntry>>();

  add(file: string, entries: readonly GlossaryEntry[]): void {
    this.byFolder.set(posix.dirname(file), { file, entries: new Map(entries.map((entry) => [entry.term, entry])) });
  }

  /** The nearest glossary page covering this file, or null when none does. */
  nearest(file: string): string | null {
    for (let folder = posix.dirname(file); ; folder = posix.dirname(folder)) {
      const found = this.byFolder.get(folder);
      if (found) return found.file;
      if (folder === posix.dirname(folder)) return null;
    }
  }

  /** The terms a page in this file's folder may use: every glossary from the root down, the nearest one winning a term. */
  forFile(file: string): ReadonlyMap<string, GlossaryEntry> {
    const folder = posix.dirname(file);
    const cached = this.scopes.get(folder);
    if (cached) return cached;
    const chain: string[] = [];
    for (let at = folder; ; at = posix.dirname(at)) {
      chain.unshift(at);
      if (at === posix.dirname(at)) break;
    }
    // Nearest first: a term already taken by a nearer glossary is skipped, and past the cap the farthest go.
    const scope = new Map<string, GlossaryEntry>();
    for (const at of chain.reverse()) {
      for (const [term, entry] of this.byFolder.get(at)?.entries ?? []) {
        if (scope.size >= MAX_GLOSSARY_TERMS) break;
        if (!scope.has(term)) scope.set(term, entry);
      }
    }
    this.scopes.set(folder, scope);
    return scope;
  }

  /**
   * The rule that links a page's terms, or null. A glossary page links none of
   * its own: its headings are the terms, and an entry pointing at itself helps nobody.
   */
  pillRuleFor(file: string): { rule: CompiledRule; terms: readonly string[] } | null {
    return posix.basename(file) === GLOSSARY_FILE ? null : this.ruleFor(file);
  }

  /** The glossary rule for a page, or null when no glossary covers it. */
  ruleFor(file: string): { rule: CompiledRule; terms: readonly string[] } | null {
    const scope = this.forFile(file);
    if (scope.size === 0) return null;
    const terms = [...scope.keys()].sort();
    return { rule: { name: GLOSSARY_RULE, regex: glossaryRegex(terms) }, terms };
  }
}

/**
 * A whole word of capitals and digits, with an optional plural s: SDK, HTTP2, PRs.
 * One pass with no nested choice, so a long run of capitals stays linear; the
 * "two or more capitals" rule is checked on the match.
 */
const CAPS_WORD = /(?<![\p{L}\p{N}_])[A-Z][A-Z0-9]*s?(?![\p{L}\p{N}_])/gu;
const TWO_CAPITALS = /[A-Z][^A-Z]*[A-Z]/;

/**
 * The acronyms a page writes in plain text that its glossaries do not list,
 * in first-use order. Text a reference pill already covers (ADR-12) is
 * skipped, and so is code, link text and diagrams, as for pills.
 */
export function unlistedAcronyms(body: string, rules: readonly CompiledRule[]): string[] {
  const found = new Set<string>();
  forEachReferenceText(lexMarkdown(body), (text) => {
    for (const piece of splitReferences(text, rules)) {
      if (typeof piece !== 'string') continue;
      for (const match of piece.matchAll(CAPS_WORD)) {
        const word = match[0].endsWith('s') ? match[0].slice(0, -1) : match[0];
        if (TWO_CAPITALS.test(word)) found.add(word);
      }
    }
  });
  return [...found];
}

/** The warning for a page's unlisted acronyms, naming the glossary that should list them. */
export function unlistedMessage(acronyms: readonly string[], glossaryFile: string): string {
  const named = acronyms.slice(0, UNLISTED_NAMED).join(', ');
  const more = acronyms.length > UNLISTED_NAMED ? ` and ${acronyms.length - UNLISTED_NAMED} more` : '';
  return `uses ${named}${more}, which no glossary covering this page lists; add ${acronyms.length === 1 ? 'it' : 'them'} to ${glossaryFile}, or write ${acronyms.length === 1 ? 'it' : 'them'} in backticks if ${acronyms.length === 1 ? 'it is' : 'they are'} code`;
}
