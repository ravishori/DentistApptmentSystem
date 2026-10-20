import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:     'bg-primary/10 text-primary',
        secondary:   'bg-secondary text-secondary-foreground',
        destructive: 'bg-destructive/10 text-destructive',
        success:     'bg-success/10 text-success',
        warning:     'bg-warning/15 text-warning',
        info:        'bg-info/10 text-info',
        purple:      'bg-purple-100 text-purple-800',
        teal:        'bg-teal-100 text-teal-800',
        orange:      'bg-orange-100 text-orange-700',
        outline:     'border border-input text-foreground bg-transparent',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

// Appointment / invoice status → variant mapping
export function statusVariant(status: string): BadgeProps['variant'] {
  const map: Record<string, BadgeProps['variant']> = {
    scheduled:   'default',
    confirmed:   'teal',
    in_progress: 'warning',
    completed:   'success',
    cancelled:   'destructive',
    no_show:     'secondary',
    rescheduled: 'purple',
    draft:       'secondary',
    sent:        'default',
    partial:         'warning',
    partially_paid:  'warning',
    paid:            'success',
    overdue:         'destructive',
    pending:     'warning',
    active:      'success',
    inactive:    'secondary',
  };
  return map[status] ?? 'secondary';
}

export { Badge, badgeVariants };
