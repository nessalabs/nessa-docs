# Privacy policy

Effective 22 November 2026. This policy covers the Nessa Docs for GitHub
browser extension (Chrome and Firefox). It also applies to the Nessa Docs
Claude plugin and the local reader, which collect nothing at all.

## Short version

Nessa Docs for GitHub collects no personal data. It has no server of its own,
no analytics, no tracking and no advertising. It reads documentation files from
GitHub and keeps everything it saves in your own browser.

## What the extension reads

On github.com repository pages, the extension checks whether the repository has
a `docs/state` folder. When you open the reader, it reads the file list and the
Markdown files in that folder, at one commit, from:

- **github.com**, using the session you are already signed in with, so private
  repositories you can already see also work;
- **raw.githubusercontent.com**, for the text of files in public repositories;
- **api.github.com**, as a fallback, with your GitHub token if you saved one.

It reads only files under `docs/state` (and any notes folders that the
repository's own `docs/state/nessa-docs.yaml` lists). It does not read other
pages you visit, and it never writes to GitHub.

## What the extension stores

Everything stays in your browser, on your device:

| What | Where | Why |
| --- | --- | --- |
| Whether docs open in the reader automatically | `storage.local` | Your setting from the options page |
| Your GitHub token, only if you enter one | `storage.local` | To read repositories your github.com session cannot reach |
| The docs files and file lists already read, by commit | The extension's IndexedDB | So opening the same docs again needs no network; entries unused for 30 days are dropped |
| Whether you last chose the GitHub or Docs view for a repository | The tab's `sessionStorage` | Cleared when you close the tab |

None of this is synced to other devices or sent to Nessa Labs. The token is
sent only to GitHub (api.github.com), as authorization for reading files.

## What the extension shares

Nothing. The only network requests it makes are the GitHub reads above. Nessa
Labs does not receive, sell or share any data about you or your repositories.

## How to remove your data

Clear the token on the extension's options page, or remove the extension. Removing it
deletes its settings, token and cache from your browser.

## The Claude plugin and the local reader

The Nessa Docs Claude plugin contains only instructions for Claude. It has
no server, sends nothing anywhere, and stores nothing. The local reader (`npm
start`) reads the project folder you open on your own computer and serves it
only to your own browser at 127.0.0.1.

## Changes and contact

Changes to this policy are made in this file, so its history on GitHub shows
every version. Questions or concerns:
[open an issue](https://github.com/nessalabs/nessa-docs/issues).
