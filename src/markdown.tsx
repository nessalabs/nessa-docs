import { t } from './i18n';
// Renders Markdown tokens as React elements. No HTML string is ever
// injected: raw HTML in a document is shown as text (except a bare <br>),
// and every href goes through the server's resolution table.

import { Fragment, type ReactNode } from 'react';
import type { Token, Tokens } from 'marked';
import type { LinkTarget } from '../shared/api';
import { AppLink, documentPath, navigate } from './router';
import { decodeEntities, markdownDiagrams, plainText } from '../shared/markdown';
import { slugify } from './text';

export interface Heading {
  readonly depth: number;
  readonly text: string;
  readonly slug: string;
}

/** Draws Mermaid block `index` (counted from 0 in the tokens given); the caller decides what a chart is there. */
export type DiagramRenderer = (index: number, source: string) => ReactNode;

interface Context {
  readonly links: Readonly<Record<string, LinkTarget>>;
  readonly slugs: Map<Token, string>;
  readonly diagram: DiagramRenderer;
  diagramIndex: number;
}

/** Headings in document order with their anchors; one slug per heading token. */
export function collectHeadings(tokens: readonly Token[]): { headings: Heading[]; slugs: Map<Token, string> } {
  const seen = new Map<string, number>();
  const slugs = new Map<Token, string>();
  const headings: Heading[] = [];
  const visit = (list: readonly Token[]) => {
    for (const token of list) {
      if (token.type === 'heading') {
        const heading = token as Tokens.Heading;
        const text = plainText(heading.tokens);
        const slug = slugify(text, seen);
        slugs.set(token, slug);
        headings.push({ depth: heading.depth, text, slug });
      } else if (token.type === 'blockquote') {
        visit((token as Tokens.Blockquote).tokens);
      }
    }
  };
  visit(tokens);
  return { headings, slugs };
}

export interface DiagramEntry {
  readonly source: string;
  /** The heading the diagram sits under, if any: its caption and its section in the Details view. */
  readonly section: Heading | null;
}

/** Every Mermaid block in document order (shared/markdown.ts), with the section it belongs to. */
export function collectDiagrams(tokens: readonly Token[], slugs: Map<Token, string>): DiagramEntry[] {
  return markdownDiagrams(tokens).map(({ source, heading }) => {
    const slug = heading ? slugs.get(heading) : undefined;
    return { source, section: heading && slug ? { depth: heading.depth, text: plainText(heading.tokens), slug } : null };
  });
}

export function MarkdownBody(props: {
  tokens: readonly Token[];
  slugs: Map<Token, string>;
  links: Readonly<Record<string, LinkTarget>>;
  diagram: DiagramRenderer;
  className?: string;
}) {
  const context: Context = { links: props.links, slugs: props.slugs, diagram: props.diagram, diagramIndex: 0 };
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
        <Tag dir="auto" id={slug} className={`md-h${heading.depth}`}>
          {inline(heading.tokens, context)}
          {slug ? (
            <a
              className="heading-anchor"
              href={`#${slug}`}
              aria-label={`${t("Link to")} ${plainText(heading.tokens)}`}
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
      return <p dir="auto">{inline((token as Tokens.Paragraph).tokens, context)}</p>;
    case 'text': {
      const text = token as Tokens.Text;
      return text.tokens ? inline(text.tokens, context) : decodeEntities(text.text);
    }
    case 'code': {
      const code = token as Tokens.Code;
      if (code.lang?.trim().toLowerCase() === 'mermaid') {
        return context.diagram(context.diagramIndex++, code.text);
      }
      return (
        <pre dir="ltr" className="code-block" data-lang={code.lang || undefined}>
          <code dir="ltr">{code.text}</code>
        </pre>
      );
    }
    case 'blockquote':
      return <blockquote>{blocks((token as Tokens.Blockquote).tokens, context)}</blockquote>;
    case 'list': {
      const list = token as Tokens.List;
      const items = list.items.map((item, index) => (
        <li dir="auto" key={index} className={item.task ? 'task' : undefined}>
          {item.task ? <input type="checkbox" checked={Boolean(item.checked)} readOnly disabled aria-label={t(item.checked ? 'done' : 'not done')} /> : null}
          {blocks(item.tokens.filter((child) => child.type !== 'checkbox'), context)}
        </li>
      ));
      return list.ordered ? <ol start={list.start === '' ? undefined : list.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case 'table': {
      const table = token as Tokens.Table;
      const align = (value: Tokens.TableCell['align']) => (value ? { textAlign: value } : undefined);
      return (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t("Table")}>
          <table>
            <thead>
              <tr>
                {table.header.map((cell, index) => (
                  <th dir="auto" key={index} style={align(cell.align)}>
                    {inline(cell.tokens, context)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td dir="auto" key={index} style={align(cell.align)}>
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
        <pre dir="ltr" className="raw-html" title={t("Raw HTML is shown as text")}>
          <code dir="ltr">{(token as Tokens.HTML).text}</code>
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
      return text.tokens && text.tokens.length > 0 ? inline(text.tokens, context) : decodeEntities(text.text);
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
      return <code dir="ltr">{(token as Tokens.Codespan).text}</code>;
    case 'br':
      return <br />;
    case 'html':
      return /^<br\s*\/?>$/i.test(token.raw.trim()) ? <br /> : <span className="raw-html-inline">{token.raw}</span>;
    case 'link': {
      const link = token as Tokens.Link;
      return (
        <ResolvedLink href={link.href} links={context.links}>
          {inline(link.tokens, context)}
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
  const label = image ? <span className="evidence-image">{t("Image:")}{children}</span> : children;
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
          <span className="visually-hidden">{t("(opens in a new tab)")}</span>
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
          {target.exists ? null : <span className="evidence-flag">{t("missing")}</span>}
        </span>
      );
    }
    case 'outside-repo':
      return (
        <span className="evidence evidence-outside" title={`Outside-repo reference: ${target.path}`} data-evidence="outside-repo">
          {label}
          <code className="evidence-path">{target.path}</code>
          <span className="evidence-flag">{t("outside repo")}</span>
        </span>
      );
    case 'unresolved':
      return (
        <span className="evidence evidence-unresolved" title={`Unresolved link: ${target.reason}`} data-evidence="unresolved">
          {label}
          <span className="evidence-flag">{t("unresolved")}</span>
        </span>
      );
  }
}
