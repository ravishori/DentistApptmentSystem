/**
 * Appearance & Personalisation: accent, text size, reduced motion, System mode, persistence and the Settings UI.
 * Server rendering + a fake browser environment (no DOM, no network, no provider). Real-browser checks are documented separately.
 */
import * as React from 'react';
import fs from 'fs';
import path from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ACCENTS,
  DEFAULT_PREFS,
  PREFS_STORAGE_KEY,
  THEME_IDS,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  accentApplies,
  applyPrefs,
  parsePrefs,
  readStoredPrefs,
  storePrefs,
} from '@/lib/theme';
import { AppearanceSettings } from '@/components/settings/appearance-settings';
import SettingsPage from '@/app/(dashboard)/settings/page';
import { failQueries, html, newClient, unavailable503 } from './helpers';

// ── helpers ──────────────────────────────────────────────────────────────────
const tokensCss = fs.readFileSync(path.join(__dirname, '../styles/tokens.css'), 'utf8');
const accentsCss = fs.readFileSync(path.join(__dirname, '../styles/accents.css'), 'utf8');
const globalsCss = fs.readFileSync(path.join(__dirname, '../app/globals.css'), 'utf8');

function blocks(css: string) {
  return Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g)).map((m) => {
    const vars: Record<string, string> = {};
    for (const v of Array.from(m[2].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g))) vars[v[1]] = v[2].trim();
    return { selector: m[1].trim(), vars };
  });
}
const themeTokens = (id: string) => {
  const b = blocks(tokensCss).find((x) => x.selector.includes(`[data-theme='${id}']`));
  if (!b) throw new Error(`no block for ${id}`);
  return b.vars;
};
const isDark = (id: string) => id === 'dark' || id === 'contrast';
const accentBlock = (accent: string, dark: boolean) =>
  blocks(accentsCss).find((b) => b.selector.includes(`[data-accent='${accent}']`) && (dark ? b.selector.includes(':root.dark') : b.selector.includes(':not(.dark)')))!;

const lum = (t: string) => {
  const m = t.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/)!;
  const h = +m[1], s = +m[2] / 100, l = +m[3] / 100;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const [r, g, b] = [f(0), f(8), f(4)].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const fakeRoot = () => {
  const attrs: Record<string, string> = {}; const classes = new Set<string>();
  return { attrs, classes, setAttribute: (n: string, v: string) => void (attrs[n] = v), removeAttribute: (n: string) => void delete attrs[n],
    classList: { toggle: (c: string, f: boolean) => void (f ? classes.add(c) : classes.delete(c)) } };
};
const memStorage = (init: Record<string, string> = {}) => { const d = { ...init }; return { d, getItem: (k: string) => (k in d ? d[k] : null), setItem: (k: string, v: string) => void (d[k] = v), removeItem: (k: string) => void delete d[k] }; };

// ── preference model ─────────────────────────────────────────────────────────
describe('preferences model', () => {
  it('defaults when nothing is stored', () => expect(parsePrefs(null)).toEqual(DEFAULT_PREFS));

  it.each([
    ['not json', '{oops'],
    ['wrong type', '"teal"'],
    ['array', '[1,2]'],
    ['unknown values', JSON.stringify({ accent: 'neon', textSize: 'huge', motion: 'sometimes' })],
    ['obsolete extra keys', JSON.stringify({ accent: 'teal', legacy: true, fontScale: 3 })],
  ])('invalid or obsolete stored value (%s) never throws and falls back per field', (_n, raw) => {
    const p = parsePrefs(raw);
    expect(ACCENTS.map((a) => a.id)).toContain(p.accent);
    expect(['default', 'large']).toContain(p.textSize);
    expect(['system', 'reduce']).toContain(p.motion);
  });

  it('keeps the valid fields of a partly valid value', () => {
    expect(parsePrefs(JSON.stringify({ accent: 'sage', textSize: 'bogus', motion: 'reduce' }))).toEqual({ accent: 'sage', textSize: 'default', motion: 'reduce' });
  });

  it('persists and restores; all-defaults removes the key; blocked storage never throws', () => {
    const s = memStorage();
    storePrefs(s, { accent: 'teal', textSize: 'large', motion: 'reduce' });
    expect(readStoredPrefs(s)).toEqual({ accent: 'teal', textSize: 'large', motion: 'reduce' });
    storePrefs(s, DEFAULT_PREFS);
    expect(PREFS_STORAGE_KEY in s.d).toBe(false);
    const blocked = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(() => storePrefs(blocked, { ...DEFAULT_PREFS, accent: 'blue' })).not.toThrow();
    expect(readStoredPrefs(blocked)).toEqual(DEFAULT_PREFS);
  });

  it('stores no sensitive data: only the three whitelisted keys', () => {
    const s = memStorage();
    storePrefs(s, { accent: 'violet', textSize: 'large', motion: 'reduce' });
    expect(Object.keys(JSON.parse(s.d[PREFS_STORAGE_KEY])).sort()).toEqual(['accent', 'motion', 'textSize']);
  });
});

