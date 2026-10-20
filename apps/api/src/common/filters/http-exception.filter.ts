import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger, Inject, Optional,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ErrorEmailService } from '../logger/error-email.service';
import { winstonLogger } from '../logger/winston.logger';
import { AppRequest } from '../types/request.types';

const SERVER_ERRORS = new Set([500, 502, 503, 504]);
// Email these client errors too — useful for debugging auth flows in dev
const ALERT_4XX     = new Set([401, 403, 422]);

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(
    @Optional() @Inject(ErrorEmailService)
    private readonly emailService?: ErrorEmailService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<AppRequest>();
    const res = ctx.getResponse<Response>();

    let status:  number           = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let code:    string | undefined;

    // ── NestJS HttpException ────────────────────────────────────────────────────
    if (exception instanceof HttpException) {
      status  = exception.getStatus();
      const body = exception.getResponse();
      message = typeof body === 'object' ? (body as any).message : body;

    // ── Prisma known errors ─────────────────────────────────────────────────────
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      code = exception.code;
      if (code === 'P2002') {
        status  = HttpStatus.CONFLICT;
        const field = (exception.meta?.target as string[])?.join(', ');
        message = `Duplicate value for field: ${field}`;
      } else if (code === 'P2025') {
        status  = HttpStatus.NOT_FOUND;
        message = 'Record not found';
      } else {
        status  = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'Database error';
        winstonLogger.error(`Prisma ${code}: ${exception.message}`, {
          context: 'Prisma', meta: exception.meta,
        });
      }

    // ── Unknown / unhandled ─────────────────────────────────────────────────────
    } else {
      winstonLogger.error('Unhandled exception', {
        error: String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
        path:  req.url,
        method: req.method,
      });
    }

    // ── Always log to console with request context ───────────────────────────────
    winstonLogger.error(
      `${status} ${req.method} ${req.url} → ${typeof message === 'string' ? message : JSON.stringify(message)}`,
      { context: 'HttpExceptionFilter', userId: req.user?.id, clinicId: req.clinicId, prismaCode: code },
    );

    // ── Email alert for 5xx (always) and selected 4xx (in dev) ──────────────────
    const shouldEmail = SERVER_ERRORS.has(status) ||
                        (process.env.NODE_ENV !== 'production' && ALERT_4XX.has(status));
    if (shouldEmail && this.emailService) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.emailService.sendAlert({
        subject:  `${status} ${req.method} ${req.path}`,
        error:    err,
        context:  'HttpExceptionFilter',
        request: {
          method:   req.method,
          url:      req.url,
          ip:       this.getIp(req),
          userId:   req.user?.id,
          clinicId: req.clinicId,
        },
        extra: { prismaCode: code },
      }).catch(() => { /* swallow */ });
    }

    res.status(status).json({
      success:    false,
      statusCode: status,
      message,
      timestamp:  new Date().toISOString(),
      path:       req.url,
    });
  }

  private getIp(req: Request): string {
    const fwd = req.headers['x-forwarded-for'];
    return typeof fwd === 'string' ? fwd.split(',')[0].trim() : (req.socket?.remoteAddress ?? 'unknown');
  }
}
