import type { CatalogResponse, DocumentResponse } from './api.js';

/** A complete validated bundle. Revision is monotonic within scope. */
export interface BundleSnapshot {
  readonly storage: { readonly kind: 'memory' } | { readonly kind: 'durable'; readonly status: 'synced' | 'unconfirmed'; readonly projectPath: string };
  readonly files: readonly { readonly path: string; readonly markdown: string }[];
  readonly scope: string;
  readonly revision: number;
  readonly catalog: CatalogResponse;
  readonly documents: readonly DocumentResponse[];
}
