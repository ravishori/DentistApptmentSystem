'use client';
import Link from 'next/link';
import * as Popover from '@radix-ui/react-popover';
import { Monitor, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChoiceGroup, type ChoiceOption } from '@/components/ui/choice-group';
import { THEMES, type ThemeChoice } from '@/lib/theme';
import { useTheme } from '@/lib/use-theme';

/** Mini preview: rendered inside its own data-theme scope so it always shows that theme's real tokens. */
export function ThemePreview({ id }: { id: string }) {
  return (
    <span
      data-theme={id}
      aria-hidden="true"
      className="flex h-12 w-full overflow-hidden rounded-md border border-border bg-background"
    >
      <span className="w-1/4 bg-sidebar" />
      <span className="flex flex-1 flex-col gap-1 p-1.5">
        <span className="h-1.5 w-2/3 rounded-sm bg-foreground" />
        <span className="h-1.5 w-1/2 rounded-sm bg-muted-foreground" />
        <span className="mt-auto flex gap-1">
          <span className="h-2 w-5 rounded-sm bg-primary" />
          <span className="h-2 w-3 rounded-sm bg-success" />
          <span className="h-2 w-3 rounded-sm bg-warning" />
        </span>
      </span>
    </span>
  );
}

export const SystemPreview = () => (
  <span aria-hidden="true" className="flex h-12 w-full items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
    <Monitor className="h-5 w-5" />
  </span>
);

/** The seven themes (plus, optionally, "System") as a keyboard-navigable radio group with live previews. */
export function ThemeSelector({ className, includeSystem = true }: { className?: string; includeSystem?: boolean }) {
  const { choice, setChoice } = useTheme();
  const options: ChoiceOption[] = [
    ...(includeSystem ? [{ id: 'system', label: 'System', description: 'Match your device', preview: <SystemPreview /> }] : []),
    ...THEMES.map(({ id, label, description }) => ({ id, label, description, preview: <ThemePreview id={id} /> })),
  ];
  return (
    <ChoiceGroup
      name="theme"
      label="Colour theme"
      value={choice}
      onChange={(id) => setChoice(id as ThemeChoice)}
      options={options}
      className={className ?? 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4'}
    />
  );
}

/** Header entry point: opens the same selector in a popover. Full options live in Settings → Appearance. */
export function ThemeMenu() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme" title="Change theme">
          <Palette className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 max-h-[80vh] w-[min(24rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-popover"
        >
          <p className="mb-2 text-sm font-semibold">Theme</p>
          <ThemeSelector className="grid grid-cols-2 gap-2" />
          <Link href="/settings" className="mt-3 block text-xs font-medium text-primary underline-offset-2 hover:underline">
            More appearance and accessibility options
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
