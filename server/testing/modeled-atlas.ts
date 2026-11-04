import { doc } from './documents';
import type { BundleFile } from '../mcp/bundle';

export function modeledAtlas(): BundleFile[] {
  const files: BundleFile[] = [{ path: 'docs/state/README.md', markdown: doc('root', null) }];
  for (let i = 1; i <= 13; i++) {
    files.push({ path: `docs/state/page${i}.md`, markdown: doc(`page${i}`, 'root', i <= 6 ? {
      kind: 'statechart', model: { spec: `tla/Model${i}.tla`, config: `tla/Model${i}.cfg` },
    } : {}) });
    if (i <= 6) files.push(
      { path: `docs/state/tla/Model${i}.tla`, text: `---- MODULE Model${i} ----\nVARIABLE phase\nInit == phase = "ready"\nNext == UNCHANGED phase\n====\n` },
      { path: `docs/state/tla/Model${i}.cfg`, text: 'INIT Init\nNEXT Next\n' },
    );
  }
  return files;
}
