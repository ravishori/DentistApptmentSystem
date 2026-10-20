import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  /** Marks the field invalid (red border + aria-invalid). Pair with FormField for the message. */
  error?: boolean;
}

const base = cn(
  'flex h-9 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground',
  'placeholder:text-muted-foreground/80 transition-shadow',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/30',
);

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, icon, iconRight, error, ...props }, ref) => {
    const invalid = error ? true : props['aria-invalid'];
    if (icon || iconRight) {
      return (
        <div className="relative">
          {icon && (
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true">
              {icon}
            </div>
          )}
          <input
            type={type}
            className={cn(base, icon && 'pl-9', iconRight && 'pr-9', className)}
            ref={ref}
            {...props}
            aria-invalid={invalid}
          />
          {iconRight && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              {iconRight}
            </div>
          )}
        </div>
      );
    }
    return <input type={type} className={cn(base, className)} ref={ref} {...props} aria-invalid={invalid} />;
  },
);
Input.displayName = 'Input';

export { Input };
