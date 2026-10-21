'use client';
import { useEffect, useSyncExternalStore } from 'react';
import {
  DEFAULT_PREFS,
  THEME_STORAGE_KEY,
  PREFS_STORAGE_KEY,
  applyPrefs,
  applyTheme,
  readStoredChoice,
  readStoredPrefs,
  resolveTheme,
  storeChoice,
  storePrefs,
  type Prefs,
  type ThemeChoice,
  type ThemeId,
} from './theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

interface State { choice: ThemeChoice; theme: ThemeId; prefs: Prefs }

// One shared store: the header menu, the command palette and the Settings page all read and write the same state,
// so a change made anywhere updates every mounted component immediately.
const SERVER_STATE: State = { choice: 'system', theme: 'light', prefs: DEFAULT_PREFS };
let state: State = SERVER_STATE;
let initialised = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function compute(choice: ThemeChoice, prefs: Prefs): State {
  const theme = resolveTheme(choice === 'system' ? null : choice, window.matchMedia(DARK_QUERY).matches);
  return { choice, theme, prefs };
}

function commit(next: State) {
  state = next;
  applyTheme(next.theme, document.documentElement);
  applyPrefs(next.prefs, next.theme, document.documentElement);
  emit();
}

function refreshFromStorage() {
  commit(compute(readStoredChoice(window.localStorage), readStoredPrefs(window.localStorage)));
}

function ensureInit() {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;
  refreshFromStorage();
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener('change', refreshFromStorage); // only changes the result while following the system
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === THEME_STORAGE_KEY || e.key === PREFS_STORAGE_KEY) refreshFromStorage();
  });
}

const subscribe = (l: () => void) => {
  ensureInit();
  listeners.add(l);
  return () => void listeners.delete(l);
};
const getSnapshot = () => state;
const getServerSnapshot = () => SERVER_STATE;

function setChoice(choice: ThemeChoice) {
  storeChoice(window.localStorage, choice);
  commit(compute(choice, state.prefs));
}

function setPrefs(patch: Partial<Prefs>) {
  const prefs = { ...state.prefs, ...patch };
  storePrefs(window.localStorage, prefs);
  commit(compute(state.choice, prefs));
}

function resetAll() {
  storeChoice(window.localStorage, 'system');
  storePrefs(window.localStorage, DEFAULT_PREFS);
  commit(compute('system', DEFAULT_PREFS));
}

/** Framework-free handle on the shared store (also what the tests drive). */
export const appearanceStore = { subscribe, getSnapshot, setChoice, setPrefs, resetAll };

/** Theme choice (seven themes or "system"), the concrete theme in effect, and the personalisation preferences. */
export function useTheme() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Make sure the DOM matches after hydration even if the inline script did not run (e.g. blocked)
  useEffect(() => { ensureInit(); }, []);
  return { choice: s.choice, theme: s.theme, prefs: s.prefs, setChoice, setPrefs, resetAll };
}
