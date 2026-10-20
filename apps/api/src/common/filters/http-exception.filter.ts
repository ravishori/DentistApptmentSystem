import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Inject, Optional } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorEmailService } from '../logger/error-email.service';
import { MetricsService } from '../observability/metrics.service';
import { classifyException, ClassifiedError, ErrorCode } from '../observability/error-classifier';
import { logEvent } from '../observability/structured-logger';
import { getRequestContext, getRequestId } from '../observability/context-store';
import { sanitizeStack, summariseError, templatePath } from '../observability/redaction';

/**
 * The ONE place where a failed request is turned into (a) an HTTP response, (b) a log record, (c) metrics and (d) an
 * administrator alert. Everything is derived from `classifyException`, so clients never see stack traces, SQL,
 * connection details, file paths or raw provider errors.
 *
 * Response contract (documented in docs/OBSERVABILITY.md). Existing top-level fields are kept for compatibility
 * (`success`, `statusCode`, `message`, `timestamp`, `path`); `error` and `requestId` are additive:
 *   { success:false, statusCode, message, error:{ code, message, requestId, details?, retryable, retryAfterSeconds? },
 *     requestId, timestamp, path }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  /** An exception object is logged once, even if several layers re-throw it. */
  private readonly logged = new WeakSet<object>();

  constructor(
    @Optional() @Inject(ErrorEmailService) private readonly alerts?: ErrorEmailService,
    @Optional() @Inject(MetricsService) private readonly metrics?: MetricsService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;               // only HTTP is handled here
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { requestId?: string; clinicId?: string; user?: { id?: string } }>();
    const res = http.getResponse<Response>();

    let c: ClassifiedError;
    try { c = classifyException(exception); } catch {
      c = { status: 500, code: ErrorCode.INTERNAL_ERROR, message: 'Something went wrong on our side.', retryable: false, severity: 'error', subsystem: 'internal', alert: true, cause: { name: 'ClassificationFailure', message: '' } };
    }
    const requestId = req.requestId ?? getRequestId() ?? 'unknown';
    const route = templatePath(req.originalUrl ?? req.url);

    try {
      this.record(exception, c, req, route, requestId);
    } catch { /* observability must never prevent the response */ }

    if (res.headersSent) return;
    if (c.retryAfterSeconds && (c.status === 429 || c.status === 503)) res.setHeader('Retry-After', String(c.retryAfterSeconds));
    res.setHeader('X-Request-Id', requestId);
    res.status(c.status).json({
      success: false,
      statusCode: c.status,
      message: c.message,
      error: {
        code: c.code, message: c.message, requestId,
        ...(c.details?.length ? { details: c.details } : {}),
        retryable: c.retryable,
        ...(c.retryAfterSeconds ? { retryAfterSeconds: c.retryAfterSeconds } : {}),
      },
      requestId,
      timestamp: new Date().toISOString(),
      path: (req.originalUrl ?? req.url ?? '').split('?')[0],
    });
  }

  private record(exception: unknown, c: ClassifiedError, req: Request & { clinicId?: string; user?: { id?: string } }, route: string, requestId: string) {
    this.metrics?.inc('errors_total', { code: c.code, status_class: `${Math.floor(c.status / 100)}xx` });

    const already = typeof exception === 'object' && exception !== null && this.logged.has(exception);
    if (!already) {
      if (typeof exception === 'object' && exception !== null) this.logged.add(exception);
      const server = c.status >= 500;
      const isPrisma = /^PrismaClient/.test(c.cause.name);
      logEvent(server ? 'error' : c.status === 401 || c.status === 403 || c.status === 429 ? 'warn' : 'info', 'http.error', {
        status: c.status, errorCode: c.code, subsystem: c.subsystem, method: req.method, route,
        userId: req.user?.id, clinicId: req.clinicId ?? getRequestContext()?.clinicId,
        // 5xx only: what was actually thrown. Prisma messages embed query arguments (patient data), so only name+code are kept.
        ...(server ? { cause: isPrisma ? { name: c.cause.name, code: c.cause.code } : c.cause, stack: isPrisma ? undefined : sanitizeStack(exception instanceof Error ? exception.stack : undefined) } : {}),
      });
    }

    if (c.alert && this.alerts) {
      // Summary deliberately omits the exception message (it may contain data); name + code are enough to find the log line.
      const s = summariseError(exception);
      this.alerts.report({
        severity: c.severity === 'critical' ? 'critical' : 'error', code: c.code, subsystem: c.subsystem,
        summary: `${req.method} ${route} -> ${c.status} ${c.code} (${s.name}${s.code ? ` ${s.code}` : ''})`,
        route, requestId, clinicId: req.clinicId, discriminator: s.name,
      });
    }
  }
}

export { HttpStatus };
