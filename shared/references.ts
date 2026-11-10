// Finds reference pills in text. The project config (server/project-config.ts)
// owns which patterns exist; this file owns how text is split, so the server
// (which resolves every match) and the browser (which draws the pills) cut the
// same text at the same places. Both call `splitReferences` on the same marked
// text tokens, so a key the browser builds is always a key the server resolved.

/** One pattern as it travels to the browser: its name and its regular expression source. */
export interface ReferenceRule {
  readonly name: string;
  readonly match: string;
}

/** The longest pattern accepted, in UTF-16 code units. */
export const MAX_PATTERN_LENGTH = 256;
/** At most this many patterns per project. */
export const MAX_REFERENCE_RULES = 32;

export interface CompiledRule {
  readonly name: string;
  readonly regex: RegExp;
}

export type RuleCompilation =
  | { readonly kind: 'ok'; readonly rule: CompiledRule }
  | { readonly kind: 'invalid'; readonly reason: string };

// A quantified group that itself holds a quantifier, such as (a+)+ or (\w*)*,
// can take exponential time on a near miss. Those are refused rather than run.
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,\d*\})/;

/** Compiles one pattern, or says why it cannot be used. */
export function compileRule(rule: ReferenceRule): RuleCompilation {
  if (rule.match.length === 0) return { kind: 'invalid', reason: 'the pattern is empty' };
  if (rule.match.length > MAX_PATTERN_LENGTH) return { kind: 'invalid', reason: `the pattern is longer than ${MAX_PATTERN_LENGTH} characters` };
  if (/\\[1-9]|\\k</.test(rule.match)) return { kind: 'invalid', reason: 'back-references are not supported' };
  if (NESTED_QUANTIFIER.test(rule.match)) return { kind: 'invalid', reason: 'a repeated group that itself repeats can be very slow; simplify the pattern' };
  let regex: RegExp;
  try {
    regex = new RegExp(rule.match, 'gu');
  } catch (error) {
    return { kind: 'invalid', reason: `not a valid regular expression: ${(error as Error).message}` };
  }
  if (regex.test('')) return { kind: 'invalid', reason: 'the pattern matches empty text' };
  regex.lastIndex = 0;
  return { kind: 'ok', rule: { name: rule.name, regex } };
}

/** Compiles every usable pattern; ones that do not compile are left out (the server reports them in Health). */
export function compileRules(rules: readonly ReferenceRule[]): readonly CompiledRule[] {
  return rules.flatMap((rule) => {
    const outcome = compileRule(rule);
    return outcome.kind === 'ok' ? [outcome.rule] : [];
  });
}

export interface ReferenceMatch {
  readonly start: number;
  readonly end: number;
  /** The rule's name. */
  readonly rule: string;
  /** The matched text exactly as written. */
  readonly text: string;
  /** Named groups that matched. */
  readonly groups: Readonly<Record<string, string>>;
}

export type TextPiece = string | ReferenceMatch;

/** The key a resolved reference is stored under: the rule and the exact text. */
export function referenceKey(rule: string, text: string): string {
  return `${rule}\u0000${text}`;
}

const WORD = /[\p{L}\p{N}_]/u;

/**
 * Every match in `text`, in order and without overlaps. Earlier rules win a tie
 * at the same start; a longer match never splits a word, so `XADR-1` and
 * `ADR-12a` are not references. One pass per rule over the text.
 */
export function findReferences(text: string, rules: readonly CompiledRule[]): ReferenceMatch[] {
  if (rules.length === 0 || text.length === 0) return [];
  const found: ReferenceMatch[] = [];
  for (const { name, regex } of rules) {
    regex.lastIndex = 0;
    for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
      const start = match.index;
      const end = start + match[0].length;
      if (end === start) {
        regex.lastIndex = start + 1;
        continue;
      }
      const before = start > 0 ? text[start - 1] : '';
      const after = end < text.length ? text[end] : '';
      const first = match[0][0] ?? '';
      const last = match[0][match[0].length - 1] ?? '';
      // Only a match that starts or ends on a word character can split a word.
      if ((before && WORD.test(before) && WORD.test(first)) || (after && WORD.test(after) && WORD.test(last))) {
        regex.lastIndex = start + 1;
        continue;
      }
      const groups: Record<string, string> = {};
      if (match.groups) for (const [key, value] of Object.entries(match.groups)) if (value !== undefined) groups[key] = value;
      found.push({ start, end, rule: name, text: match[0], groups });
    }
  }
  if (rules.length === 1) return found;
  // Sort by start; at the same start keep rule order (the sort is stable), then drop overlaps.
  found.sort((a, b) => a.start - b.start);
  const kept: ReferenceMatch[] = [];
  let reached = 0;
  for (const match of found) {
    if (match.start < reached) continue;
    kept.push(match);
    reached = match.end;
  }
  return kept;
}

/** `text` cut into plain strings and matches, in order. */
export function splitReferences(text: string, rules: readonly CompiledRule[]): TextPiece[] {
  const matches = findReferences(text, rules);
  if (matches.length === 0) return [text];
  const pieces: TextPiece[] = [];
  let at = 0;
  for (const match of matches) {
    if (match.start > at) pieces.push(text.slice(at, match.start));
    pieces.push(match);
    at = match.end;
  }
  if (at < text.length) pieces.push(text.slice(at));
  return pieces;
}

/**
 * Fills `{name}` and `{name:04}` (zero-padded to 4 digits) from the match's
 * groups; `{0}` is the whole match. Returns null when a named group is missing.
 * `encode` is applied to each value (a URL template encodes, a path refuses).
 */
export function fillTemplate(
  template: string,
  match: Pick<ReferenceMatch, 'text' | 'groups'>,
  encode: (value: string) => string | null = (value) => value,
): string | null {
  let failed = false;
  const filled = template.replace(/\{([A-Za-z_][A-Za-z0-9_]*|0)(?::(0\d+))?\}/g, (_whole, name: string, pad: string | undefined) => {
    const raw = name === '0' ? match.text : match.groups[name];
    if (raw === undefined) {
      failed = true;
      return '';
    }
    const width = pad ? Number.parseInt(pad, 10) : 0;
    const value = width > 0 && /^\d+$/.test(raw) ? raw.padStart(width, '0') : raw;
    const encoded = encode(value);
    if (encoded === null) {
      failed = true;
      return '';
    }
    return encoded;
  });
  return failed ? null : filled;
}
