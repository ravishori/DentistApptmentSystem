import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { Roles } from '../decorators/roles.decorator';
import { ErrorEmailService } from '../logger/error-email.service';
import { MetricsService } from './metrics.service';
import { getRequestId } from './context-store';

/**
 * Platform-operator endpoints. super_admin only: clinic admins are tenants, not operators of the platform alert channel.
 */
@ApiTags('Ops')
@ApiBearerAuth()
@Roles(UserRole.super_admin)
@Controller({ path: 'ops', version: '1' })
export class OpsController {
  constructor(private readonly alerts: ErrorEmailService, private readonly metrics: MetricsService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'In-process counters, gauges and latency (JSON). Add ?format=prometheus for text exposition.' })
  getMetrics(@Query('format') format?: string) {
    return format === 'prometheus' ? { format: 'prometheus', text: this.metrics.toPrometheus() } : this.metrics.snapshot();
  }

  @Get('alerts/status')
  @ApiOperation({ summary: 'Alert channel status: configured?, queue depth, last SMTP acceptance / failure (no addresses or secrets)' })
  async alertStatus(@Query('verify') verify?: string) {
    return { ...this.alerts.getStatus(), ...(verify === 'true' ? { smtpConnection: await this.alerts.verifyConnection() } : {}) };
  }

  @Post('alerts/test')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a clearly labelled TEST alert. ?wait=true waits (max 20 s) for the SMTP result.' })
  async testAlert(@Query('wait') wait?: string) {
    const ticket = this.alerts.report({
      severity: 'warning', kind: 'test', code: 'TEST_ALERT', subsystem: 'ops',
      summary: 'Test alert requested by a platform administrator. No action required.', requestId: getRequestId(),
    });
    if (wait !== 'true' || ticket.outcome !== 'queued' || !ticket.result) return { outcome: ticket.outcome, reason: ticket.reason, alertId: ticket.id };
    let timer: NodeJS.Timeout | undefined;
    const settled = await Promise.race([
      ticket.result,
      new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), 20_000); timer.unref?.(); }),
    ]);
    if (timer) clearTimeout(timer);
    return settled === 'timeout'
      ? { outcome: 'queued', alertId: ticket.id, note: 'still being delivered after 20 s; check GET /ops/alerts/status' }
      : { outcome: settled.state, attempts: settled.attempts, alertId: ticket.id, reason: settled.reason, note: 'smtp_accepted means the SMTP server accepted the message; confirm receipt in the recipient mailbox' };
  }
}
