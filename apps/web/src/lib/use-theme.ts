'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  readStoredChoice,
  resolveTheme,
  storeChoice,
  type ThemeChoice,
  type ThemeId,
} from './theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Current theme choice + the concrete theme in effect. Syncs across tabs and OS changes. */
export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>('system');
  const [theme, setTheme] = useState<ThemeId>('light');

  const sync = useCallback(() => {
    const c = readStoredChoice(window.localStorage);
    const t = resolveTheme(c === 'system' ? null : c, window.matchMedia(DARK_QUERY).matches);
    setChoiceState(c);
    setTheme(t);
    applyTheme(t, document.documentElement);
  }, []);

  useEffect(() => {
    sync();
    const mq = window.matchMedia(DARK_QUERY);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === THEME_STORAGE_KEY) sync();
    };
    mq.addEventListener('change', sync); // only matters while following the system
    window.addEventListener('storage', onStorage);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener('storage', onStorage);
    };
  }, [sync]);

  const setChoice = useCallback((next: ThemeChoice) => {
    storeChoice(window.localStorage, next);
    const t = resolveTheme(next === 'system' ? null : next, window.matchMedia(DARK_QUERY).matches);
    setChoiceState(next);
    setTheme(t);
    applyTheme(t, document.documentElement);
  }, []);

  return { choice, theme, setChoice };
}
