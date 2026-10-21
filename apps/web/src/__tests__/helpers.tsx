import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** A client that never retries or refetches on mount, so a cached ERROR stays an error during server rendering. */
export const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, refetchOnMount: false, staleTime: Infinity } } });

export const html = (ui: React.ReactElement, qc: QueryClient) =>
  renderToStaticMarkup(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);

/** What axios throws for an HTTP error response (the shape parseApiError understands). */
export const httpError = (status: number, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  ({ isAxiosError: true, message: `Request failed with status code ${status}`, response: { status, data: body, headers } });

export const unavailable503 = () => httpError(503, {
  success: false, statusCode: 503, message: 'The database is temporarily unavailable.',
  error: { code: 'DB_UNAVAILABLE', message: 'The database is temporarily unavailable.', requestId: 'req-ref-12345', retryable: true, retryAfterSeconds: 5 }, requestId: 'req-ref-12345',
});
export const networkDown = () => ({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error', request: {} });
/** A 500 whose body tries to leak internals: the UI must never show any of it. */
export const leaky500 = () => httpError(500, { message: 'PrismaClientKnownRequestError: SELECT * FROM patients WHERE name = Asha Rao at C:\\app\\x.ts', error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.', requestId: 'req-leak-12345' } });

type Key = readonly unknown[];
const keyOf = (q: { queryKey: Key }) => q.queryKey;

/**
 * Put every query that a first render registered (optionally only those whose key matches) into the ERROR state, as
 * if its request had failed. Rendering again then shows what the user would see after the failure.
 */
export function failQueries(qc: QueryClient, error: unknown, match: (key: Key) => boolean = () => true) {
  for (const q of qc.getQueryCache().getAll()) {
    if (!match(keyOf(q))) continue;
    q.setState({ status: 'error', error, fetchStatus: 'idle', data: undefined, dataUpdatedAt: 0, errorUpdatedAt: Date.now(), errorUpdateCount: 1, fetchFailureCount: 1, fetchFailureReason: error } as never);
  }
}

/** Mark matching queries as successfully loaded with `data` (including genuinely empty data such as [] or {items: []}). */
export function succeedQueries(qc: QueryClient, data: unknown, match: (key: Key) => boolean) {
  for (const q of qc.getQueryCache().getAll()) if (match(keyOf(q))) qc.setQueryData(q.queryKey, data);
}

export const hasAlert = (markup: string) => markup.includes('role="alert"');
