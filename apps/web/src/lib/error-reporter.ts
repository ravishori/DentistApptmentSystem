/** Singleton queue — prevents spamming the API if errors cascade */
const SENT = new Set<string>();

export interface ClientError {
  message:         string;
  stack?:          string;
  componentStack?: string;
  level?:          'error' | 'warning' | 'fatal';
  context?:        string;
  extra?:          Record<string, unknown>;
}

/**
 * reportClientError — sends a frontend error to the API's /errors endpoint.
 * Silently swallows fetch failures so error reporting never breaks the app.
 *
 * Returns an event ID that can be shown to the user for support tickets.
 */
export async function reportClientError(err: ClientError): Promise<string | null> {
  // Deduplicate identical errors within the same page session
  const key = `${err.context}::${err.message}`;
  if (SENT.has(key)) return null;
  SENT.add(key);

  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

  try {
    const res = await fetch(`${baseUrl}/errors/client`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message:         err.message,
        stack:           err.stack,
        componentStack:  err.componentStack,
        level:           err.level ?? 'error',
        context:         err.context,
        extra:           err.extra,
        url:             typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent:       typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        timestamp:       new Date().toISOString(),
      }),
      // Short timeout — don't block user interaction
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return data?.data?.eventId ?? null;
    }
  } catch {
    // Swallow — error reporting must never throw
  }
  return null;
}

/** Hook unhandled promise rejections and uncaught JS errors. Call once in root layout. */
export function installGlobalErrorHandlers() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    reportClientError({
      message: event.message,
      stack:   event.error?.stack,
      level:   'error',
      context: 'window.onerror',
      extra:   { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const err = event.reason;
    reportClientError({
      message: err?.message ?? String(err),
      stack:   err?.stack,
      level:   'error',
      context: 'unhandledrejection',
    });
  });
}
