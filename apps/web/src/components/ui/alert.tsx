import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

const alertVariants = cva('relative flex gap-3 rounded-lg border p-3 text-sm', {
  variants: {
    variant: {
      info:        'border-info/30 bg-info/10 text-foreground [&>svg]:text-info',
      success:     'border-success/30 bg-success/10 text-foreground [&>svg]:text-success',
      warning:     'border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning',
      destructive: 'border-destructive/30 bg-destructive/10 text-foreground [&>svg]:text-destructive',
    },
  },
  defaultVariants: { variant: 'info' },
});

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  destructive: AlertCircle,
} as const;

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
}

/** Errors/warnings use role="alert" (announced immediately); info/success use role="status". */
export function Alert({ className, variant = 'info', title, children, ...props }: AlertProps) {
  const Icon = ICONS[variant ?? 'info'];
  return (
    <div
      role={variant === 'destructive' || variant === 'warning' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-semibold leading-snug">{title}</p>}
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
