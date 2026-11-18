// The extension's settings, kept in this browser only (storage.local, never
// synced): whether docs folders open in the reader on their own, and an
// optional GitHub token for repositories the github.com session does not reach.

import type { ExtensionApi } from './extension-api';

export interface Settings {
  readonly autoOpen: boolean;
  readonly token: string | null;
}

const KEYS = ['autoOpen', 'token'] as const;

export async function readSettings(api: ExtensionApi): Promise<Settings> {
  try {
    const stored = await api.storage.local.get(KEYS);
    const token = typeof stored.token === 'string' && stored.token.trim() ? stored.token.trim() : null;
    return { autoOpen: stored.autoOpen === true, token };
  } catch {
    return { autoOpen: false, token: null };
  }
}

export async function saveSettings(api: ExtensionApi, settings: Settings): Promise<void> {
  await api.storage.local.set({ autoOpen: settings.autoOpen });
  if (settings.token) await api.storage.local.set({ token: settings.token });
  else await api.storage.local.remove(['token']);
}
