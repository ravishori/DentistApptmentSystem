import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsOptional, IsIn, MaxLength } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { KeepRaw } from '../../common/validators/keep-raw';
import { ErrorEmailService } from '../../common/logger/error-email.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { logEvent } from '../../common/observability/structured-logger';
import { getRequestId } from '../../common/observability/context-store';
import { sanitizeStack, sanitizeText, templatePath } from '../../common/observability/redaction';
import { randomUUID } from 'crypto';

/**
 * Browser-side error report. PUBLIC and unauthenticated, therefore hardened:
 *  - field whitelist with hard length caps (no free-form `extra`, no response bodies),
 *  - everything is scrubbed (tokens, e-mails, phone numbers, URLs lose their query string),
 *  - tightly rate limited per client,
 *  - NEVER awaited by the e-mail path (a slow SMTP server cannot slow this endpoint) and only `fatal` reports can become
 *    administrator alerts, de-duplicated and hourly-capped by ErrorEmailService.
 */
class ClientErrorDto {
  @KeepRaw() @IsString() @MaxLength(500) message!: string;
  @IsOptional() @KeepRaw() @IsString() @MaxLength(4000) stack?: string;
  @IsOptional() @KeepRaw() @IsString() @MaxLength(4000) componentStack?: string;
  @IsOptional() @IsIn(['error', 'warning', 'fatal']) level?: string;
  @IsOptional() @KeepRaw() @IsString() @MaxLength(100) context?: string;
  @IsOptional() @KeepRaw() @IsString() @MaxLength(500) url?: string;
  @IsOptional() @KeepRaw() @IsString() @MaxLength(64) requestId?: string;
}

@ApiTags('Errors')
@Controller({ path: 'errors', version: '1' })
export class ErrorsController {
  constructor(private readonly alerts: ErrorEmailService, private readonly metrics: MetricsService) {}

  @Post('client')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive a frontend client error (rate limited; sanitised; never blocks on e-mail)' })
  receiveClientError(@Body() dto: ClientErrorDto) {
    const eventId = randomUUID();
    const level = dto.level ?? 'error';
    const page = templatePath((dto.url ?? '').replace(/^https?:\/\/[^/]+/i, ''));
    this.metrics.inc('client_errors_total', { level });
    logEvent(level === 'warning' ? 'warn' : 'error', 'client.error', {
      eventId, level, context: sanitizeText(dto.context, 100), page,
      message: sanitizeText(dto.message, 300), stack: sanitizeStack(dto.stack, 6), componentStack: sanitizeStack(dto.componentStack, 4),
      clientRequestId: dto.requestId ? sanitizeText(dto.requestId, 64) : undefined,
    });
    if (level === 'fatal') {
      this.alerts.report({
        severity: 'error', code: 'CLIENT_FATAL_ERROR', subsystem: 'frontend', route: page,
        summary: sanitizeText(dto.message, 160), requestId: dto.requestId ? sanitizeText(dto.requestId, 64) : getRequestId(),
        discriminator: sanitizeText(dto.message, 60),
      });
    }
    return { eventId, requestId: getRequestId() };
  }
}
