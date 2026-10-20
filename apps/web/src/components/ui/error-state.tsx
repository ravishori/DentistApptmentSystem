'use client';

import * as React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ApiErrorInfo, parseApiError } from '@/lib/api-error';

interface ErrorStateProps {
  /** Anything a failed request threw; parsed into safe text. */
  error?: unknown;
  title?: string;
  /** Overrides the parsed message. */
  message?: string;
  /** Support reference (request id / event id) when there is no `error`. */
  reference?: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * The one failure UI for data that could not be loaded. Failed requests must render THIS, never an empty list
 * ("No patients yet") that looks like a successful empty result. Shows a safe message, the support reference and
 * a retry action; never shows server internals.
 */
export function ErrorState({ error, title, message, reference, onRetry, retrying, compact, className }: ErrorStateProps) {
  const info: ApiErrorInfo | undefined = error !== undefined ? parseApiError(error) : undefined;
  const ref = info?.requestId ?? reference;
  const text = message ?? info?.message ?? 'Something went wrong. Please try again.';
  const wait = info?.retryAfterSeconds ? ` Please wait about ${info.retryAfterSeconds}s before retrying.` : '';
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-3 text-center', compact ? 'px-4 py-8' : 'px-6 py-14', className)}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600" aria-hidden="true">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title ?? 'We could not load this'}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{text}{wait}</p>
        {ref && <p className="text-xs text-muted-foreground">Reference for support: <code className="select-all">{ref}</code></p>}
      </div>
      {onRetry && (info?.retryable ?? true) && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', retrying && 'animate-spin')} />
          {retrying ? 'Retrying…' : 'Try again'}
        </Button>
      )}
    </div>
  );
}
