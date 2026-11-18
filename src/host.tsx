// What the page around the reader can do. The local app (npm start) opens
// folders on this machine and runs the rule checker; the browser extension
// reads a repository on GitHub and does neither, but can open repository files
// where they live. Components ask here instead of guessing from the URL.

import { createContext, useContext, type ReactNode } from 'react';

export interface ReaderHost {
  /** Opening another folder and running the rule checker (both need the local server). */
  readonly localProject: boolean;
  /** Where a repository file opens, or null to show it as evidence only. */
  repoFileHref(path: string, fragment: string | null): string | null;
  /** Rows the host adds at the foot of the sidebar, above Settings. */
  readonly sidebarFooter?: ReactNode;
}

export const LOCAL_HOST: ReaderHost = { localProject: true, repoFileHref: () => null };

export const ReaderHostContext = createContext<ReaderHost>(LOCAL_HOST);

export function useReaderHost(): ReaderHost {
  return useContext(ReaderHostContext);
}