describe('applying preferences to <html>', () => {
  it('sets accent, text size and motion attributes', () => {
    const r = fakeRoot();
    applyPrefs({ accent: 'teal', textSize: 'large', motion: 'reduce' }, 'ocean', r);
    expect(r.attrs).toEqual({ 'data-accent': 'teal', 'data-text-size': 'large', 'data-motion': 'reduce' });
  });
  it('removes attributes for defaults', () => {
    const r = fakeRoot();
    applyPrefs({ accent: 'teal', textSize: 'large', motion: 'reduce' }, 'ocean', r);
    applyPrefs(DEFAULT_PREFS, 'ocean', r);
    expect(r.attrs).toEqual({});
  });
  it('precedence: High Contrast ignores accents (palette fixed for accessibility); every other theme honours them', () => {
    expect(accentApplies('contrast')).toBe(false);
    for (const id of THEME_IDS.filter((t) => t !== 'contrast')) expect(accentApplies(id)).toBe(true);
    const r = fakeRoot();
    applyPrefs({ ...DEFAULT_PREFS, accent: 'sage' }, 'contrast', r);
    expect(r.attrs['data-accent']).toBeUndefined();
  });
});

describe('first-paint script with personalisation', () => {
  const run = (stored: Record<string, string>, prefersDark = false) => {
    const root = fakeRoot();
    new Function('document', 'window', 'localStorage', THEME_INIT_SCRIPT)({ documentElement: root }, { matchMedia: () => ({ matches: prefersDark }) }, memStorage(stored));
    return root;
  };
  it('restores accent, text size and motion with the theme', () => {
    const r = run({ [THEME_STORAGE_KEY]: 'mint', [PREFS_STORAGE_KEY]: JSON.stringify({ accent: 'violet', textSize: 'large', motion: 'reduce' }) });
    expect(r.attrs).toMatchObject({ 'data-theme': 'mint', 'data-accent': 'violet', 'data-text-size': 'large', 'data-motion': 'reduce' });
  });
  it('ignores invalid stored preferences and still sets the theme', () => {
    const r = run({ [PREFS_STORAGE_KEY]: '{broken', [THEME_STORAGE_KEY]: 'ocean' });
    expect(r.attrs).toEqual({ 'data-theme': 'ocean' });
    expect(run({ [PREFS_STORAGE_KEY]: JSON.stringify({ accent: 'neon', textSize: 'x', motion: 'y' }) }).attrs['data-accent']).toBeUndefined();
  });
  it('does not apply an accent under High Contrast', () => {
    expect(run({ [THEME_STORAGE_KEY]: 'contrast', [PREFS_STORAGE_KEY]: JSON.stringify({ accent: 'teal' }) }).attrs['data-accent']).toBeUndefined();
  });
});

