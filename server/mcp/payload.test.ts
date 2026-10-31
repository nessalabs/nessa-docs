import { expect, it } from 'vitest';
import { DocumentBundle } from './bundle';
import { readSnapshot } from '../../shared/mcp-payload';
import { doc } from '../testing/documents';

it('rejects forged cross-bundle references and unsafe external hrefs at the renderer boundary', async () => {
  const snapshot = await new DocumentBundle().replace({ expectedRevision: 0, files: [{ path: 'docs/state/README.md', markdown: doc('system', null) }] });
  expect(readSnapshot(snapshot).files).toEqual(snapshot.files);
  const foreign = structuredClone(snapshot);
  Object.assign(foreign.documents[0]!.links, { bad: { kind: 'document', id: 'foreign', fragment: null } });
  expect(() => readSnapshot(foreign)).toThrow('outside this bundle');
  const unsafe = structuredClone(snapshot);
  Object.assign(unsafe.documents[0]!.links, { bad: { kind: 'external', url: 'javascript:alert(1)' } });
  expect(() => readSnapshot(unsafe)).toThrow();
  expect(() => readSnapshot({ ...snapshot, documents: [] })).toThrow();
});
