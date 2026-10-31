// Opaque sandbox origins may deny Web Storage. Presentation still works for
// that iframe's lifetime; standalone browsers retain their normal preferences.
const transient = new Map<string, string>();
export function stored(kind: 'localStorage' | 'sessionStorage', key: string): string | null {
  try { return window[kind].getItem(key); } catch { return transient.get(`${kind}:${key}`) ?? null; }
}
export function store(kind: 'localStorage' | 'sessionStorage', key: string, value: string) {
  try { window[kind].setItem(key, value); } catch { transient.set(`${kind}:${key}`, value); }
}
