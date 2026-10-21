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

// ── Personalisation: accent, text size, motion ───────────────────────────────
// Stored separately from the theme (`dentalease-prefs`, JSON) so the existing `dentalease-theme` value keeps its meaning.
export const PREFS_STORAGE_KEY = 'dentalease-prefs';

export const ACCENTS = [
  { id: 'default', label: 'Theme default', description: "The selected theme's own colour", swatch: '' },
  { id: 'blue', label: 'Clinical Blue', description: 'Calm, familiar blue', swatch: '221 83% 47%' },
  { id: 'teal', label: 'Dental Teal', description: 'Fresh teal', swatch: '173 80% 26%' },
  { id: 'sage', label: 'Sage Green', description: 'Soft, natural green', swatch: '150 36% 28%' },
  { id: 'violet', label: 'Professional Violet', description: 'Measured violet', swatch: '262 55% 45%' },
] as const;
export type AccentId = (typeof ACCENTS)[number]['id'];

export const TEXT_SIZES = [
  { id: 'default', label: 'Default', description: 'Standard text (16px base)' },
  { id: 'large', label: 'Larger', description: 'About 12% larger text' },
] as const;
export type TextSizeId = (typeof TEXT_SIZES)[number]['id'];

export const MOTION_MODES = [
  { id: 'system', label: 'Follow my device', description: 'Reduce motion only if your device asks for it' },
  { id: 'reduce', label: 'Always reduce', description: 'Turn off animations and transitions' },
] as const;
export type MotionId = (typeof MOTION_MODES)[number]['id'];

export interface Prefs { accent: AccentId; textSize: TextSizeId; motion: MotionId }
export const DEFAULT_PREFS: Prefs = { accent: 'default', textSize: 'default', motion: 'system' };

const oneOf = <T extends { id: string }>(list: readonly T[], v: unknown, fallback: T['id']): T['id'] =>
  list.some((x) => x.id === v) ? (v as T['id']) : fallback;

/** Parses a stored value; anything invalid, missing or obsolete falls back per field. */
export function parsePrefs(raw: string | null | undefined): Prefs {
  let o: any = null;
  try { o = raw ? JSON.parse(raw) : null; } catch { o = null; }
  if (!o || typeof o !== 'object') return { ...DEFAULT_PREFS };
  return {
    accent: oneOf(ACCENTS, o.accent, 'default') as AccentId,
    textSize: oneOf(TEXT_SIZES, o.textSize, 'default') as TextSizeId,
    motion: oneOf(MOTION_MODES, o.motion, 'system') as MotionId,
  };
}

export function readStoredPrefs(storage: Pick<Storage, 'getItem'> | undefined): Prefs {
  try { return parsePrefs(storage?.getItem(PREFS_STORAGE_KEY)); } catch { return { ...DEFAULT_PREFS }; }
}

/** Only non-default values are stored; all defaults clears the key. */
export function storePrefs(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, prefs: Prefs): void {
  try {
    const isDefault = prefs.accent === 'default' && prefs.textSize === 'default' && prefs.motion === 'system';
    if (isDefault) storage?.removeItem(PREFS_STORAGE_KEY);
    else storage?.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* storage unavailable: applies for this page session only */ }
}

type Root = { setAttribute(n: string, v: string): void; removeAttribute(n: string): void };

/**
 * Accent precedence: "default" = the theme's own colours. A chosen accent re-colours primary actions, links, focus ring and
 * selected navigation in every theme EXCEPT High Contrast, whose palette is fixed for accessibility (accent is ignored there).
 * Status colours (success, warning, error, info) are never touched by an accent.
 */
export function accentApplies(theme: ThemeId): boolean {
  return theme !== 'contrast';
}

export function applyPrefs(prefs: Prefs, theme: ThemeId, root: Root): void {
  if (prefs.accent !== 'default' && accentApplies(theme)) root.setAttribute('data-accent', prefs.accent);
  else root.removeAttribute('data-accent');
  if (prefs.textSize !== 'default') root.setAttribute('data-text-size', prefs.textSize);
  else root.removeAttribute('data-text-size');
  if (prefs.motion === 'reduce') root.setAttribute('data-motion', 'reduce');
  else root.removeAttribute('data-motion');
}

/**
 * Dependency-free script inlined in <head>; runs before first paint to avoid a theme flash.
 * Built from the same constants as the functions above (exercised by tests via `new Function`).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var ids=${JSON.stringify(THEMES.map((t) => t.id))};var dark=${JSON.stringify(
  THEMES.filter((t) => t.dark).map((t) => t.id),
)};var acc=${JSON.stringify(ACCENTS.map((a) => a.id))};var sz=${JSON.stringify(TEXT_SIZES.map((a) => a.id))};var s=null,p=null;try{s=localStorage.getItem('${THEME_STORAGE_KEY}');p=JSON.parse(localStorage.getItem('${PREFS_STORAGE_KEY}')||'null')}catch(e){}var t=ids.indexOf(s)>-1?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var r=document.documentElement;r.setAttribute('data-theme',t);r.classList.toggle('dark',dark.indexOf(t)>-1);if(p&&typeof p==='object'){if(p.accent&&p.accent!=='default'&&acc.indexOf(p.accent)>-1&&t!=='contrast')r.setAttribute('data-accent',p.accent);if(p.textSize&&p.textSize!=='default'&&sz.indexOf(p.textSize)>-1)r.setAttribute('data-text-size',p.textSize);if(p.motion==='reduce')r.setAttribute('data-motion','reduce');}}catch(e){}})();`;
