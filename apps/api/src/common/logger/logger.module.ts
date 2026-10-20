import { Global, Module } from '@nestjs/common';
import { ErrorEmailService } from './error-email.service';
import { MetricsService } from '../observability/metrics.service';

@Global()
@Module({
  providers: [MetricsService, ErrorEmailService],
  exports:   [MetricsService, ErrorEmailService],
})
export class LoggerModule {}
