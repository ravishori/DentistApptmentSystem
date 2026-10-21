# Web design system and themes

Scope: `apps/web`. Responsive web app only (no native Android app). No API, auth, permission or schema change is part of this design work.

## Themes

Seven themes, selected with `<html data-theme="…">`. Dark-family themes (`dark`, `contrast`) also carry `class="dark"` so Tailwind `dark:` variants and the legacy `.dark …` utility overrides in `globals.css` keep working.

| id | Name | Family |
|---|---|---|
| `light` | Light | light |
| `dark` | Dark | dark |
| `ocean` | Ocean Blue | light |
| `mint` | Mint & Teal | light |
| `lavender` | Lavender | light |
| `sand` | Warm Sand | light |
| `contrast` | High Contrast | dark |

- Tokens: `src/styles/tokens.css` (HSL triplets consumed as `hsl(var(--token))`). Every theme defines the same set: background/surface/foreground, card/popover, primary, secondary/muted/accent, status (`success`, `warning`, `info`, `destructive`, each with a `-foreground`), `border`, `input`, `ring`, sidebar (`--sidebar*`), `overlay`, shadows, `--chart-1..8`, `--chart-grid`, `--chart-axis`, the neutral `--slate-*` scale and the `--brand-*` scale.
- Tailwind (`tailwind.config.ts`) maps those tokens to utilities. The legacy `blue-*` and `primary-*` scales are remapped to `--brand-*`, so old classes follow the active theme. Hard-coded status text colours (`text-emerald-600`, `text-orange-600`, `text-red-600`, …) resolve to the status tokens in `globals.css`.
- Logic: `src/lib/theme.ts` (pure functions and the inline init script), `src/lib/use-theme.ts` (hook), `components/layout/theme-selector.tsx` (Settings → Appearance and the header palette menu; radio group with a live preview per theme rendered inside its own `data-theme` scope).
- Persistence: `localStorage["dentalease-theme"]`. No stored value (or "System") follows `prefers-color-scheme`; an explicit choice always wins. The inline script in `<head>` applies the theme before first paint (no flash). Storage failures never throw.
- The preference is **per browser**, not per account. Persisting it on the user profile needs an approved schema/API change and is not done.

### Editing colours

Edit `src/styles/tokens.css`, then run `npx jest theme` in `apps/web`: `theme.test.ts` parses the real stylesheet and fails if any theme drops below WCAG AA (text 4.5:1, controls, focus ring and chart series 3:1; High Contrast also 7:1 for body text and primary buttons).

## Typography

- Body and data: Inter (`next/font`, self-hosted).
- Display: Fraunces (`font-display`), used for page titles and auth headings only, never for dense clinical records or tables.
- Fluid sizes with `clamp()`: `text-display`, `text-title`, `text-stat` (KPI numbers).
- Money, counts, dates and times use tabular numerals (`tabular-nums`; tables and `[data-numeric]` get it globally).

## Components and patterns

- `StatusBadge` (`components/ui/badge.tsx`): every status has an icon and a text label; colour is never the only signal.
- Charts: colours from `lib/chart-theme.ts` (`chartColor(n)`, `CHART_GRID`, `CHART_AXIS`, `CHART_TOOLTIP_STYLE`, `legendLabel`), so they re-colour with the theme. Charts keep their visually hidden data tables (`table.sr-only`).
- Navigation: `components/layout/nav-items.ts` is the single list used by the sidebar and the command palette (Ctrl/Cmd+K, `command-palette.tsx`). Nothing is role-filtered yet (see feature L3).
- Header: page actions move to a second full-width row below `sm`; theme menu and search stay in the first row.
- Phones: appointment list and invoice list render as stacked cards below `md`; tables stay for `md` and up. Tab bars scroll horizontally instead of widening the page.
- Toasts follow the active theme (`ThemedToaster`).
- Motion: transitions are short and the global `prefers-reduced-motion` rule disables them.

## Appearance & Personalisation (Settings)

- **Mode vs theme:** the stored `dentalease-theme` value is unchanged (one of the seven theme ids, or absent = System). The Light / Dark / System "mode" control is another view of the same value: Light = `light`, Dark = `dark`, System = absent. Choosing Ocean Blue, Mint & Teal, Lavender, Warm Sand or High Contrast selects that theme and shows "a custom theme is active" next to the mode control. No theme id was renamed, removed or duplicated.
- **Accent presets** (`styles/accents.css`, `dentalease-prefs.accent`): Clinical Blue, Dental Teal, Sage Green, Professional Violet, or "Theme default". Precedence: default = the theme's own colours; any preset re-colours `--primary`, `--ring`, `--brand-*` (so legacy `blue-*` classes follow), `--brand-text` and `--sidebar-active` in every theme **except High Contrast**, where it is ignored and the choice is kept for other themes. Light-family and Dark have separate values so contrast holds in both. Success, warning, info and destructive tokens are never defined by an accent (tested).
- **Text size** (`data-text-size="large"` on `<html>`): root font size 112.5%. Only rem-based sizes scale.
- **Reduced motion** (`data-motion="reduce"`): explicit "Always reduce"; the default follows `prefers-reduced-motion`. Covers CSS animations and transitions only.
- **High Contrast:** a switch that selects the existing High Contrast theme (7:1 text, thicker 3px focus ring). Not an overlay on other themes.
- **State and persistence:** `lib/use-theme.ts` is a shared store (`useSyncExternalStore`): the header menu, command palette and Settings page update together; OS theme changes and other tabs (storage events) are followed. Preferences are validated per field, so invalid or obsolete stored values fall back to defaults. The inline `<head>` script applies theme, accent, text size and motion before first paint.
- **Not done:** cross-device or per-account sync. That needs a new API endpoint/table, which was not approved. Preferences are per browser.
- **Tailwind note:** `tailwind.config.ts` changes (for example new colour names) need a dev-server restart to take effect.

## How it was verified (2026-10-21)

- Automated: `apps/web` `npm test` (164 tests, includes theme logic, init-script simulation, contrast from the real tokens, selector and status-badge rendering, themed empty/error states), `tsc --noEmit`, production `next build` with `NEXT_DIST_DIR=.next-build` and `NODE_ENV=production`.
- Real browser (Chromium pane, disposable PostgreSQL + Redis + API + dev server on ports 55432 / 56379 / 3011 / 3100, demo data only): theme switching and persistence, a rendered text-contrast scan of computed colours against effective backgrounds (0 failures in 7 themes × 7 pages), horizontal-overflow checks at 320, 375, 768 (nine pages), 1024 and 1440 (five pages), mobile drawer, theme menu, command palette.
- Not covered: axe/screen-reader testing, real devices and touch, login/register, `/pay`, patient sub-pages and modals at 320, WhatsApp and clinic pages in the contrast scan. See `docs/PROJECT_FEATURE_STATUS.md` rows L8–L10.
