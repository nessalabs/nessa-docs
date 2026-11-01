// Opaque sandbox origins may deny Web Storage. Presentation still works for
// that iframe's lifetime; standalone browsers retain their normal preferences.
const transient = new Map<string, string>();
export function stored(kind: 'localStorage' | 'sessionStorage', key: string): string | null {
  const pending = transient.get(`${kind}:${key}`);
  if (pending !== undefined) return pending;
  try { return window[kind].getItem(key); } catch { return null; }
}
export function store(kind: 'localStorage' | 'sessionStorage', key: string, value: string) {
  try { window[kind].setItem(key, value); transient.delete(`${kind}:${key}`); }
  catch { transient.set(`${kind}:${key}`, value); }
}
