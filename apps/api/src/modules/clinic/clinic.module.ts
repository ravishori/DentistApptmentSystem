import { Module } from '@nestjs/common';
import { ClinicController } from './clinic.controller';
import { ClinicService } from './clinic.service';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports:     [AnalyticsModule],
  controllers: [ClinicController],
  providers:   [ClinicService],
  exports:     [ClinicService],
})
export class ClinicModule {}
