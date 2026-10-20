import {
  Controller, Get, Query, Res, Header, Req, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { ClinicId } from '../../common/decorators/current-user.decorator';
import { AppRequest } from '../../common/types/request.types';
import { RevenueAccessGuard } from './revenue/revenue-access.guard';
import { RevenueAccessService } from './revenue/revenue-access.service';
import { omitKeys, redactDashboardSummary } from './revenue/financial-redaction';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(
    private readonly svc: AnalyticsService,
    private readonly revenueAccess: RevenueAccessService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Full dashboard KPI summary' })
  async dashboard(@ClinicId() clinicId: string, @Req() req: AppRequest) {
    const summary = await this.svc.getDashboardSummary(clinicId);
    // Monthly revenue and the outstanding balance are private; appointment/patient KPIs are not.
    return (await this.revenueAccess.canViewRequest(req)) ? summary : redactDashboardSummary(summary);
  }

  @Get('revenue/procedures')
  @ApiOperation({ summary: 'Procedure mix; money columns only for clinic owners / authorised users' })
  @ApiQuery({ name: 'months', required: false })
  async revenueByProcedure(
    @ClinicId() clinicId: string,
    @Req() req: AppRequest,
    @Query('months') months?: string,
  ) {
    const rows = await this.svc.getRevenuePerProcedure(clinicId, months ? Number(months) : 12);
    // The procedure COUNT feeds the default dashboard for everyone; the revenue figures are private.
    const viewer = { id: req.user.id, role: req.user.role, clinicId: req.user.clinicId };
    if (await this.revenueAccess.canView(viewer)) return rows;
    return rows.map(({ totalRevenue: _t, avgRevenue: _a, ...rest }: any) => rest);
  }

  @Get('patients/ltv')
  @UseGuards(RevenueAccessGuard)   // patient lifetime value is financial data
  @ApiOperation({ summary: 'Patient lifetime value — top patients + distribution' })
  patientLtv(@ClinicId() clinicId: string) {
    return this.svc.getPatientLTV(clinicId);
  }

  @Get('appointments/no-show')
  @ApiOperation({ summary: 'No-show rate analysis — monthly, by doctor, by day of week' })
  @ApiQuery({ name: 'months', required: false })
  noShowAnalysis(
    @ClinicId() clinicId: string,
    @Query('months') months?: string,
  ) {
    return this.svc.getNoShowAnalysis(clinicId, months ? Number(months) : 6);
  }

  @Get('funnel')
  @ApiOperation({ summary: 'Conversion funnel: registered → booked → completed → paid' })
  @ApiQuery({ name: 'months', required: false })
  conversionFunnel(
    @ClinicId() clinicId: string,
    @Query('months') months?: string,
  ) {
    return this.svc.getConversionFunnel(clinicId, months ? Number(months) : 3);
  }

  @Get('trends')
  @ApiOperation({ summary: 'Monthly or yearly trends for revenue, appointments, patients' })
  @ApiQuery({ name: 'period', enum: ['monthly', 'yearly'], required: false })
  @ApiQuery({ name: 'count', required: false })
  async trends(
    @ClinicId() clinicId: string,
    @Req() req: AppRequest,
    @Query('period') period?: 'monthly' | 'yearly',
    @Query('count') count?: string,
  ) {
    const rows = await this.svc.getTrends(clinicId, period ?? 'monthly', count ? Number(count) : 12);
    // Appointment/patient trends stay available to all staff; the money columns do not.
    const viewer = { id: req.user.id, role: req.user.role, clinicId: req.user.clinicId };
    if (await this.revenueAccess.canView(viewer)) return rows;
    return rows.map(({ revenue: _revenue, payments: _payments, ...rest }: any) => rest);
  }

  @Get('dentists/performance')
  @ApiOperation({ summary: 'Dentist performance metrics' })
  @ApiQuery({ name: 'months', required: false })
  async dentistPerformance(
    @ClinicId() clinicId: string,
    @Req() req: AppRequest,
    @Query('months') months?: string,
  ) {
    const rows = await this.svc.getDentistPerformance(clinicId, months ? Number(months) : 3);
    // Per-dentist revenue is private; appointment/completion metrics are not.
    return (await this.revenueAccess.canViewRequest(req)) ? rows : omitKeys(rows as any[], ['revenue']);
  }

  @Get('patients/inactive')
  @ApiOperation({ summary: 'Predictive: patients inactive for N+ days' })
  @ApiQuery({ name: 'days', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async inactivePatients(
    @ClinicId() clinicId: string,
    @Req() req: AppRequest,
    @Query('days')  days?:  string,
    @Query('limit') limit?: string,
  ) {
    const rows = await this.svc.getInactivePatients(clinicId, days ? Number(days) : 90, limit ? Number(limit) : 50);
    // Recall lists stay available to all staff; each patient's lifetime value does not.
    return (await this.revenueAccess.canViewRequest(req)) ? rows : omitKeys(rows as any[], ['ltv']);
  }

  @Get('patients/high-value')
  @UseGuards(RevenueAccessGuard)   // ranks patients by lifetime value and balance
  @ApiOperation({ summary: 'Predictive: high-value patients by LTV tier' })
  @ApiQuery({ name: 'limit', required: false })
  highValuePatients(
    @ClinicId() clinicId: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getHighValuePatients(clinicId, limit ? Number(limit) : 30);
  }

  // ── CSV exports ────────────────────────────────────────────────────────────

  @Get('export/revenue-csv')
  @UseGuards(RevenueAccessGuard)
  @ApiOperation({ summary: 'Export revenue trend as CSV' })
  async exportRevenueCsv(
    @ClinicId() clinicId: string,
    @Query('months') months: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.svc.exportRevenueCsv(clinicId, months ? Number(months) : 12);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="revenue-trend.csv"');
    return csv;
  }

  @Get('export/ltv-csv')
  @UseGuards(RevenueAccessGuard)
  @ApiOperation({ summary: 'Export patient LTV as CSV' })
  async exportLtvCsv(
    @ClinicId() clinicId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.svc.exportPatientLtvCsv(clinicId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="patient-ltv.csv"');
    return csv;
  }
}
