// TLC config rules. Only INVARIANT and PROPERTY names are rules. Removing one
// name leaves the rest of the config, including constants, in place.

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

/** A new config with one rule name removed from INVARIANT or PROPERTY lists. */
export function withoutRule(config: string, name: string): string {
  let mode: Mode = null;
  let removed = false;
  const lines = config.split(/\r?\n/).map((raw) => {
    const commentAt = raw.search(/\\\*/);
    const code = commentAt === -1 ? raw : raw.slice(0, commentAt);
    const comment = commentAt === -1 ? '' : raw.slice(commentAt);
    const trimmed = code.trim();
    if (trimmed === '') return raw;
    const parts = trimmed.split(/\s+/);
    let index = 0;
    const first = parts[0] ?? '';
    if (KEYWORDS.has(first)) {
      mode = modeOf(first);
      index = 1;
    }
    if (!mode || removed) return raw;
    const kept: string[] = parts.slice(0, index);
    for (const part of parts.slice(index)) {
      if (KEYWORDS.has(part)) {
        mode = modeOf(part);
        kept.push(part);
        continue;
      }
      if (!removed && part === name && IDENTIFIER.test(part)) {
        removed = true;
        continue;
      }
      kept.push(part);
    }
    if (kept.length === 0) return comment ? comment.trim() : '';
    if (kept.length === 1 && KEYWORDS.has(kept[0] ?? '') && modeOf(kept[0] ?? '') !== null && index === 1 && parts.length > 1) {
      return comment ? `${kept[0]} ${comment.trim()}` : '';
    }
    const leading = code.match(/^\s*/)?.[0] ?? '';
    return `${leading}${kept.join(' ')}${comment ? ` ${comment.trim()}` : ''}`.trimEnd();
  });
  return lines.filter((line, index) => line !== '' || index === lines.length - 1).join('\n');
}
