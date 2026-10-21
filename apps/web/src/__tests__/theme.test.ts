import fs from 'fs';
import path from 'path';
import {
  THEMES,
  THEME_IDS,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  isDarkTheme,
  readStoredChoice,
  resolveTheme,
  storeChoice,
} from '@/lib/theme';

// ── helpers ──────────────────────────────────────────────────────────────────

const tokensCss = fs.readFileSync(path.join(__dirname, '../styles/tokens.css'), 'utf8');

/** token map per theme, parsed from the real stylesheet (so the test fails if a theme block is edited badly). */
function parseThemes(css: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const m of Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g))) {
    const ids = Array.from(m[1].matchAll(/\[data-theme='([a-z]+)'\]/g)).map((x) => x[1]);
    if (!ids.length) continue;
    const vars: Record<string, string> = {};
    for (const v of Array.from(m[2].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g))) vars[v[1]] = v[2].trim();
    ids.forEach((id) => (out[id] = vars));
  }
  return out;
}

function hslToRgb(token: string): [number, number, number] {
  const m = token.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
  if (!m) throw new Error(`not an HSL triplet: ${token}`);
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function luminance(token: string): number {
  const [r, g, b] = hslToRgb(token).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function fakeRoot() {
  const classes = new Set<string>();
  const attrs: Record<string, string> = {};
  return {
    attrs,
    classes,
    setAttribute: (n: string, v: string) => void (attrs[n] = v),
    classList: { toggle: (c: string, f: boolean) => void (f ? classes.add(c) : classes.delete(c)) },
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
  };
}

/** Runs the real inline <head> script against fakes: what the browser does before first paint. */
function runInitScript(opts: { stored?: string; prefersDark?: boolean; storageThrows?: boolean }) {
  const root = fakeRoot();
  const storage = opts.storageThrows
    ? { getItem: () => { throw new Error('blocked'); } }
    : memoryStorage(opts.stored ? { [THEME_STORAGE_KEY]: opts.stored } : {});
  new Function('document', 'window', 'localStorage', THEME_INIT_SCRIPT)(
    { documentElement: root },
    { matchMedia: () => ({ matches: !!opts.prefersDark }) },
    storage,
  );
  return root;
}

// ── theme logic ──────────────────────────────────────────────────────────────

describe('theme model', () => {
  it('offers exactly the seven required themes', () => {
    expect(THEME_IDS).toEqual(['light', 'dark', 'ocean', 'mint', 'lavender', 'sand', 'contrast']);
    expect(THEMES.filter((t) => t.dark).map((t) => t.id)).toEqual(['dark', 'contrast']);
  });

  it('an explicit choice wins over the OS preference; no choice follows the OS', () => {
    expect(resolveTheme('ocean', true)).toBe('ocean');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
    expect(resolveTheme('not-a-theme', true)).toBe('dark');
  });

  it('applies data-theme and the dark class together for every theme', () => {
    for (const id of THEME_IDS) {
      const root = fakeRoot();
      applyTheme(id, root);
      expect(root.attrs['data-theme']).toBe(id);
      expect(root.classes.has('dark')).toBe(isDarkTheme(id));
    }
  });

  it('persists a choice, treats "system" as clearing it, and survives blocked storage', () => {
    const s = memoryStorage();
    storeChoice(s, 'mint');
    expect(s.data[THEME_STORAGE_KEY]).toBe('mint');
    expect(readStoredChoice(s)).toBe('mint');
    storeChoice(s, 'system');
    expect(readStoredChoice(s)).toBe('system');
    const blocked = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(() => storeChoice(blocked, 'dark')).not.toThrow();
    expect(readStoredChoice(blocked)).toBe('system');
  });
});

describe('first-paint init script (simulated refresh)', () => {
  it.each(THEME_IDS)('restores a saved %s theme before hydration', (id) => {
    const root = runInitScript({ stored: id, prefersDark: id === 'light' });
    expect(root.attrs['data-theme']).toBe(id);
    expect(root.classes.has('dark')).toBe(isDarkTheme(id));
  });

  it('follows the OS when nothing is saved, and ignores garbage values', () => {
    expect(runInitScript({ prefersDark: true }).attrs['data-theme']).toBe('dark');
    expect(runInitScript({ prefersDark: false }).attrs['data-theme']).toBe('light');
    expect(runInitScript({ stored: 'neon', prefersDark: false }).attrs['data-theme']).toBe('light');
  });

  it('does not throw when storage is blocked', () => {
    expect(runInitScript({ storageThrows: true, prefersDark: true }).attrs['data-theme']).toBe('dark');
  });
});

// ── contrast (WCAG 2.2 AA) computed from the real token values ─────────────────

describe('theme contrast (from src/styles/tokens.css)', () => {
  const themes = parseThemes(tokensCss);

  it('defines a complete token block for every theme', () => {
    expect(Object.keys(themes).sort()).toEqual([...THEME_IDS].sort());
    const required = ['background', 'foreground', 'card', 'primary', 'primary-foreground', 'muted-foreground', 'input', 'ring', 'sidebar', 'brand-text', 'chart-1', 'chart-8', 'chart-grid'];
    for (const id of THEME_IDS) for (const t of required) expect(themes[id][t]).toBeDefined();
  });

  const textPairs: [string, string][] = [
    ['foreground', 'background'],
    ['card-foreground', 'card'],
    ['popover-foreground', 'popover'],
    ['muted-foreground', 'background'],
    ['muted-foreground', 'card'],
    ['muted-foreground', 'muted'],
    ['secondary-foreground', 'secondary'],
    ['primary-foreground', 'primary'],
    ['destructive-foreground', 'destructive'],
    ['success-foreground', 'success'],
    ['warning-foreground', 'warning'],
    ['info-foreground', 'info'],
    ['brand-text', 'background'],
    ['brand-text', 'card'],
    ['destructive', 'card'],
    ['success', 'card'],
    ['warning', 'card'],
    ['info', 'card'],
    ['sidebar-foreground', 'sidebar'],
    ['sidebar-muted', 'sidebar'],
    ['sidebar-active', 'sidebar'],
    ['chart-axis', 'card'],
    ['slate-500', 'card'],
    ['slate-600', 'background'],
  ];
  const nonTextPairs: [string, string][] = [
    ['input', 'card'],
    ['input', 'background'],
    ['ring', 'background'],
    ['ring', 'card'],
    ['primary', 'background'],
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): [string, string] => [`chart-${n}`, 'card']),
  ];

  for (const id of THEME_IDS) {
    it(`${id}: text pairs meet 4.5:1`, () => {
      const failures = textPairs
        .map(([fg, bg]) => ({ fg, bg, ratio: contrast(themes[id][fg], themes[id][bg]) }))
        .filter((r) => r.ratio < 4.5)
        .map((r) => `${r.fg} on ${r.bg} = ${r.ratio.toFixed(2)}`);
      expect(failures).toEqual([]);
    });

    it(`${id}: controls, focus ring and chart series meet 3:1`, () => {
      const failures = nonTextPairs
        .map(([fg, bg]) => ({ fg, bg, ratio: contrast(themes[id][fg], themes[id][bg]) }))
        .filter((r) => r.ratio < 3)
        .map((r) => `${r.fg} vs ${r.bg} = ${r.ratio.toFixed(2)}`);
      expect(failures).toEqual([]);
    });
  }

  it('high contrast reaches AAA (7:1) for body text and primary buttons', () => {
    const t = themes.contrast;
    expect(contrast(t.foreground, t.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(t['muted-foreground'], t.card)).toBeGreaterThanOrEqual(7);
    expect(contrast(t['primary-foreground'], t.primary)).toBeGreaterThanOrEqual(7);
  });
});