// ── System mode against a fake browser (the real shared store) ────────────────
describe('System appearance (shared store)', () => {
  function boot(prefersDark: boolean, stored: Record<string, string> = {}) {
    const root = fakeRoot(); const ls = memStorage(stored);
    const mq = { matches: prefersDark, fns: [] as (() => void)[], addEventListener(_t: string, f: () => void) { this.fns.push(f); }, removeEventListener() {} };
    (global as any).window = { localStorage: ls, matchMedia: () => mq, addEventListener: () => undefined };
    (global as any).document = { documentElement: root };
    let store: any; jest.isolateModules(() => { store = require('@/lib/use-theme').appearanceStore; });
    store.subscribe(() => undefined);
    return { store, root, mq, ls, flip: (dark: boolean) => { mq.matches = dark; mq.fns.forEach((f) => f()); } };
  }
  afterEach(() => { delete (global as any).window; delete (global as any).document; });

  it('follows the device preference and updates when it changes while System is active', () => {
    const b = boot(false);
    expect(b.root.attrs['data-theme']).toBe('light');
    b.flip(true);
    expect(b.root.attrs['data-theme']).toBe('dark'); expect(b.root.classes.has('dark')).toBe(true);
    b.flip(false);
    expect(b.root.attrs['data-theme']).toBe('light'); expect(b.root.classes.has('dark')).toBe(false);
  });

  it('an explicit Light or Dark selection overrides System and ignores later device changes', () => {
    const b = boot(true);
    expect(b.root.attrs['data-theme']).toBe('dark');
    b.store.setChoice('light');
    expect(b.root.attrs['data-theme']).toBe('light');
    b.flip(true); b.flip(false); b.flip(true);
    expect(b.root.attrs['data-theme']).toBe('light');
    b.store.setChoice('dark'); b.flip(false);
    expect(b.root.attrs['data-theme']).toBe('dark');
    b.store.setChoice('system');
    expect(b.root.attrs['data-theme']).toBe('light'); // device currently says light
  });

  it('all seven themes stay selectable and are applied', () => {
    const b = boot(false);
    for (const id of THEME_IDS) { b.store.setChoice(id); expect(b.root.attrs['data-theme']).toBe(id); expect(b.ls.d[THEME_STORAGE_KEY]).toBe(id); }
  });

  it('accent applies immediately, is dropped (not forgotten) under High Contrast, and returns afterwards', () => {
    const b = boot(false);
    b.store.setPrefs({ accent: 'teal' });
    expect(b.root.attrs['data-accent']).toBe('teal');
    b.store.setChoice('contrast');
    expect(b.root.attrs['data-accent']).toBeUndefined();
    expect(JSON.parse(b.ls.d[PREFS_STORAGE_KEY]).accent).toBe('teal');
    b.store.setChoice('ocean');
    expect(b.root.attrs['data-accent']).toBe('teal');
  });

  it('text size and reduced motion apply and persist; reset restores every default', () => {
    const b = boot(false);
    b.store.setPrefs({ textSize: 'large', motion: 'reduce' });
    expect(b.root.attrs).toMatchObject({ 'data-text-size': 'large', 'data-motion': 'reduce' });
    b.store.setChoice('sand');
    b.store.resetAll();
    expect(b.root.attrs['data-text-size']).toBeUndefined();
    expect(b.root.attrs['data-motion']).toBeUndefined();
    expect(b.root.attrs['data-accent']).toBeUndefined();
    expect(THEME_STORAGE_KEY in b.ls.d).toBe(false);
    expect(PREFS_STORAGE_KEY in b.ls.d).toBe(false);
    expect(b.store.getSnapshot().choice).toBe('system');
  });

  it('preferences survive a refresh (a new store reading the same storage) and invalid stored values are tolerated', () => {
    const first = boot(false);
    first.store.setChoice('lavender'); first.store.setPrefs({ accent: 'sage', textSize: 'large' });
    const second = boot(false, { ...first.ls.d });
    expect(second.root.attrs).toMatchObject({ 'data-theme': 'lavender', 'data-accent': 'sage', 'data-text-size': 'large' });
    const bad = boot(false, { [THEME_STORAGE_KEY]: 'retro', [PREFS_STORAGE_KEY]: '{{' });
    expect(bad.root.attrs['data-theme']).toBe('light');
    expect(bad.root.attrs['data-accent']).toBeUndefined();
  });

  it('notifies every subscriber, so the Settings page updates when a change is made elsewhere (header menu, palette)', () => {
    const b = boot(false);
    const seen: string[] = [];
    b.store.subscribe(() => seen.push(b.store.getSnapshot().choice));
    b.store.setChoice('ocean');
    expect(seen).toContain('ocean');
  });
});

