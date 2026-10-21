/**
 * The one rule for what a data section shows. Pure TypeScript (no React) so it is unit tested directly.
 *
 *   error   : the request failed and there is nothing to show        -> error state with reference + retry
 *   loading : first load in flight                                   -> skeleton
 *   empty   : the request SUCCEEDED and returned nothing             -> empty state
 *   ready   : data present (a failed background refresh still shows the data, plus a "could not refresh" notice)
 *
 * A failed request is never `empty`: that was the bug where an outage looked like "No patients yet".
 */
export type ViewState = 'loading' | 'error' | 'empty' | 'ready';

export interface QueryLike<T = unknown> {
  data?: T;
  isError: boolean;
  error?: unknown;
  isLoading?: boolean;
  isPending?: boolean;
  isFetching?: boolean;
  refetch?: () => unknown;
}

export function viewState<T>(q: QueryLike<T>, isEmpty?: (data: T) => boolean): ViewState {
  if (q.data === undefined) return q.isError ? 'error' : 'loading';
  if (isEmpty?.(q.data)) return 'empty';
  return 'ready';
}

/** True when data is on screen but the latest refresh failed (so the figures may be out of date). */
export const isStale = <T,>(q: QueryLike<T>): boolean => q.isError && q.data !== undefined;

/** Combine several queries for one section: the first failure is reported, and retry refetches only the failed ones. */
export function groupState(queries: QueryLike[]): { failed: QueryLike[]; error?: unknown; retry: () => void; fetching: boolean } {
  const failed = queries.filter((q) => q.isError && q.data === undefined);
  return {
    failed,
    error: failed[0]?.error,
    retry: () => { for (const q of failed) q.refetch?.(); },
    fetching: failed.some((q) => !!q.isFetching),
  };
}
