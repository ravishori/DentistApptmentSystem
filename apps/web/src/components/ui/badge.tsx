import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { CheckCircle2, CircleDashed, Clock, Loader2, RefreshCw, Send, XCircle, MinusCircle, AlertTriangle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:     'bg-primary/10 text-brand-text',
        secondary:   'bg-secondary text-secondary-foreground',
        destructive: 'bg-destructive/10 text-destructive',
        success:     'bg-success/10 text-success',
        warning:     'bg-warning/15 text-warning',
        info:        'bg-info/10 text-info',
        purple:      'bg-chart-3/15 text-foreground',
        teal:        'bg-chart-6/15 text-foreground',
        orange:      'bg-chart-4/15 text-foreground',
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

// Status is never conveyed by colour alone: every status gets its own icon + a text label.
const STATUS_ICON: Record<string, React.ElementType> = {
  scheduled: Clock, confirmed: CheckCircle2, in_progress: Loader2, completed: CheckCircle2, cancelled: XCircle,
  no_show: MinusCircle, rescheduled: RefreshCw, draft: FileText, sent: Send, partial: CircleDashed,
  partially_paid: CircleDashed, paid: CheckCircle2, overdue: AlertTriangle, pending: Clock, active: CheckCircle2,
  inactive: MinusCircle,
};

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const key = status ?? '';
  const Icon = STATUS_ICON[key] ?? CircleDashed;
  return (
    <Badge variant={statusVariant(key)} className={cn('capitalize', className)} data-status={key}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {key.replace(/_/g, ' ') || 'unknown'}
    </Badge>
  );
}

export { Badge, badgeVariants };
