/**
 * Shared API error parsing. Pure TypeScript with no framework imports so it can be unit tested (the API workspace's
 * Jest suite imports this file) and reused by every page.
 *
 * It understands the server error contract { success:false, statusCode, message, error:{ code, message, requestId,
 * details?, retryable?, retryAfterSeconds? }, requestId } and every transport failure axios can produce, and always
 * returns text that is safe to show: server wording is used only for 4xx; for 5xx / network problems the text is ours.
 * It never throws and never turns a failure into a success.
 */

export type ApiErrorKind =
  | 'network' | 'timeout' | 'validation' | 'unauthenticated' | 'forbidden' | 'not_found'
  | 'conflict' | 'rate_limited' | 'unavailable' | 'server' | 'client_error' | 'unknown';

export interface FieldIssue { field: string; message: string }

export interface ApiErrorInfo {
  kind: ApiErrorKind;
  status?: number;
  /** Stable server error code when present (e.g. DB_UNAVAILABLE, VALIDATION_FAILED). */
  code?: string;
  /** Safe, actionable, user-facing text. */
  message: string;
  /** Correlation id to quote to support. */
  requestId?: string;
  details: FieldIssue[];
  retryable: boolean;
  retryAfterSeconds?: number;
}

const MESSAGES: Record<ApiErrorKind, string> = {
  network: 'Cannot reach the server. Check your internet connection and try again.',
  timeout: 'The server took too long to respond. Please try again.',
  validation: 'Some of the information is not valid. Please check the highlighted fields.',
  unauthenticated: 'Your session has expired. Please sign in again.',
  forbidden: 'You do not have permission to do this.',
  not_found: 'We could not find what you were looking for.',
  conflict: 'This conflicts with existing data. Refresh and try again.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  unavailable: 'The service is temporarily unavailable. Please try again in a few moments.',
  server: 'Something went wrong on our side. Please try again; if it keeps happening contact support.',
  client_error: 'The request could not be completed.',
  unknown: 'Something unexpected happened. Please try again.',
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/;
const asString = (v: unknown) => (typeof v === 'string' ? v : undefined);
const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

function kindFromStatus(status: number): ApiErrorKind {
  if (status === 400 || status === 422) return 'validation';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status === 502 || status === 503 || status === 504) return 'unavailable';
  if (status >= 500) return 'server';
  return status >= 400 ? 'client_error' : 'unknown';
}

/** Accepts an axios error, a fetch Response-like object, an Error, or anything thrown. */
export function parseApiError(err: unknown): ApiErrorInfo {
  try {
    const e = err as {
      code?: string; name?: string; message?: string; response?: { status?: number; data?: unknown; headers?: Record<string, unknown> };
      request?: unknown; isAxiosError?: boolean;
    } | null | undefined;
    if (!e || typeof e !== 'object') return { kind: 'unknown', message: MESSAGES.unknown, details: [], retryable: true };

    const res = e.response;
    if (!res) {
      const timeout = e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || e.name === 'TimeoutError' || /timeout/i.test(e.message ?? '');
      const net = e.isAxiosError || e.request !== undefined || e.code === 'ERR_NETWORK' || /network/i.test(e.message ?? '');
      const kind: ApiErrorKind = timeout ? 'timeout' : net ? 'network' : 'unknown';
      return { kind, message: MESSAGES[kind], details: [], retryable: true };
    }

    const status = typeof res.status === 'number' ? res.status : undefined;
    const body = (res.data && typeof res.data === 'object' ? res.data : {}) as Record<string, any>;
    const env = (body.error && typeof body.error === 'object' ? body.error : {}) as Record<string, any>;
    const code = asString(env.code);
    const requestId = [env.requestId, body.requestId, res.headers?.['x-request-id']].map(asString).find((v) => v && SAFE_ID.test(v));
    const kind = status !== undefined ? kindFromStatus(status) : 'unknown';

    // Server wording is shown only for client errors (it is authored to be safe there); never for 5xx.
    let message = MESSAGES[kind];
    if (status !== undefined && status >= 400 && status < 500 && kind !== 'rate_limited' && kind !== 'unauthenticated') {
      const m = env.message ?? body.message;
      const text = Array.isArray(m) ? m.map(String).filter(Boolean).slice(0, 3).join(' · ') : asString(m);
      if (text) message = clip(text);
    }

    const rawDetails = Array.isArray(env.details) ? env.details : [];
    const details: FieldIssue[] = rawDetails
      .filter((d: any) => d && typeof d === 'object')
      .slice(0, 50)
      .map((d: any) => ({ field: clip(String(d.field ?? '_'), 80), message: clip(String(d.message ?? ''), 200) }));

    const retryAfterHeader = Number(res.headers?.['retry-after']);
    const retryAfterSeconds = Number.isFinite(Number(env.retryAfterSeconds)) && env.retryAfterSeconds > 0 ? Number(env.retryAfterSeconds)
      : Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : undefined;

    return {
      kind, status, code, message, requestId, details,
      retryable: typeof env.retryable === 'boolean' ? env.retryable : kind === 'unavailable' || kind === 'server' || kind === 'rate_limited',
      retryAfterSeconds,
    };
  } catch {
    return { kind: 'unknown', message: MESSAGES.unknown, details: [], retryable: true };
  }
}

/** One-line message suitable for a toast, with the support reference appended when there is one. */
export function describeApiError(err: unknown, fallback?: string): string {
  const info = parseApiError(err);
  const base = info.kind === 'unknown' && fallback ? fallback : info.message;
  const wait = info.retryAfterSeconds ? ` Try again in ${info.retryAfterSeconds}s.` : '';
  return `${base}${wait}${info.requestId ? ` (ref ${info.requestId.slice(0, 8)})` : ''}`;
}

/** Whether react-query should retry: only for transient failures, at most twice, never for 4xx or mutations. */
export function shouldRetryQuery(failureCount: number, err: unknown): boolean {
  if (failureCount >= 2) return false;
  const i = parseApiError(err);
  if (i.status !== undefined && i.status >= 400 && i.status < 500 && i.status !== 429) return false;
  return i.kind === 'network' || i.kind === 'timeout' || i.kind === 'unavailable' || i.kind === 'server' || i.kind === 'rate_limited';
}

/** Group field issues by field for forms: { email: ['email must be an email'] }. */
export function fieldErrors(info: ApiErrorInfo): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of info.details) (out[d.field] ??= []).push(d.message);
  return out;
}

/** A guard that ignores re-entrant calls while one is running (double-click / double-submit protection). */
export function createSubmitGuard() {
  let pending = false;
  return {
    get pending() { return pending; },
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (pending) return undefined;
      pending = true;
      try { return await fn(); } finally { pending = false; }
    },
  };
}

export const newRequestId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
