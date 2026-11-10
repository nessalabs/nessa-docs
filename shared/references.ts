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

interface GroupScan {
  repeats: boolean;
  alternates: boolean;
}

/** The quantifier at `at`, if any: its length and whether it can repeat more than once. */
function quantifierAt(source: string, at: number): { readonly length: number; readonly repeats: boolean } | null {
  const char = source[at];
  let length = 0;
  let repeats = false;
  if (char === '*' || char === '+') [length, repeats] = [1, true];
  else if (char === '?') length = 1;
  else if (char === '{') {
    const counted = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(at));
    if (!counted) return null;
    length = counted[0].length;
    const most = counted[2] === undefined ? Number(counted[1]) : counted[3] === '' ? Infinity : Number(counted[3]);
    repeats = most > 1;
  } else return null;
  if (source[at + length] === '?') length += 1;
  return { length, repeats };
}

/**
 * Why the pattern could take exponential time on a near miss, or null. A group
 * that repeats, such as (...)+ or (...){2,}, may hold neither a quantifier nor
 * a choice (|) at any depth: (a+)+, (?:(a+))+ and (a|a)* all backtrack
 * exponentially. A one-pass scan of the pattern's structure, so nesting cannot
 * hide a repetition the way it could from a flat regular expression.
 */
export function slowPatternReason(source: string): string | null {
  const stack: GroupScan[] = [{ repeats: false, alternates: false }];
  for (let at = 0; at < source.length; ) {
    const char = source[at]!;
    if (char === '\\') {
      // \p{..}, \P{..}, \u{..} carry braces that are not a quantifier.
      const braced = /^\\[pPu]\{[^}]*\}/.exec(source.slice(at));
      at += braced ? braced[0].length : 2;
    } else if (char === '[') {
      at += 1;
      while (at < source.length && source[at] !== ']') at += source[at] === '\\' ? 2 : 1;
      at += 1;
    } else if (char === '(') {
      stack.push({ repeats: false, alternates: false });
      at += 1;
      continue;
    } else if (char === ')') {
      const group = stack.length > 1 ? stack.pop()! : null;
      at += 1;
      const quantifier = quantifierAt(source, at);
      const parent = stack[stack.length - 1]!;
      if (group) {
        if (quantifier?.repeats && (group.repeats || group.alternates)) {
          return group.repeats
            ? 'a repeated group that itself repeats can be very slow; simplify the pattern'
            : 'a repeated group with a choice (|) inside can be very slow; simplify the pattern';
        }
        parent.repeats ||= group.repeats;
        parent.alternates ||= group.alternates;
      }
      if (quantifier) {
        parent.repeats = true;
        at += quantifier.length;
      }
      continue;
    } else if (char === '|') {
      stack[stack.length - 1]!.alternates = true;
      at += 1;
      continue;
    } else at += 1;
    // After an atom (a character, escape or class): its quantifier, if any.
    const quantifier = quantifierAt(source, at);
    if (quantifier) {
      stack[stack.length - 1]!.repeats = true;
      at += quantifier.length;
    }
  }
  return null;
}

/** Compiles one pattern, or says why it cannot be used. */
export function compileRule(rule: ReferenceRule): RuleCompilation {
  if (rule.match.length === 0) return { kind: 'invalid', reason: 'the pattern is empty' };
  if (rule.match.length > MAX_PATTERN_LENGTH) return { kind: 'invalid', reason: `the pattern is longer than ${MAX_PATTERN_LENGTH} characters` };
  if (/\\[1-9]|\\k</.test(rule.match)) return { kind: 'invalid', reason: 'back-references are not supported' };
  let regex: RegExp;
  try {
    regex = new RegExp(rule.match, 'gu');
  } catch (error) {
    return { kind: 'invalid', reason: `not a valid regular expression: ${(error as Error).message}` };
  }
  const slow = slowPatternReason(rule.match);
  if (slow) return { kind: 'invalid', reason: slow };
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

/** The index just past the code point at `at`, so a skip never lands inside a surrogate pair. */
function nextCodePoint(text: string, at: number): number {
  return at + ((text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1);
}

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
        regex.lastIndex = nextCodePoint(text, start);
        continue;
      }
      const before = start > 0 ? text[start - 1] : '';
      const after = end < text.length ? text[end] : '';
      const first = match[0][0] ?? '';
      const last = match[0][match[0].length - 1] ?? '';
      // Only a match that starts or ends on a word character can split a word.
      if ((before && WORD.test(before) && WORD.test(first)) || (after && WORD.test(after) && WORD.test(last))) {
        regex.lastIndex = nextCodePoint(text, start);
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
