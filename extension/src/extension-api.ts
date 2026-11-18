// The one WebExtension API both browsers share. Firefox names it `browser` and
// Chrome `chrome`; in Manifest V3 both return promises for the calls used here.

export interface ExtensionApi {
  readonly runtime: { getURL(path: string): string; openOptionsPage(): Promise<void> };
  readonly storage: {
    readonly local: {
      get(keys: readonly string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: readonly string[]): Promise<void>;
    };
  };
}

export function extensionApi(): ExtensionApi {
  const scope = globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi };
  const api = scope.browser ?? scope.chrome;
  if (!api?.runtime) throw new Error('Nessa Docs must run as a browser extension.');
  return api;
}
