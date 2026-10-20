import type { ErrorEmailService } from '../logger/error-email.service';
import type { MetricsService } from './metrics.service';
import { logEvent } from './structured-logger';
import { sanitizeStack, summariseError } from './redaction';

interface Deps {
  alerts?: Pick<ErrorEmailService, 'report' | 'flush'>;
  metrics?: Pick<MetricsService, 'inc'>;
  proc?: NodeJS.EventEmitter;
  exit?: (code: number) => void;
  flushMs?: number;
}

/**
 * Last line of defence for failures outside any request:
 *  - unhandledRejection: logged + counted + alerted; the process keeps running (a rejected promise is a bug to fix,
 *    but a single one must not drop every in-flight clinic request).
 *  - uncaughtException: logged + alerted, a bounded flush of the alert queue, then exit(1) so the supervisor restarts a
 *    clean process (state after an uncaught exception is undefined).
 * Handlers are re-entrancy safe and never throw; an alert failure cannot trigger another alert.
 */
export function installProcessHandlers(deps: Deps = {}): () => void {
  const proc = deps.proc ?? process;
  const exit = deps.exit ?? ((c: number) => process.exit(c));
  let handling = false;

  const onRejection = (reason: unknown) => {
    try {
      deps.metrics?.inc('unhandled_rejections_total');
      const s = summariseError(reason);
      logEvent('error', 'process.unhandled_rejection', { error: s, stack: sanitizeStack(reason instanceof Error ? reason.stack : undefined) });
      deps.alerts?.report({ severity: 'error', code: 'UNHANDLED_REJECTION', subsystem: 'internal', summary: `Unhandled promise rejection (${s.name})`, discriminator: s.name });
    } catch { /* never throw from a process handler */ }
  };

  const onException = (err: unknown) => {
    if (handling) return;
    handling = true;
    try {
      deps.metrics?.inc('uncaught_exceptions_total');
      const s = summariseError(err);
      logEvent('error', 'process.uncaught_exception', { error: s, stack: sanitizeStack(err instanceof Error ? err.stack : undefined), action: 'exiting after bounded alert flush' });
      deps.alerts?.report({ severity: 'critical', code: 'UNCAUGHT_EXCEPTION', subsystem: 'internal', summary: `Uncaught exception (${s.name}); process is exiting`, discriminator: s.name });
    } catch { /* fall through to exit */ }
    Promise.resolve(deps.alerts?.flush(deps.flushMs ?? 3000)).catch(() => undefined).finally(() => exit(1));
  };

  proc.on('unhandledRejection', onRejection);
  proc.on('uncaughtException', onException);
  return () => { proc.off('unhandledRejection', onRejection); proc.off('uncaughtException', onException); };
}