// ── CSS contract ─────────────────────────────────────────────────────────────
describe('accent presets (from src/styles/accents.css)', () => {
  const STATUS = ['success', 'warning', 'info', 'destructive', 'success-foreground', 'warning-foreground', 'info-foreground', 'destructive-foreground'];
  const accents = ACCENTS.filter((a) => a.id !== 'default').map((a) => a.id);

  it('defines four presets, each for light-family and dark', () => {
    expect(accents).toEqual(['blue', 'teal', 'sage', 'violet']);
    for (const a of accents) { expect(accentBlock(a, false)).toBeDefined(); expect(accentBlock(a, true)).toBeDefined(); }
  });

  it('never redefines status colours (success, warning, error, info): they stay semantic', () => {
    for (const b of blocks(accentsCss)) for (const k of STATUS) expect(Object.keys(b.vars)).not.toContain(k);
  });

  it('never targets High Contrast', () => {
    for (const b of blocks(accentsCss)) expect(b.selector).toContain(":not([data-theme='contrast'])");
  });

  for (const accent of ['blue', 'teal', 'sage', 'violet']) {
    for (const theme of THEME_IDS.filter((t) => t !== 'contrast')) {
      it(`${accent} on ${theme}: text 4.5:1, controls and focus ring 3:1`, () => {
        const t = { ...themeTokens(theme), ...accentBlock(accent, isDark(theme)).vars };
        // legacy `bg-blue-600 text-white` buttons and hover `bg-blue-700`: white text must stay readable on the accent fill
        t.white = '0 0% 100%';
        const text: [string, string][] = [['primary-foreground', 'primary'], ['brand-text', 'background'], ['brand-text', 'card'], ['sidebar-active', 'sidebar'], ['white', 'brand-600'], ['white', 'brand-700']];
        const nonText: [string, string][] = [['primary', 'background'], ['primary', 'card'], ['ring', 'background'], ['ring', 'card']];
        const bad = [
          ...text.filter(([f, b]) => contrast(t[f], t[b]) < 4.5).map(([f, b]) => `${f}/${b}=${contrast(t[f], t[b]).toFixed(2)}`),
          ...nonText.filter(([f, b]) => contrast(t[f], t[b]) < 3).map(([f, b]) => `${f}/${b}=${contrast(t[f], t[b]).toFixed(2)}`),
        ];
        expect(bad).toEqual([]);
      });
    }
  }

  it('High Contrast keeps its own AAA palette and thicker focus ring', () => {
    const t = themeTokens('contrast');
    expect(contrast(t.foreground, t.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(t['primary-foreground'], t.primary)).toBeGreaterThanOrEqual(7);
    expect(globalsCss).toMatch(/\[data-theme='contrast'\] :focus-visible \{ outline-width: 3px/);
  });
});

describe('text size and reduced motion CSS', () => {
  it('larger text scales the root; reduced motion has a device rule AND an explicit rule', () => {
    expect(globalsCss).toMatch(/html\[data-text-size='large'\] \{ font-size: 112\.5%; \}/);
    expect(globalsCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(globalsCss).toMatch(/\[data-motion='reduce'\] \*/);
  });
});

// ── Settings UI ──────────────────────────────────────────────────────────────
describe('Settings → Appearance & Personalisation', () => {
  const markup = renderToStaticMarkup(<AppearanceSettings />);

  it('has the four organised sections', () => {
    for (const h of ['Appearance mode', 'Theme', 'Accent colour', 'Accessibility']) expect(markup).toContain(h);
    expect(markup).toContain('not synced');
  });
  it('offers Light, Dark and System modes', () => {
    for (const id of ['light', 'dark', 'system']) expect(markup).toContain(`data-choice="mode:${id}"`);
  });
  it('shows all seven existing themes with previews', () => {
    for (const id of THEME_IDS) { expect(markup).toContain(`data-choice="theme:${id}"`); expect(markup).toContain(`data-theme="${id}"`); }
    for (const name of ['Light', 'Dark', 'Ocean Blue', 'Mint &amp; Teal', 'Lavender', 'Warm Sand', 'High Contrast']) expect(markup).toContain(name);
  });
  it('offers the four accent presets plus the theme default', () => {
    for (const id of ['default', 'blue', 'teal', 'sage', 'violet']) expect(markup).toContain(`data-choice="accent:${id}"`);
    for (const n of ['Clinical Blue', 'Dental Teal', 'Sage Green', 'Professional Violet']) expect(markup).toContain(n);
  });
  it('offers text size, reduced motion, High Contrast and reset', () => {
    expect(markup).toContain('data-choice="text-size:large"');
    expect(markup).toContain('data-choice="motion:reduce"');
    expect(markup).toContain('High Contrast');
    expect(markup).toContain('Reset to defaults');
  });
  it('uses radio semantics with roving tabindex (one tab stop per group) and a labelled group', () => {
    expect((markup.match(/role="radiogroup"/g) ?? []).length).toBe(5);
    expect(markup).toContain('aria-label="Appearance mode"');
    expect(markup).toContain('aria-label="Accent colour"');
    const mode = markup.slice(markup.indexOf('aria-label="Appearance mode"'), markup.indexOf('aria-label="Colour theme"'));
    expect((mode.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect((mode.match(/tabindex="-1"/g) ?? []).length).toBe(2);
  });
  it('every choice has a touch-sized target and the selection is shown by a check, not colour alone', () => {
    expect(markup).toContain('min-h-[44px]');
    expect(markup).toContain('lucide-check');
  });
  it('contains no hard-coded colours except the accent swatches', () => {
    const withoutSwatches = markup.replace(/style="[^"]*"/g, '');
    expect(withoutSwatches).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

describe('Settings page keeps Appearance available in loading and error states', () => {
  it('loading: appearance is shown beside the skeletons', () => {
    const qc = newClient(); const m = html(<SettingsPage />, qc);
    expect(m).toContain('Appearance &amp; Personalisation');
  });
  it('failed profile load: the error state is shown AND appearance still works', () => {
    const qc = newClient(); html(<SettingsPage />, qc);
    failQueries(qc, unavailable503());
    const m = html(<SettingsPage />, qc);
    expect(m).toContain('Could not load the clinic settings');
    expect(m).toContain('Appearance &amp; Personalisation');
    expect(m).toContain('data-choice="theme:contrast"');
  });
});
