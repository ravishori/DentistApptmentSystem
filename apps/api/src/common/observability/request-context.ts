import { randomUUID } from 'crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';
import { logEvent } from './structured-logger';
import { runWithRequestContext, RequestContext } from './context-store';
export { getRequestContext, getRequestId, setContextActor, runWithRequestContext } from './context-store';
export type { RequestContext } from './context-store';
import { templatePath } from './redaction';

/** Accept a caller-supplied correlation id only if it is short and harmless (no log injection, no giant values). */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/;
const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/i;

export const REQUEST_ID_HEADER = 'x-request-id';

export function resolveRequestId(header: unknown): string {
  const v = Array.isArray(header) ? header[0] : header;
  return typeof v === 'string' && SAFE_ID.test(v) ? v : randomUUID();
}

export function resolveTraceId(traceparent: unknown, fallback: string): string {
  const v = Array.isArray(traceparent) ? traceparent[0] : traceparent;
  const m = typeof v === 'string' ? TRACEPARENT.exec(v) : null;
  return m ? m[1].toLowerCase() : fallback;
}

const SLOW_MS = Number(process.env.SLOW_REQUEST_MS ?? 2000);

/**
 * First middleware in the chain: assigns/propagates the correlation id, exposes it to the client, makes it available to
 * every log line and service call through AsyncLocalStorage, and emits ONE access-log line + metrics per request
 * (covering successes, guard rejections, throttling and 404s — not only handler-level outcomes).
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    const traceId = resolveTraceId(req.headers['traceparent'], requestId);
    (req as Request & { requestId?: string }).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    const ctx = { requestId, traceId } as RequestContext;

    res.on('finish', () => runWithRequestContext(ctx, () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const anyReq = req as Request & { route?: { path?: string }; user?: { id?: string }; clinicId?: string };
      const route = anyReq.route?.path ? `${req.baseUrl ?? ''}${anyReq.route.path}` : 'unmatched';
      const status = res.statusCode;
      this.metrics.recordHttp(req.method, route === 'unmatched' ? 'unmatched' : templatePath(route), status, ms);
      logEvent(status >= 500 ? 'warn' : 'info', 'http.request', {
        method: req.method, route: route === 'unmatched' ? templatePath(req.originalUrl) : templatePath(route), status,
        durationMs: Math.round(ms), slow: ms > SLOW_MS || undefined,
        userId: anyReq.user?.id, clinicId: anyReq.clinicId,
      });
    }));

    runWithRequestContext(ctx, () => next());
  }
}
