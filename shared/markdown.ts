// How a document body is structured: its Mermaid blocks in order and its
// sections. The server validates `diagramDetails` against this and the browser
// renders from it, so "diagram 0" and "the section under this heading" mean
// the same thing on both sides. One lexer configuration (marked, GFM).

import { Lexer, type Token, type Tokens } from 'marked';
import { textCache } from './memo.js';

// Lexing is the costliest step of reading a page, and the same body is lexed by
// the catalog, the link resolver and the reader. Tokens are treated as
// read-only everywhere, so one lexing per distinct body is shared.
const lexed = textCache<Token[]>(32 * 1024 * 1024);

/** The body's tokens. The array is shared: never mutate it or its tokens. */
export function lexMarkdown(body: string): Token[] {
  return lexed.get(body) ?? lexed.set(body, new Lexer({ gfm: true }).lex(body));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const key = name.toLowerCase();
    return Object.hasOwn(ENTITIES, key) ? (ENTITIES[key] as string) : whole;
  });
}

/** The words of inline tokens, without formatting: a heading's text as a reader sees it. */
export function plainText(tokens: readonly Token[] | undefined): string {
  if (!tokens) return '';
  return tokens
    .map((token) => {
      if ('tokens' in token && Array.isArray(token.tokens) && token.tokens.length > 0) return plainText(token.tokens);
      if (token.type === 'escape') return token.raw.slice(1);
      return 'text' in token && typeof token.text === 'string' ? decodeEntities(token.text) : '';
    })
    .join('');
}

export interface FenceInfo {
  /** The first word of the fence's info string, lowercased: `mermaid`. */
  readonly language: string;
  /** `key=value` and `key="quoted value"` words after it. Later keys win. */
  readonly attributes: Readonly<Record<string, string>>;
}

const FENCE_ATTRIBUTE = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))/g;

