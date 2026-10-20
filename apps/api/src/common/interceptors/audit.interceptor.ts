import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AppRequest } from '../types/request.types';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const METHOD_TO_ACTION: Record<string, AuditAction> = {
  POST:   AuditAction.create,
  PUT:    AuditAction.update,
  PATCH:  AuditAction.update,
  DELETE: AuditAction.delete,
};

/**
 * AuditInterceptor — persists an immutable audit log for every state-changing
 * request. Fires after the handler resolves so it captures the outcome.
 *
 * Stored in the `AuditLog` Prisma model (append-only — no updates/deletes).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req: AppRequest = ctx.switchToHttp().getRequest();

    if (!MUTATING.has(req.method)) return next.handle();

    const startMs = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          this.writeLog(req, responseBody, null, Date.now() - startMs).catch(
            (e) => this.logger.warn(`Audit log write failed: ${e.message}`),
          );
        },
        error: (err) => {
          this.writeLog(req, null, err, Date.now() - startMs).catch(
            (e) => this.logger.warn(`Audit log write failed: ${e.message}`),
          );
        },
      }),
    );
  }

  private async writeLog(
    req:        AppRequest,
    response:   any,
    error:      any,
    durationMs: number,
  ) {
    const userId   = req.user?.id   ?? null;
    const clinicId = req.clinicId   ?? req.user?.clinicId ?? null;

    // Extract resource type + ID from URL: /v1/patients/<uuid> → patients, uuid
    const parts      = req.path.replace(/^\/v\d+\//, '').split('/');
    const entityType = parts[0] ?? 'unknown';
    const entityId   = this.isUuid(parts[1] ?? '') ? parts[1] : null;

    const action = METHOD_TO_ACTION[req.method] ?? AuditAction.create;

    await this.prisma.auditLog.create({
      data: {
        userId,
        clinicId,
        action,
        entityType,
        entityId,
        newData: this.sanitiseBody(req.body),
        ipAddress: this.getIp(req),
        userAgent: req.headers['user-agent'] ?? null,
        meta: {
          endpoint:     req.path,
          statusCode:   error ? (error.status ?? 500) : 200,
          errorMessage: error?.message ?? null,
          durationMs,
          requestId: (req as any).requestId ?? null,
        },
      },
    });
  }

  private getIp(req: AppRequest): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.socket?.remoteAddress ?? 'unknown';
  }

  private isUuid(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  }

  /** Strip sensitive fields before persisting to audit log. */
  private sanitiseBody(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const REDACTED = ['password', 'passwordHash', 'token', 'refreshToken', 'cardNumber', 'cvv'];
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(body)) {
      clean[k] = REDACTED.some((f) => k.toLowerCase().includes(f)) ? '[REDACTED]' : v;
    }
    return clean;
  }
}
