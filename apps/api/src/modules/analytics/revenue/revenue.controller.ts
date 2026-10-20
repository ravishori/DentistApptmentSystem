import {
  Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { IsStrictBoolean } from '../../../common/validators/strict-boolean';
import { UserRole } from '@prisma/client';
import { AppRequest } from '../../../common/types/request.types';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RevenueAccessGuard } from './revenue-access.guard';
import { RevenueAccessService } from './revenue-access.service';
import { RevenueAnalyticsService } from './revenue-analytics.service';

export class RevenueTrendQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(36) @IsOptional() months?: number;
}
export class DashboardPreferenceDto {
  @IsStrictBoolean() showOnDashboard: boolean;
}
export class SetRevenueAccessDto {
  @IsStrictBoolean() granted: boolean;
}

/**
 * Private revenue analytics. Nothing here is @Public(); every handler derives the clinic from the
 * verified token (never from the request body/query), so data cannot cross clinics.
 */
@ApiTags('Analytics')
@ApiBearerAuth()
@Controller({ path: 'analytics/revenue', version: '1' })
export class RevenueController {
  constructor(
    private readonly access:   RevenueAccessService,
    private readonly analytics: RevenueAnalyticsService,
  ) {}

  private viewer(req: AppRequest) {
    return { id: req.user.id, role: req.user.role, clinicId: req.user.clinicId };
  }

  /** Capability probe for the UI. Returns NO financial data, so any authenticated staff member may call it. */
  @Get('access/me')
  @ApiOperation({ summary: 'Can I see revenue analytics / manage access / is the widget on my dashboard?' })
  async me(@Req() req: AppRequest) {
    const v = this.viewer(req);
    const canView = await this.access.canView(v);
    return {
      canView,
      canManage:       this.access.canManage(v),
      showOnDashboard: canView ? await this.access.showOnDashboard(v) : false,
    };
  }

  @Get('trend')
  @UseGuards(RevenueAccessGuard)
  @ApiOperation({ summary: 'Collected vs refunded vs outstanding, per month, for my clinic' })
  trend(@Req() req: AppRequest, @Query() q: RevenueTrendQueryDto) {
    return this.analytics.getTrend(req.user.clinicId, q.months);
  }

  @Put('preference')
  @UseGuards(RevenueAccessGuard)
  @ApiOperation({ summary: 'Show or hide the Revenue Trend widget on MY dashboard' })
  async preference(@Req() req: AppRequest, @Body() dto: DashboardPreferenceDto) {
    await this.access.setDashboardPreference(this.viewer(req), dto.showOnDashboard);
    return { showOnDashboard: dto.showOnDashboard };
  }

  // ── Clinic-owner management ──────────────────────────────────────────────

  @Get('access')
  @Roles(UserRole.clinic_admin)
  @ApiOperation({ summary: 'Owner: staff of my clinic and whether each may see revenue' })
  listAccess(@Req() req: AppRequest) {
    return this.access.listStaff(req.user.clinicId);
  }

  @Put('access/:userId')
  @Roles(UserRole.clinic_admin)
  @ApiOperation({ summary: 'Owner: grant or revoke revenue access for a staff member' })
  async setAccess(
    @Req() req: AppRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetRevenueAccessDto,
  ) {
    await this.access.setAccess(req.user.clinicId, userId, dto.granted);
    return { userId, granted: dto.granted };
  }
}
