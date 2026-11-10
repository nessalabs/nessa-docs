// Renders Markdown tokens as React elements. No HTML string is ever
// injected: raw HTML in a document is shown as text (except a bare <br>),
// and every href goes through the server's resolution table.

import { Fragment, type ReactNode } from 'react';
import type { Token, Tokens } from 'marked';
import type { LinkTarget, ReferenceRuleView, ResolvedReference } from '../shared/api';
import { AppLink, documentPath, navigate } from './router';
import { decodeEntities, diagramCard, headingSlugs, isMermaid, markdownDiagrams, plainText } from '../shared/markdown';
import { compileRules, type CompiledRule, referenceKey, splitReferences } from '../shared/references';

export interface Heading {
  readonly depth: number;
  readonly text: string;
  readonly slug: string;
}

/** The card a Mermaid fence names (`card=handoff title="..."`). */
export interface FenceCard {
  readonly card: string | null;
  readonly title: string | null;
}

/** Draws Mermaid block `index` (counted from 0 in the tokens given); the caller decides what a chart is there. */
export type DiagramRenderer = (index: number, source: string, card: FenceCard) => ReactNode;

/** The page's reference pills: how to split text, and what each piece resolved to (server/references.ts). */
export interface PageReferences {
  readonly rules: readonly ReferenceRuleView[];
  readonly resolved: Readonly<Record<string, ResolvedReference>>;
  /** A pill with a preview was chosen; the page shows the peek. */
  readonly onPeek?: (reference: ResolvedReference, from: HTMLElement) => void;
}

interface Context {
  readonly links: Readonly<Record<string, LinkTarget>>;
  readonly slugs: Map<Token, string>;
  readonly diagram: DiagramRenderer;
  diagramIndex: number;
  readonly rules: readonly CompiledRule[];
  readonly references: PageReferences | null;
  /** Inside a link's text: no pills (a link is already a link). */
  readonly inLink: boolean;
}

// Compiled once per distinct rule list: the response object changes on every load, the rules rarely do.
const compiled = new Map<string, readonly CompiledRule[]>();
function rulesFor(rules: readonly ReferenceRuleView[] | undefined): readonly CompiledRule[] {
  if (!rules || rules.length === 0) return [];
  const key = JSON.stringify(rules);
  let found = compiled.get(key);
  if (!found) {
    found = compileRules(rules);
    if (compiled.size > 16) compiled.clear();
    compiled.set(key, found);
  }
  return found;
}

/** Headings in document order with their anchors; one slug per heading token. */
export function collectHeadings(tokens: readonly Token[]): { headings: Heading[]; slugs: Map<Token, string> } {
  // One anchor rule for both sides (shared/markdown.ts headingSlugs), so a server-made #fragment lands here.
  const slugs = headingSlugs(tokens);
  const headings: Heading[] = [];
  for (const [token, slug] of slugs) {
    const heading = token as Tokens.Heading;
    headings.push({ depth: heading.depth, text: plainText(heading.tokens), slug });
  }
  return { headings, slugs };
}

export interface DiagramEntry {
  readonly source: string;
  /** The heading the diagram sits under, if any: its caption and its section in the Details view. */
  readonly section: Heading | null;
  readonly card: string | null;
  readonly title: string | null;
}

/** Every Mermaid block in document order (shared/markdown.ts), with the section it belongs to. */
export function collectDiagrams(tokens: readonly Token[], slugs: Map<Token, string>): DiagramEntry[] {
  return markdownDiagrams(tokens).map(({ source, heading, card, title }) => {
    const slug = heading ? slugs.get(heading) : undefined;
    return { source, card, title, section: heading && slug ? { depth: heading.depth, text: plainText(heading.tokens), slug } : null };
  });
}

export function MarkdownBody(props: {
  tokens: readonly Token[];
  slugs: Map<Token, string>;
  links: Readonly<Record<string, LinkTarget>>;
  diagram: DiagramRenderer;
  references?: PageReferences | null;
  className?: string;
}) {
  const references = props.references ?? null;
  const context: Context = {
    links: props.links, slugs: props.slugs, diagram: props.diagram, diagramIndex: 0,
    rules: rulesFor(references?.rules), references, inLink: false,
  };
  return <div className={props.className ?? 'prose'}>{blocks(props.tokens, context)}</div>;
}

function blocks(tokens: readonly Token[], context: Context): ReactNode[] {
  return tokens.map((token, index) => <Fragment key={index}>{block(token, context)}</Fragment>);
}

