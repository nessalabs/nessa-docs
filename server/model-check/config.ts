// TLC config rules. Only INVARIANT and PROPERTY names are rules. Removing one
// name leaves the rest of the config, including constants, in place. A list
// header stays while any name remains on a later line, and is dropped only
// when that list has no names left.

const KEYWORDS = new Set([
  'CONSTANT', 'CONSTANTS', 'INIT', 'NEXT', 'SPECIFICATION', 'INVARIANT', 'INVARIANTS',
  'PROPERTY', 'PROPERTIES', 'CONSTRAINT', 'CONSTRAINTS', 'ACTION_CONSTRAINT', 'SYMMETRY',
  'VIEW', 'CHECK_DEADLOCK', 'POSTCONDITION', 'ALIAS',
]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Mode = 'invariant' | 'property' | null;

function modeOf(keyword: string): Mode {
  if (keyword === 'INVARIANT' || keyword === 'INVARIANTS') return 'invariant';
  if (keyword === 'PROPERTY' || keyword === 'PROPERTIES') return 'property';
  return null;
}

/** Rule names in source order. A name listed twice is returned twice. */
export function ruleNames(config: string): string[] {
  const names: string[] = [];
  let mode: Mode = null;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.replace(/\\\*.*$/, '').trim();
    if (line === '') continue;
    const parts = line.split(/\s+/);
    let index = 0;
    const first = parts[0] ?? '';
    if (KEYWORDS.has(first)) {
      mode = modeOf(first);
      index = 1;
    } else if (!mode) continue;
    for (const part of parts.slice(index)) {
      if (KEYWORDS.has(part)) {
        mode = modeOf(part);
        continue;
      }
      if (mode && IDENTIFIER.test(part)) names.push(part);
    }
  }
  return names;
}

interface ConfigLine {
  readonly raw: string;
  readonly leading: string;
  readonly comment: string;
  readonly tokens: readonly string[];
  readonly passthrough: boolean;
}

/** A new config with one rule name removed from INVARIANT or PROPERTY lists. */
export function withoutRule(config: string, name: string): string {
  const parsed: ConfigLine[] = [];
  let mode: Mode = null;
  let removed = false;
  let removedAt = -1;
  for (const raw of config.split(/\r?\n/)) {
    const parts = splitConfigLine(raw);
    if (parts.tokens.length === 0) {
      parsed.push({ ...parts, raw, passthrough: true });
      continue;
    }
    let index = 0;
    const first = parts.tokens[0] ?? '';
    if (KEYWORDS.has(first)) {
      mode = modeOf(first);
      index = 1;
    }
    if (!mode || removed) {
      parsed.push({ ...parts, raw, passthrough: true });
      continue;
    }
    const kept: string[] = parts.tokens.slice(0, index);
    for (const part of parts.tokens.slice(index)) {
      if (KEYWORDS.has(part)) {
        mode = modeOf(part);
        kept.push(part);
        continue;
      }
      if (!removed && part === name && IDENTIFIER.test(part)) {
        removed = true;
        removedAt = parsed.length;
        continue;
      }
      kept.push(part);
    }
    parsed.push({ ...parts, raw, tokens: kept, passthrough: false });
  }
  const header = removedAt >= 0 ? listHeader(parsed, removedAt) : -1;
  const dropHeader = header >= 0 && !listKeepsAName(parsed, header);
  const lines = parsed.map((line, index) => renderConfigLine(line, dropHeader && index === header));
  return lines.filter((line, index) => line !== '' || index === lines.length - 1).join('\n');
}

function splitConfigLine(raw: string): { leading: string; comment: string; tokens: string[] } {
  const commentAt = raw.search(/\\\*/);
  const code = commentAt === -1 ? raw : raw.slice(0, commentAt);
  const comment = commentAt === -1 ? '' : raw.slice(commentAt);
  const trimmed = code.trim();
  return {
    leading: code.match(/^\s*/)?.[0] ?? '',
    comment,
    tokens: trimmed === '' ? [] : trimmed.split(/\s+/),
  };
}

function listHeader(lines: readonly ConfigLine[], from: number): number {
  for (let index = from; index >= 0; index -= 1) {
    const first = lines[index]?.tokens[0] ?? '';
    if (first === '') continue;
    if (KEYWORDS.has(first)) return modeOf(first) !== null ? index : -1;
  }
  return -1;
}

function listKeepsAName(lines: readonly ConfigLine[], header: number): boolean {
  for (let index = header; index < lines.length; index += 1) {
    const tokens = lines[index]?.tokens ?? [];
    if (tokens.length === 0) continue;
    const first = tokens[0] ?? '';
    if (index > header && KEYWORDS.has(first)) return false;
    if (tokens.some((token) => !KEYWORDS.has(token) && IDENTIFIER.test(token))) return true;
  }
  return false;
}

function renderConfigLine(line: ConfigLine, dropKeyword: boolean): string {
  if (line.passthrough && !dropKeyword) return line.raw;
  const tokens = dropKeyword && modeOf(line.tokens[0] ?? '') !== null ? line.tokens.slice(1) : line.tokens;
  if (tokens.length === 0) return line.comment.trim();
  return `${line.leading}${tokens.join(' ')}${line.comment ? ` ${line.comment.trim()}` : ''}`.trimEnd();
}
