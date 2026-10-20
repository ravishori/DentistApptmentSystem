import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { OpsController } from './ops.controller';
import { HealthService, InfraHealthMonitor } from './health.service';

// MetricsService and ErrorEmailService come from the @Global() LoggerModule (one instance each: one SMTP transport,
// one de-duplication table, one set of counters).
@Module({
  controllers: [HealthController, OpsController],
  providers: [HealthService, InfraHealthMonitor],
  exports: [HealthService],
})
export class ObservabilityModule {}
