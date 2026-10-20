'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from './label';

interface FormFieldProps {
  label: string;
  /** id of the control; generated if omitted and injected into the child */
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactElement;
}

/**
 * Label + control + hint + error with correct ARIA wiring
 * (aria-invalid, aria-describedby, role="alert" on the error).
 */
export function FormField({ label, htmlFor, error, hint, required, className, children }: FormFieldProps) {
  const autoId = React.useId();
  const id: string = htmlFor ?? children.props.id ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-error` : undefined;
  const describedBy =
    [children.props['aria-describedby'], hintId, errId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} required={required}>{label}</Label>
      {React.cloneElement(children, {
        id,
        'aria-invalid': error ? true : children.props['aria-invalid'],
        'aria-describedby': describedBy,
        'aria-required': required || undefined,
      })}
      {hint && !error && <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
