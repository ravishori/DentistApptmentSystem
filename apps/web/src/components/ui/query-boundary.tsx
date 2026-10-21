'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryLike, isStale, viewState } from '@/lib/query-state';

interface QueryBoundaryProps<T> {
  query: QueryLike<T>;
  /** Decide, for SUCCESSFUL data only, whether it counts as empty. */
  isEmpty?: (data: T) => boolean;
  loading?: React.ReactNode;
  empty?: React.ReactNode;
  errorTitle?: string;
  compact?: boolean;
  children: (data: T) => React.ReactNode;
}

/** Shown above data when the latest refresh failed: the figures on screen may be out of date. */
export function StaleNotice({ onRetry, retrying }: { onRetry?: () => void; retrying?: boolean }) {
  return (
    <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <span>Could not refresh. Showing the last loaded data, which may be out of date.</span>
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={retrying} className="inline-flex items-center gap-1 font-medium underline disabled:opacity-60">
          <RefreshCw className={`h-3 w-3 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" /> Retry
        </button>
      )}
    </div>
  );
}

/**
 * Loading / error / empty / ready for one query. Use it for every list, chart and card that loads data so a failed
 * request can never be displayed as an empty result.
 */
export function QueryBoundary<T>({ query, isEmpty, loading, empty, errorTitle, compact = true, children }: QueryBoundaryProps<T>) {
  const state = viewState(query, isEmpty);
  if (state === 'loading') return <>{loading ?? <Skeleton className="h-32 w-full" />}</>;
  if (state === 'error') {
    return <ErrorState title={errorTitle ?? 'Could not load this section'} error={query.error} onRetry={() => { void query.refetch?.(); }} retrying={!!query.isFetching} compact={compact} />;
  }
  if (state === 'empty') return <>{empty ?? <EmptyState title="Nothing here yet" className="py-8" />}</>;
  return (
    <>
      {isStale(query) && <StaleNotice onRetry={() => { void query.refetch?.(); }} retrying={!!query.isFetching} />}
      {children(query.data as T)}
    </>
  );
}
