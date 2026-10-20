import {
  Controller, Get, Query, Res, Header,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { ClinicId } from '../../common/decorators/current-user.decorator';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Full dashboard KPI summary' })
  dashboard(@ClinicId() clinicId: string) {
    return this.svc.getDashboardSummary(clinicId);
  }

  @Get('revenue/procedures')
  @ApiOperation({ summary: 'Revenue breakdown per procedure type' })
  @ApiQuery({ name: 'months', required: false })
  revenueByProcedure(
    @ClinicId() clinicId: string,
    @Query('months') months?: string,
  ) {
    return this.svc.getRevenuePerProcedure(clinicId, months ? Number(months) : 12);
  }

  @Get('patients/ltv')
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
  trends(
    @ClinicId() clinicId: string,
    @Query('period') period?: 'monthly' | 'yearly',
    @Query('count') count?: string,
  ) {
    return this.svc.getTrends(clinicId, period ?? 'monthly', count ? Number(count) : 12);
  }

  @Get('dentists/performance')
  @ApiOperation({ summary: 'Dentist performance metrics' })
  @ApiQuery({ name: 'months', required: false })
  dentistPerformance(
    @ClinicId() clinicId: string,
    @Query('months') months?: string,
  ) {
    return this.svc.getDentistPerformance(clinicId, months ? Number(months) : 3);
  }

  @Get('patients/inactive')
  @ApiOperation({ summary: 'Predictive: patients inactive for N+ days' })
  @ApiQuery({ name: 'days', required: false })
  @ApiQuery({ name: 'limit', required: false })
  inactivePatients(
    @ClinicId() clinicId: string,
    @Query('days')  days?:  string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getInactivePatients(
      clinicId,
      days  ? Number(days)  : 90,
      limit ? Number(limit) : 50,
    );
  }

  @Get('patients/high-value')
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
