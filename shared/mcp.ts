import type { CatalogResponse, DocumentResponse } from './api.js';

/** A complete validated, transient bundle. Revision is monotonic within scope. */
export interface BundleSnapshot {
  readonly files: readonly { readonly path: string; readonly markdown: string }[];
  readonly scope: string;
  readonly revision: number;
  readonly catalog: CatalogResponse;
  readonly documents: readonly DocumentResponse[];
}
