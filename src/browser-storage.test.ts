import { afterEach, expect, it, vi } from 'vitest';
import { stored, store } from './browser-storage';

afterEach(() => vi.unstubAllGlobals());

it('reads a failed write from transient storage until a successful write clears it', () => {
  let saved = 'old';
  let fail = true;
  vi.stubGlobal('window', { localStorage: {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      if (fail) throw new Error('quota exceeded');
      saved = value;
    },
  } });

  store('localStorage', 'failed-write-test', 'new');
  expect(stored('localStorage', 'failed-write-test')).toBe('new');

  fail = false;
  store('localStorage', 'failed-write-test', 'saved');
  expect(stored('localStorage', 'failed-write-test')).toBe('saved');
  saved = 'later';
  expect(stored('localStorage', 'failed-write-test')).toBe('later');
});

it('returns null when neither storage layer has a value', () => {
  vi.stubGlobal('window', { sessionStorage: { getItem: () => null } });
  expect(stored('sessionStorage', 'missing-value-test')).toBeNull();
});