function block(token: Token, context: Context): ReactNode {
  switch (token.type) {
    case 'space':
    case 'def':
      return null;
    case 'heading': {
      const heading = token as Tokens.Heading;
      const Tag = `h${Math.min(6, Math.max(2, heading.depth + 1))}` as 'h2';
      const slug = context.slugs.get(token);
      return (
        <Tag id={slug} className={`md-h${heading.depth}`}>
          {inline(heading.tokens, context)}
          {slug ? (
            <a
              className="heading-anchor"
              href={`#${slug}`}
              aria-label={`Link to ${plainText(heading.tokens)}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`#${slug}`);
              }}
            >
              #
            </a>
          ) : null}
        </Tag>
      );
    }
    case 'paragraph':
      return <p>{inline((token as Tokens.Paragraph).tokens, context)}</p>;
    case 'text': {
      const text = token as Tokens.Text;
      return text.tokens && text.tokens.length > 0 ? inline(text.tokens, context) : plain(decodeEntities(text.text), context);
    }
    case 'code': {
      const code = token as Tokens.Code;
      if (isMermaid(token)) {
        return context.diagram(context.diagramIndex++, code.text, diagramCard(code));
      }
      return (
        <pre className="code-block" data-lang={code.lang || undefined}>
          <code>{code.text}</code>
        </pre>
      );
    }
    case 'blockquote':
      return <blockquote>{blocks((token as Tokens.Blockquote).tokens, context)}</blockquote>;
    case 'list': {
      const list = token as Tokens.List;
      const items = list.items.map((item, index) => (
        <li key={index} className={item.task ? 'task' : undefined}>
          {item.task ? <input type="checkbox" checked={Boolean(item.checked)} readOnly disabled aria-label={item.checked ? 'done' : 'not done'} /> : null}
          {blocks(item.tokens.filter((child) => child.type !== 'checkbox'), context)}
        </li>
      ));
      return list.ordered ? <ol start={list.start === '' ? undefined : list.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case 'table': {
      const table = token as Tokens.Table;
      const align = (value: Tokens.TableCell['align']) => (value ? { textAlign: value } : undefined);
      return (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Table">
          <table>
            <thead>
              <tr>
                {table.header.map((cell, index) => (
                  <th key={index} style={align(cell.align)}>
                    {inline(cell.tokens, context)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} style={align(cell.align)}>
                      {inline(cell.tokens, context)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'hr':
      return <hr />;
    case 'html':
      return (
        <pre className="raw-html" title="Raw HTML is shown as text">
          <code>{(token as Tokens.HTML).text}</code>
        </pre>
      );
    default:
      return 'tokens' in token && Array.isArray(token.tokens) ? inline(token.tokens, context) : token.raw;
  }
}

function inline(tokens: readonly Token[] | undefined, context: Context): ReactNode[] {
  return (tokens ?? []).map((token, index) => <Fragment key={index}>{inlineToken(token, context)}</Fragment>);
}

function inlineToken(token: Token, context: Context): ReactNode {
  switch (token.type) {
    case 'text': {
      const text = token as Tokens.Text;
      return text.tokens && text.tokens.length > 0 ? inline(text.tokens, context) : plain(decodeEntities(text.text), context);
    }
    case 'escape':
      return token.raw.slice(1);
    case 'strong':
      return <strong>{inline((token as Tokens.Strong).tokens, context)}</strong>;
    case 'em':
      return <em>{inline((token as Tokens.Em).tokens, context)}</em>;
    case 'del':
      return <del>{inline((token as Tokens.Del).tokens, context)}</del>;
    case 'codespan':
      return <code>{(token as Tokens.Codespan).text}</code>;
    case 'br':
      return <br />;
    case 'html':
      return /^<br\s*\/?>$/i.test(token.raw.trim()) ? <br /> : <span className="raw-html-inline">{token.raw}</span>;
    case 'link': {
      const link = token as Tokens.Link;
      return (
        <ResolvedLink href={link.href} links={context.links}>
          {inline(link.tokens, context.inLink ? context : { ...context, inLink: true })}
        </ResolvedLink>
      );
    }
    case 'image': {
      const image = token as Tokens.Image;
      return (
        <ResolvedLink href={image.href} links={context.links} image>
          {image.text || 'image'}
        </ResolvedLink>
      );
    }
    default:
      return 'tokens' in token && Array.isArray(token.tokens) ? inline(token.tokens, context) : token.raw;
  }
}

/**
 * A run of text, with its references drawn as pills. The split is
 * shared/references.ts splitReferences, the same one the server resolved
 * (shared/markdown.ts forEachReferenceText visits exactly these runs).
 */
function plain(text: string, context: Context): ReactNode {
  if (context.rules.length === 0 || context.inLink || context.references === null) return text;
  const pieces = splitReferences(text, context.rules);
  if (pieces.length === 1 && typeof pieces[0] === 'string') return text;
  const resolved = context.references.resolved;
  return pieces.map((piece, index) => {
    if (typeof piece === 'string') return piece;
    const key = referenceKey(piece.rule, piece.text);
    const reference = Object.hasOwn(resolved, key) ? (resolved[key] as ResolvedReference) : null;
    return <ReferencePill key={index} text={piece.text} reference={reference} onPeek={context.references?.onPeek} />;
  });
}

export function ReferencePill({
  text,
  reference,
  onPeek,
}: {
  text: string;
  reference: ResolvedReference | null;
  onPeek?: (reference: ResolvedReference, from: HTMLElement) => void;
}) {
  if (reference === null) {
    return (
      <span className="ref-pill" data-ref-state="unresolved" title="The server did not resolve this reference">
        {text}
      </span>
    );
  }
  const { target, preview, label, rule } = reference;
  if (target.kind === 'unresolved') {
    return (
      <span className="ref-pill" data-ref-rule={rule} data-ref-state="unresolved" title={`Unresolved ${rule} reference: ${target.reason}`}>
        {label}
      </span>
    );
  }
  if (preview && onPeek) {
    return (
      <button
        type="button"
        className="ref-pill"
        data-ref-rule={rule}
        data-ref-state="preview"
        aria-haspopup="dialog"
        title={`${preview.title} (${preview.file})`}
        onClick={(event) => onPeek(reference, event.currentTarget)}
        data-action="peek-reference"
      >
        {label}
      </button>
    );
  }
  if (target.kind === 'document') {
    return (
      <AppLink to={documentPath(target.id, target.fragment)} className="ref-pill" data-ref-rule={rule} data-ref-state="link">
        {label}
      </AppLink>
    );
  }
  if (target.kind === 'external') {
    return (
      <a href={target.url} target="_blank" rel="noopener noreferrer" className="ref-pill" data-ref-rule={rule} data-ref-state="link" title={target.url}>
        {label}
        <span className="visually-hidden"> (opens in a new tab)</span>
      </a>
    );
  }
  const where = target.kind === 'repo-file' || target.kind === 'outside-repo' ? target.path : '';
  return (
    <span className="ref-pill" data-ref-rule={rule} data-ref-state="evidence" title={where}>
      {label}
    </span>
  );
}

export function ResolvedLink({
  href,
  links,
  image,
  children,
}: {
  href: string;
  links: Readonly<Record<string, LinkTarget>>;
  image?: boolean;
  children: ReactNode;
}) {
  const target: LinkTarget = Object.hasOwn(links, href)
    ? (links[href] as LinkTarget)
    : { kind: 'unresolved', reason: 'the server did not resolve this link' };
  return <TargetLink target={target} image={image}>{children}</TargetLink>;
}

export function TargetLink({ target, image, children }: { target: LinkTarget; image?: boolean; children: ReactNode }) {
  const label = image ? <span className="evidence-image">Image: {children}</span> : children;
  switch (target.kind) {
    case 'document':
      return <AppLink to={documentPath(target.id, target.fragment)} className="doc-link">{label}</AppLink>;
    case 'anchor':
      return (
        <a
          href={`#${encodeURIComponent(target.fragment)}`}
          onClick={(event) => {
            event.preventDefault();
            navigate(`#${encodeURIComponent(target.fragment)}`);
          }}
        >
          {label}
        </a>
      );
    case 'external':
      return (
        <a href={target.url} target="_blank" rel="noopener noreferrer" className="external-link">
          {label}
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      );
    case 'repo-file': {
      const location = `${target.path}${target.fragment ? `#${target.fragment}` : ''}`;
      return (
        <span
          className={`evidence ${target.exists ? 'evidence-present' : 'evidence-missing'}`}
          title={`${target.exists ? 'Repository evidence' : 'Missing from repository'}: ${location}`}
          data-evidence="repo-file"
        >
          {label}
          <code className="evidence-path">{location}</code>
          {target.exists ? null : <span className="evidence-flag">missing</span>}
        </span>
      );
    }
    case 'outside-repo':
      return (
        <span className="evidence evidence-outside" title={`Outside-repo reference: ${target.path}`} data-evidence="outside-repo">
          {label}
          <code className="evidence-path">{target.path}</code>
          <span className="evidence-flag">outside repo</span>
        </span>
      );
    case 'unresolved':
      return (
        <span className="evidence evidence-unresolved" title={`Unresolved link: ${target.reason}`} data-evidence="unresolved">
          {label}
          <span className="evidence-flag">unresolved</span>
        </span>
      );
  }
}
