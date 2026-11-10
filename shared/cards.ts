// Which Mermaid charts a card style suits. The server warns when a page names
// a card that does not fit its chart; the browser then draws the plain card.
// Both ask here, so they agree.

import type { CardFamily, CardStyle } from './api.js';

/** Whether a Mermaid source belongs to a card family (by its first keyword). */
export function chartFamily(source: string): CardFamily | null {
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('%%') || trimmed === '---') continue;
    if (/^stateDiagram(-v2)?\b/.test(trimmed)) return 'state';
    if (/^sequenceDiagram\b/.test(trimmed)) return 'sequence';
    if (/^(flowchart|graph)\b/.test(trimmed)) return 'flowchart';
    if (/^[a-z]+:/i.test(trimmed)) continue; // front-matter keys such as title:
    return null;
  }
  return null;
}

export function cardFits(card: CardStyle, source: string): boolean {
  if (card.family === 'any') return true;
  return chartFamily(source) === card.family;
}


/** The card to draw for a fence: the named one when it exists and fits, the plain card when not, none when unnamed. */
export function cardFor(name: string | null, source: string, cards: Readonly<Record<string, CardStyle>>): CardStyle | null {
  if (name === null) return null;
  const card = Object.hasOwn(cards, name) ? cards[name] : undefined;
  if (card && cardFits(card, source)) return card;
  return Object.hasOwn(cards, 'plain') ? (cards.plain as CardStyle) : null;
}

/**
 * The Mermaid source a card draws. A handoff card numbers its steps
 * (Mermaid's `autonumber`) unless the author already chose; nothing else changes.
 */
export function drawnSource(card: CardStyle | null, source: string): string {
  if (card?.look !== 'handoff' || /^\s*autonumber\b/m.test(source)) return source;
  return source.replace(/^(\s*sequenceDiagram\b[^\n]*)$/m, '$1\n    autonumber');
}
