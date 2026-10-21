'use client';
import * as React from 'react';
import { Contrast, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ChoiceGroup, type ChoiceOption } from '@/components/ui/choice-group';
import { ThemeSelector } from '@/components/layout/theme-selector';
import {
  ACCENTS,
  MOTION_MODES,
  TEXT_SIZES,
  THEMES,
  accentApplies,
  type AccentId,
  type MotionId,
  type TextSizeId,
  type ThemeChoice,
} from '@/lib/theme';
import { useTheme } from '@/lib/use-theme';

function Block({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3" aria-labelledby={`appearance-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <div>
        <h3 id={`appearance-${title.replace(/\s+/g, '-').toLowerCase()}`} className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Settings → Appearance & Personalisation. Everything here is a per-browser preference stored in localStorage:
 * it applies immediately, survives refresh and navigation, and is NOT synced across devices or accounts.
 */
export function AppearanceSettings() {
  const { choice, theme, prefs, setChoice, setPrefs, resetAll } = useTheme();
  const [resetNote, setResetNote] = React.useState('');

  const themeLabel = THEMES.find((t) => t.id === theme)?.label ?? theme;
  const isMode = choice === 'light' || choice === 'dark' || choice === 'system';
  const accentOn = accentApplies(theme);

  const modeOptions: ChoiceOption[] = [
    { id: 'light', label: 'Light', description: 'Bright surfaces', preview: <Sun className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> },
    { id: 'dark', label: 'Dark', description: 'Low-glare surfaces', preview: <Moon className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> },
    { id: 'system', label: 'System', description: 'Follow your device', preview: <Monitor className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> },
  ];

  const accentOptions: ChoiceOption[] = ACCENTS.map((a) => ({
    id: a.id,
    label: a.label,
    description: a.description,
    disabled: !accentOn,
    preview: (
      <span
        aria-hidden="true"
        className="h-6 w-full rounded-md border border-border"
        style={{ background: a.swatch ? `hsl(${a.swatch})` : 'hsl(var(--primary))' }}
      />
    ),
  }));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        These settings apply immediately and are remembered in this browser only. They are not synced to other devices or to your account.
      </p>

      <Block title="Appearance mode" description="Light, Dark, or follow your device. A manual choice overrides System.">
        <ChoiceGroup
          name="mode"
          label="Appearance mode"
          value={isMode ? choice : null}
          onChange={(id) => setChoice(id as ThemeChoice)}
          options={modeOptions}
          className="grid grid-cols-3 gap-2"
        />
        {!isMode && (
          <p className="text-xs text-muted-foreground" data-testid="mode-note">
            The “{themeLabel}” theme is active. Choose a mode above to return to Light, Dark or System.
          </p>
        )}
      </Block>

      <Block title="Theme" description="Seven themes. Light and Dark here are the same as the modes above.">
        <ThemeSelector includeSystem={false} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" />
      </Block>

      <Block title="Accent colour" description="Changes primary buttons, links, selected navigation and the focus ring. Status colours (success, warning, error) never change.">
        <ChoiceGroup
          name="accent"
          label="Accent colour"
          value={prefs.accent}
          onChange={(id) => setPrefs({ accent: id as AccentId })}
          options={accentOptions}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
        />
        {!accentOn && (
          <p className="text-xs text-muted-foreground" data-testid="accent-note">
            Accent colours are not applied in High Contrast, so its palette stays fully legible. Your choice is kept for other themes.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3" aria-label="Accent preview" role="group">
          <Button size="sm" type="button" tabIndex={-1}>Primary action</Button>
          <span className="text-sm font-medium text-primary underline underline-offset-2">Link</span>
          <span className="rounded-md px-2 py-1 text-sm font-medium text-foreground outline outline-2 outline-offset-2 outline-[hsl(var(--ring))]">Focus ring</span>
          <span className="text-xs text-muted-foreground">Preview</span>
        </div>
      </Block>

      <Block title="Accessibility" description="Settings your device or browser may also control. Browser zoom and screen readers are managed outside this app.">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground" id="a11y-text-size">Text size</p>
            <ChoiceGroup
              name="text-size"
              label="Text size"
              value={prefs.textSize}
              onChange={(id) => setPrefs({ textSize: id as TextSizeId })}
              options={TEXT_SIZES.map((t) => ({ id: t.id, label: t.label, description: t.description }))}
              className="grid max-w-md grid-cols-2 gap-2"
            />
            <p className="text-xs text-muted-foreground">Scales text sized in relative units. A few dense labels use fixed sizes and stay the same.</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Reduced motion</p>
            <ChoiceGroup
              name="motion"
              label="Reduced motion"
              value={prefs.motion}
              onChange={(id) => setPrefs({ motion: id as MotionId })}
              options={MOTION_MODES.map((m) => ({ id: m.id, label: m.label, description: m.description }))}
              className="grid max-w-md grid-cols-2 gap-2"
            />
            <p className="text-xs text-muted-foreground">Turns off CSS animations and transitions. Chart drawing animations may still play.</p>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-3">
            <div className="min-w-0">
              <label htmlFor="high-contrast-toggle" className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Contrast className="h-4 w-4" aria-hidden="true" /> High Contrast
              </label>
              <p className="mt-0.5 text-xs text-muted-foreground">Black background, white text, heavier borders and a thicker focus ring. Uses the High Contrast theme.</p>
            </div>
            <Switch
              id="high-contrast-toggle"
              checked={theme === 'contrast'}
              onCheckedChange={(on) => setChoice(on ? 'contrast' : 'system')}
              aria-label="High Contrast"
            />
          </div>

          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Keyboard focus is always outlined, in every theme.</li>
            <li>Statuses show an icon and a text label as well as colour; errors include a message, not just a red border.</li>
          </ul>
        </div>
      </Block>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => { resetAll(); setResetNote('Appearance reset to defaults.'); }}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset to defaults
        </Button>
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">{resetNote}</span>
      </div>
    </div>
  );
}