/** Reads a fence's info string, such as `mermaid card=handoff title="Pair a phone"`. */
export function fenceInfo(lang: string | undefined): FenceInfo {
  const info = (lang ?? '').trim();
  const space = info.search(/\s/);
  const language = (space === -1 ? info : info.slice(0, space)).toLowerCase();
  const attributes: Record<string, string> = {};
  if (space !== -1) {
    for (const match of info.slice(space).matchAll(FENCE_ATTRIBUTE)) {
      const key = match[1] as string;
      attributes[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
  }
  return { language, attributes };
}

export interface MarkdownDiagram {
  readonly source: string;
  /** The nearest heading above the block, if any. */
  readonly heading: Tokens.Heading | null;
  /** The card named on the fence (`card=handoff`), if any. */
  readonly card: string | null;
  /** The title named on the fence (`title="..."`), if any. */
  readonly title: string | null;
}

/** Whether a fenced block is a Mermaid diagram: its info string starts with the word `mermaid`. */
export function isMermaid(token: Token): token is Tokens.Code {
  return token.type === 'code' && fenceInfo((token as Tokens.Code).lang).language === 'mermaid';
}

/** The card and title a Mermaid fence names. */
export function diagramCard(token: Tokens.Code): { readonly card: string | null; readonly title: string | null } {
  const { attributes } = fenceInfo(token.lang);
  return { card: attributes.card?.trim() || null, title: attributes.title?.trim() || null };
}

/** Every Mermaid block in document order (inside block quotes and list items too): diagram N is the Nth. */
export function markdownDiagrams(tokens: readonly Token[]): MarkdownDiagram[] {
  const diagrams: MarkdownDiagram[] = [];
  let heading: Tokens.Heading | null = null;
  const visit = (list: readonly Token[]) => {
    for (const token of list) {
      if (token.type === 'heading') heading = token as Tokens.Heading;
      else if (isMermaid(token)) diagrams.push({ source: token.text, heading, ...diagramCard(token) });
      else if (token.type === 'blockquote') visit((token as Tokens.Blockquote).tokens);
      else if (token.type === 'list') for (const item of (token as Tokens.List).items) visit(item.tokens);
    }
  };
  visit(tokens);
  return diagrams;
}

export interface MarkdownSection {
  readonly heading: Tokens.Heading;
  /** The heading's text (plainText), which `diagramDetails` names exactly. */
  readonly title: string;
  /** Its blocks: tokens[start] is the heading; the section ends before tokens[end]. */
  readonly start: number;
  readonly end: number;
}

/**
 * The body's sections: each top-level heading with its nested headings, up to
 * the next heading of the same or a higher level (or the end). Headings inside
 * block quotes or lists do not start a section.
 */
export function markdownSections(tokens: readonly Token[]): MarkdownSection[] {
  const starts = tokens.flatMap((token, index) => (token.type === 'heading' ? [index] : []));
  return starts.map((start) => {
    const heading = tokens[start] as Tokens.Heading;
    const next = starts.find((index) => index > start && (tokens[index] as Tokens.Heading).depth <= heading.depth);
    return { heading, title: plainText(heading.tokens), start, end: next ?? tokens.length };
  });
}

/** The longest Mermaid block the site draws (UTF-16 code units of the block as written). */
export const MERMAID_MAX_TEXT_SIZE = 100_000;

/**
 * Whether a Mermaid block is short enough to be drawn. The browser does not
 * draw a longer one (src/diagram.tsx) and the server binds no details to it
 * (server/diagram-details.ts); both ask here. Mermaid's own limit (maxTextSize,
 * set to the same number in the renderer) measures its cleaned text, which
 * cleaning only shortens (front matter, directives and comments removed, quotes
 * swapped in place), so a block that fits is never replaced by Mermaid's
 * "Maximum text size" chart. verification/details.mjs D17 draws a block of
 * exactly this length and refuses one a character longer.
 */
export function diagramFits(source: string): boolean {
  return source.length <= MERMAID_MAX_TEXT_SIZE;
}

/**
 * Calls `visit` with every piece of text a reference pill may be drawn in, in
 * document order: plain text runs as the browser renders them (entities
 * decoded). Code, raw HTML, escapes and link or image text are never visited,
 * so `ADR-1` in backticks or inside a link stays as written. The browser's
 * renderer (src/markdown.tsx) draws exactly these runs through splitReferences.
 */
export function forEachReferenceText(tokens: readonly Token[], visit: (text: string) => void): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'link':
      case 'image':
      case 'code':
      case 'codespan':
      case 'html':
      case 'escape':
      case 'space':
      case 'def':
      case 'hr':
      case 'br':
        continue;
      case 'text': {
        const text = token as Tokens.Text;
        if (text.tokens && text.tokens.length > 0) forEachReferenceText(text.tokens, visit);
        else visit(decodeEntities(text.text));
        continue;
      }
      case 'list':
        for (const item of (token as Tokens.List).items) forEachReferenceText(item.tokens, visit);
        continue;
      case 'table': {
        const table = token as Tokens.Table;
        for (const cell of table.header) forEachReferenceText(cell.tokens, visit);
        for (const row of table.rows) for (const cell of row) forEachReferenceText(cell.tokens, visit);
        continue;
      }
      default:
        if ('tokens' in token && Array.isArray(token.tokens)) forEachReferenceText(token.tokens, visit);
    }
  }
}

/** GitHub-style heading anchors, de-duplicated per document by the caller's `seen` map. */
export function slugify(text: string, seen: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-') || 'section';
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

/** Every heading's anchor, in the order the browser assigns them (top level and inside block quotes). */
export function headingSlugs(tokens: readonly Token[]): Map<Token, string> {
  const seen = new Map<string, number>();
  const slugs = new Map<Token, string>();
  const visit = (list: readonly Token[]) => {
    for (const token of list) {
      if (token.type === 'heading') slugs.set(token, slugify(plainText((token as Tokens.Heading).tokens), seen));
      else if (token.type === 'blockquote') visit((token as Tokens.Blockquote).tokens);
    }
  };
  visit(tokens);
  return slugs;
}
