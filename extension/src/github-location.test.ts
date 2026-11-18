import { describe, expect, it } from 'vitest';
import { docsPageOf, githubUrl, pageUrl, type DocsRoot } from './github-location';

describe('docsPageOf', () => {
  it('finds the docs folder in a tree or blob address', () => {
    expect(docsPageOf('/nessalabs/nessa-agent/tree/main/docs/state')).toEqual({ owner: 'nessalabs', repo: 'nessa-agent', folderRest: 'main/docs/state', inside: '' });
    expect(docsPageOf('/o/r/blob/main/docs/state/services/chat.md')).toMatchObject({ folderRest: 'main/docs/state', inside: 'services/chat.md' });
    expect(docsPageOf('/o/r/tree/main/docs/state/')).toMatchObject({ inside: '' });
  });

  it('keeps branch names with slashes and folder prefixes in the folder part', () => {
    // Which segments are the branch is GitHub's answer, not the URL's.
    expect(docsPageOf('/o/r/tree/feature/x/packages/api/docs/state/a.md')).toMatchObject({ folderRest: 'feature/x/packages/api/docs/state', inside: 'a.md' });
  });

  it('decodes each segment once', () => {
    expect(docsPageOf('/o/r/blob/release%2F1/docs/state/a%20b.md')).toMatchObject({ folderRest: 'release/1/docs/state', inside: 'a b.md' });
  });

  it('ignores pages outside a docs folder and odd paths', () => {
    expect(docsPageOf('/o/r/tree/main/docs')).toBeNull();
    expect(docsPageOf('/o/r/tree/main/src/docs/statements')).toBeNull();
    expect(docsPageOf('/o/r/pulls')).toBeNull();
    expect(docsPageOf('/o/r/tree/docs/state')).toBeNull(); // a ref is needed before the folder
    expect(docsPageOf('/o/r/tree/main/../docs/state')).toBeNull();
    expect(docsPageOf('/o/r/tree/main/%E0%A4%A/docs/state')).toBeNull();
    expect(docsPageOf('/orgs/r/tree/main/docs/state')).toBeNull();
  });
});

describe('addresses back to GitHub', () => {
  const root: DocsRoot = { owner: 'o', repo: 'r', ref: 'feature/x', commit: 'a'.repeat(40), prefix: 'packages/api/' };

  it('names the root page by its folder and other pages by their file', () => {
    expect(pageUrl(root, 'docs/state/README.md')).toBe('https://github.com/o/r/tree/feature/x/packages/api/docs/state');
    expect(pageUrl(root, 'docs/state/services/a b.md')).toBe('https://github.com/o/r/blob/feature/x/packages/api/docs/state/services/a%20b.md');
  });

  it('carries a fragment', () => {
    expect(githubUrl(root, 'src/main.ts', 'blob', 'L10')).toBe('https://github.com/o/r/blob/feature/x/src/main.ts#L10');
  });
});
