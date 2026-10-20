import { Module } from '@nestjs/common';
import { TreatmentsService } from './treatments.service';
import { TreatmentsController } from './treatments.controller';

@Module({
  controllers: [TreatmentsController],
  providers:   [TreatmentsService],
  exports:     [TreatmentsService],
})
export class TreatmentsModule {}
