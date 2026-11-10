// A small least-recently-used cache keyed by text. Markdown is lexed and
// frontmatter parsed many times per request for the same unchanged file; the
// result depends only on the text, so the second time is a lookup. Bounded by
// the total length of the keys, so a large project cannot grow it without end.

export interface TextCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): V;
  delete(key: string): void;
}

export function textCache<V>(maxChars: number, maxEntries = 4096): TextCache<V> {
  const entries = new Map<string, V>();
  let chars = 0;
  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      // Refresh: the most recently used entry is last.
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    delete(key) {
      if (entries.delete(key)) chars -= key.length;
    },
    set(key, value) {
      if (key.length > maxChars) return value;
      if (entries.has(key)) entries.delete(key);
      else chars += key.length;
      entries.set(key, value);
      while (chars > maxChars || entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string;
        entries.delete(oldest);
        chars -= oldest.length;
      }
      return value;
    },
  };
}
