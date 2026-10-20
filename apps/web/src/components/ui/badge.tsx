import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:     'bg-blue-100 text-blue-800',
        secondary:   'bg-slate-100 text-slate-700',
        destructive: 'bg-red-100 text-red-700',
        success:     'bg-emerald-100 text-emerald-800',
        warning:     'bg-amber-100 text-amber-800',
        info:        'bg-sky-100 text-sky-800',
        purple:      'bg-purple-100 text-purple-800',
        teal:        'bg-teal-100 text-teal-800',
        orange:      'bg-orange-100 text-orange-700',
        outline:     'border border-slate-300 text-slate-700 bg-transparent',
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
