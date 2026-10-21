'use client';
import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
  preview?: React.ReactNode;
  disabled?: boolean;
}

interface ChoiceGroupProps {
  /** Accessible name of the group. */
  label: string;
  value: string | null;
  onChange: (id: string) => void;
  options: ChoiceOption[];
  /** Grid classes for the layout. */
  className?: string;
  /** Used for tests and styling hooks: becomes data-choice="<name>:<id>". */
  name: string;
}

/**
 * Single-choice radio group with roving tabindex: Tab enters the group once, arrow keys move AND select,
 * Home/End jump. A visible check + ring marks the selection (not colour alone).
 */
export function ChoiceGroup({ label, value, onChange, options, className, name }: ChoiceGroupProps) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((o) => !o.disabled);
  const tabStop = enabled.find((o) => o.id === value)?.id ?? enabled[0]?.id;

  const move = (from: number, dir: 1 | -1 | 'first' | 'last') => {
    const idxs = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    if (!idxs.length) return;
    let target: number;
    if (dir === 'first') target = idxs[0];
    else if (dir === 'last') target = idxs[idxs.length - 1];
    else {
      const pos = idxs.indexOf(from);
      target = idxs[(pos + dir + idxs.length) % idxs.length];
    }
    refs.current[target]?.focus();
    onChange(options[target].id);
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); move(i, 1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); move(i, -1); }
    else if (k === 'Home') { e.preventDefault(); move(i, 'first'); }
    else if (k === 'End') { e.preventDefault(); move(i, 'last'); }
  };

  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {options.map((o, i) => {
        const selected = value === o.id;
        return (
          <button
            key={o.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={o.disabled || undefined}
            disabled={o.disabled}
            tabIndex={o.id === tabStop ? 0 : -1}
            data-choice={`${name}:${o.id}`}
            onClick={() => !o.disabled && onChange(o.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative flex min-h-[44px] flex-col gap-1.5 rounded-lg border bg-card p-2 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card',
              selected ? 'border-primary ring-2 ring-primary' : 'border-border',
            )}
          >
            {o.preview}
            <span className="flex items-center justify-between gap-1 text-sm font-medium text-foreground">
              {o.label}
              {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
            </span>
            {o.description && <span className="text-xs text-muted-foreground">{o.description}</span>}
          </button>
        );
      })}
    </div>
  );
}
