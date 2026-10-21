'use client';
import * as Popover from '@radix-ui/react-popover';
import { Check, Monitor, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { THEMES, type ThemeChoice } from '@/lib/theme';
import { useTheme } from '@/lib/use-theme';

/** Mini preview: rendered inside its own data-theme scope so it always shows that theme's real tokens. */
function ThemePreview({ id }: { id: string }) {
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

/** Accessible single-choice group (radio semantics) with a visual preview per theme. */
export function ThemeSelector({ className }: { className?: string }) {
  const { choice, setChoice } = useTheme();
  const options: { id: ThemeChoice; label: string; description: string }[] = [
    { id: 'system', label: 'System', description: 'Match your device' },
    ...THEMES.map(({ id, label, description }) => ({ id, label, description })),
  ];

  return (
    <div role="radiogroup" aria-label="Colour theme" className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4', className)}>
      {options.map((o) => {
        const selected = choice === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            data-theme-option={o.id}
            onClick={() => setChoice(o.id)}
            className={cn(
              'group relative flex min-h-[44px] flex-col gap-1.5 rounded-lg border bg-card p-2 text-left transition-colors hover:bg-accent',
              selected ? 'border-primary ring-2 ring-primary' : 'border-border',
            )}
          >
            {o.id === 'system' ? (
              <span aria-hidden="true" className="flex h-12 w-full items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                <Monitor className="h-5 w-5" />
              </span>
            ) : (
              <ThemePreview id={o.id} />
            )}
            <span className="flex items-center justify-between gap-1 text-sm font-medium text-foreground">
              {o.label}
              {selected && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
            </span>
            <span className="text-xs text-muted-foreground">{o.description}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Header entry point: opens the same selector in a popover. */
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
          className="z-50 w-[min(24rem,calc(100vw-1rem))] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-popover"
        >
          <p className="mb-2 text-sm font-semibold">Theme</p>
          <ThemeSelector className="grid-cols-2 sm:grid-cols-2 lg:grid-cols-2" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
