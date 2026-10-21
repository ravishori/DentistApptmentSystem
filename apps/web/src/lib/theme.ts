/**
 * Theme model: seven themes + "system". Pure functions only, so the same logic is used by the
 * inline init script, the React hook and the unit tests.
 *
 * - The choice is persisted in localStorage (`dentalease-theme`); no choice stored = follow the OS.
 * - An explicit choice always wins over the OS preference.
 * - Dark-family themes also get `class="dark"` so Tailwind `dark:` variants and the legacy
 *   `.dark …` utility overrides keep working.
 */
export const THEME_STORAGE_KEY = 'dentalease-theme';

export const THEMES = [
  { id: 'light', label: 'Light', description: 'Clean and bright', dark: false },
  { id: 'dark', label: 'Dark', description: 'Low-glare slate', dark: true },
  { id: 'ocean', label: 'Ocean Blue', description: 'Cool, clinical blue', dark: false },
  { id: 'mint', label: 'Mint & Teal', description: 'Fresh, calming teal', dark: false },
  { id: 'lavender', label: 'Lavender', description: 'Soft violet', dark: false },
  { id: 'sand', label: 'Warm Sand', description: 'Warm neutral paper', dark: false },
  { id: 'contrast', label: 'High Contrast', description: 'Maximum legibility', dark: true },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
export type ThemeChoice = ThemeId | 'system';

export const THEME_IDS: readonly ThemeId[] = THEMES.map((t) => t.id);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

export function isDarkTheme(id: ThemeId): boolean {
  return THEMES.find((t) => t.id === id)?.dark ?? false;
}

/** Concrete theme to render for a stored choice (null/unknown/"system" -> OS preference). */
export function resolveTheme(stored: string | null | undefined, prefersDark: boolean): ThemeId {
  if (isThemeId(stored)) return stored;
  return prefersDark ? 'dark' : 'light';
}

export function toChoice(stored: string | null | undefined): ThemeChoice {
  return isThemeId(stored) ? stored : 'system';
}

/** Writes the theme onto <html>. */
export function applyTheme(id: ThemeId, root: { setAttribute(n: string, v: string): void; classList: { toggle(c: string, f: boolean): void } }): void {
  root.setAttribute('data-theme', id);
  root.classList.toggle('dark', isDarkTheme(id));
}

export function readStoredChoice(storage: Pick<Storage, 'getItem'> | undefined): ThemeChoice {
  try {
    return toChoice(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/** Persists the choice ("system" clears it). Never throws (storage can be blocked). */
export function storeChoice(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, choice: ThemeChoice): void {
  try {
    if (choice === 'system') storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* storage unavailable: the theme still applies for this page session */
  }
}

/**
 * Dependency-free script inlined in <head>; runs before first paint to avoid a theme flash.
 * Built from the same constants as the functions above (exercised by tests via `new Function`).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var ids=${JSON.stringify(THEMES.map((t) => t.id))};var dark=${JSON.stringify(
  THEMES.filter((t) => t.dark).map((t) => t.id),
)};var s=null;try{s=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}var t=ids.indexOf(s)>-1?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var r=document.documentElement;r.setAttribute('data-theme',t);r.classList.toggle('dark',dark.indexOf(t)>-1);}catch(e){}})();`;
