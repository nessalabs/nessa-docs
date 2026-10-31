// Dark (the Nessa desktop default) or light. Stored per browser; applied as
// the `.dark` class the Nessa UI tokens key on.

import { useSyncExternalStore } from 'react';
import { stored, store } from './browser-storage';

export type Appearance = 'dark' | 'light';
const KEY = 'nessa-state-browser:appearance';
const listeners = new Set<() => void>();

export function readAppearance(): Appearance {
  return stored('localStorage', KEY) === 'light' ? 'light' : 'dark';
}

export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  root.classList.toggle('dark', appearance === 'dark');
  root.dataset.appearance = appearance;
  root.style.colorScheme = appearance;
}

export function setAppearance(appearance: Appearance) {
  store('localStorage', KEY, appearance);
  applyAppearance(appearance);
  listeners.forEach((listener) => listener());
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readAppearance,
  );
}
