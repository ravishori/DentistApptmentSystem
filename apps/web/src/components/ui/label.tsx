'use client';
import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

export interface LabelProps extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  required?: boolean;
}

const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <LabelPrimitive.Root
      ref={ref}
      className={cn('block text-sm font-medium leading-none text-foreground peer-disabled:opacity-60', className)}
      {...props}
    >
      {children}
      {required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
    </LabelPrimitive.Root>
  ),
);
Label.displayName = 'Label';

export { Label };
