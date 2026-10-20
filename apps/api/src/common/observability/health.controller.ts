import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../decorators/public.decorator';
import { SkipTransform } from '../decorators/skip-transform.decorator';
import { HealthService } from './health.service';

/**
 * Orchestrator probes. Public by design and deliberately minimal: up/down per dependency, nothing else
 * (no versions, hosts, error text). Use `live` for restart decisions and `ready` for traffic routing.
 */
@ApiTags('Health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @Public()
  @SkipTransform()
  @ApiOperation({ summary: 'Process is running (does not touch dependencies)' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @Public()
  @SkipTransform()
  @ApiOperation({ summary: 'Ready to serve: 200 when the database answers, 503 when it does not' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const r = await this.health.readiness();
    if (r.status === 'unavailable') { res.status(503); res.setHeader('Retry-After', '5'); }
    res.setHeader('Cache-Control', 'no-store');
    return { ...r, timestamp: new Date().toISOString() };
  }
}
