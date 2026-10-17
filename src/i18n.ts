// UI copy only. Authored documents, paths and server facts never pass through this table.
import { useSyncExternalStore } from 'react';
import ar from './locales/ar.json';
export type Language = 'en' | 'ar';
const KEY = 'nessa-state-browser:language';
const listeners = new Set<() => void>();
export function readLanguage(): Language {
  try { const saved = window.localStorage.getItem(KEY); if (saved === 'ar' || saved === 'en') return saved; } catch { /* Storage can be disabled. */ }
  return window.navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}
let current: Language | undefined;
export function applyLanguage(language: Language) {
  current = language;
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
}
export function setLanguage(language: Language) {
  try { window.localStorage.setItem(KEY, language); } catch { /* Session choice still works. */ }
  applyLanguage(language);
  listeners.forEach(listener => listener());
}
export function useLanguage(): Language {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { applyLanguage(readLanguage()); listener(); } };
    window.addEventListener('storage', storage);
    return () => { listeners.delete(listener); window.removeEventListener('storage', storage); };
  }, () => current ?? readLanguage());
}
export function t(message: string, language: Language = current ?? readLanguage()): string {
  return language === 'ar' ? (ar as Record<string, string>)[message] ?? message : message;
}
