import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { RevenueController } from './revenue/revenue.controller';
import { RevenueAccessService } from './revenue/revenue-access.service';
import { RevenueAccessGuard } from './revenue/revenue-access.guard';
import { RevenueAnalyticsService } from './revenue/revenue-analytics.service';

@Module({
  imports:     [PrismaModule],
  controllers: [AnalyticsController, RevenueController],
  providers:   [AnalyticsService, RevenueAccessService, RevenueAccessGuard, RevenueAnalyticsService],
  exports:     [AnalyticsService, RevenueAccessService],
})
export class AnalyticsModule {}
