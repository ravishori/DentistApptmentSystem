import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Inline spinner. `label` is announced to screen readers. */
export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Centered loading block for a page or section while data loads. */
export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground', className)}
      aria-busy="true"
    >
      <Spinner className="h-6 w-6" label={label} />
      <span aria-hidden="true">{label}</span>
    </div>
  );
}
