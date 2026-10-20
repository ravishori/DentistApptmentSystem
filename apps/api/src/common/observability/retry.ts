/**
 * Bounded retry with exponential backoff and full jitter, for IDEMPOTENT work only (health probes, reads, alert
 * delivery). It is deliberately not used for database writes or payment/provider calls: retrying those blindly can
 * duplicate side effects. Callers choose `isRetryable`; the default never retries.
 */
export interface RetryOptions {
  attempts: number;                 // total tries (>= 1)
  baseDelayMs: number;
  maxDelayMs?: number;
  isRetryable?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export const backoffDelay = (attempt: number, base: number, max = 30_000, random = Math.random): number =>
  Math.round(random() * Math.min(max, base * 2 ** (attempt - 1)));

export async function retryBounded<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const attempts = Math.max(1, Math.min(opts.attempts, 10));
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await fn(attempt); } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !(opts.isRetryable?.(err) ?? false)) throw err;
      const delay = backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs, opts.random);
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Reject if `fn` does not settle within `ms`; the underlying work is not cancelled, so only use for probes. */
export function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(`${label} timed out after ${ms}ms`), { code: 'ETIMEDOUT' })), ms); t.unref?.(); });
  // The abandoned work may still reject after the timeout wins the race; swallow that late rejection (it would otherwise
  // surface as an unhandledRejection and raise a spurious process-level alert).
  p.catch(() => undefined);
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}
