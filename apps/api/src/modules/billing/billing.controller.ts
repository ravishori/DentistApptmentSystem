import { Throttle } from '@nestjs/throttler';
import {
  Controller, Get, Post, Patch, Param, Body, Query,
  ParseUUIDPipe, HttpCode, HttpStatus, Res, Req, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { RazorpayService } from './razorpay/razorpay.service';
import { PackagesService } from './packages.service';
import { InsuranceService } from './insurance.service';
import { ReportsService } from './reports.service';
import {
  CreateInvoiceDto, VerifyPaymentDto, FilterInvoicesDto,
} from './dto/billing.dto';
import { CreatePaymentLinkDto, VerifyOrderPaymentDto } from './dto/payment-link.dto';
import {
  CreateTreatmentPackageDto, UpdateTreatmentPackageDto,
  EnrollPatientDto, MarkVisitCompletedDto,
} from './dto/package.dto';
import { CreateInsuranceClaimDto, UpdateInsuranceClaimDto } from './dto/insurance.dto';
import { RecordManualPaymentDto } from './dto/manual-payment.dto';
import { ReportQueryDto, ReportFormat } from './dto/report.dto';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { ClinicId, UserId } from '../../common/decorators/current-user.decorator';
import { AppRequest } from '../../common/types/request.types';
import { RevenueAccessGuard } from '../analytics/revenue/revenue-access.guard';
import { RevenueAccessService } from '../analytics/revenue/revenue-access.service';
import { redactBillingStats } from '../analytics/revenue/financial-redaction';

@ApiTags('Billing')
@ApiBearerAuth()
// Invoices, balances, payments, packages, insurance and reports are billing data: every route needs billing:read
// (dentist, receptionist, admins). Mutating routes override this with billing:write (receptionist, admins).
// @Public() routes (checkout callback) are exempt and handled by the permissions guard.
@RequirePermission('billing:read')
@Controller({ path: 'billing', version: '1' })
export class BillingController {
  constructor(
    private readonly billingService:   BillingService,
    private readonly razorpayService:  RazorpayService,
    private readonly packagesService:  PackagesService,
    private readonly insuranceService: InsuranceService,
    private readonly reportsService:   ReportsService,
    private readonly revenueAccess:    RevenueAccessService,
  ) {}

  // ── Invoices ──────────────────────────────────────────────────────────────

  @Get('invoices')
  @ApiOperation({ summary: 'List invoices with optional status / patient filter' })
  findAll(@ClinicId() clinicId: string, @Query() dto: FilterInvoicesDto) {
    return this.billingService.findAll(clinicId, dto);
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Invoice detail — items, payments, balance' })
  findOne(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.billingService.findOne(clinicId, id);
  }

  @Post('invoices')
  @RequirePermission('billing:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create invoice with line items; calculates GST automatically' })
  create(@ClinicId() clinicId: string, @Body() dto: CreateInvoiceDto) {
    return this.billingService.create(clinicId, dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Billing stats — this-month revenue, outstanding, counts' })
  async stats(@ClinicId() clinicId: string, @Req() req: AppRequest) {
    const stats = await this.billingService.stats(clinicId);
    // Invoice counts are operational; this-month revenue and the outstanding total are private.
    return (await this.revenueAccess.canViewRequest(req)) ? stats : redactBillingStats(stats);
  }

  // ── Razorpay Order (in-browser checkout) ─────────────────────────────────

  @Post('invoices/:id/order')
  @RequirePermission('billing:write')
  @ApiOperation({
    summary: 'Create Razorpay Order for in-browser checkout (embeds in your page)',
    description: 'Returns orderId + key for Razorpay.js. After payment the client calls /payments/verify.',
  })
  createOrder(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.razorpayService.createOrder(clinicId, id);
  }

  /** Kept for backwards-compat — same as /order */
  @Post('invoices/:id/pay')
  @RequirePermission('billing:write')
  @ApiOperation({ summary: 'Alias for /order (backwards-compat)' })
  createOrderAlias(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.razorpayService.createOrder(clinicId, id);
  }

  @Post('payments/verify')
  @Public()
  // Anonymous endpoint that reaches the payment gateway: much tighter than the global 100/min
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify Razorpay HMAC signature after client-side checkout',
    description: 'Call this from the browser after rzp.on("payment.success"). Idempotent.',
  })
  verifyPayment(
    @ClinicId() clinicId: string | undefined,
    @Body() dto: VerifyOrderPaymentDto,
  ) {
    return this.razorpayService.verifyOrderPayment(clinicId, dto);
  }

  // ── Razorpay Payment Link (shareable, WhatsApp-friendly) ─────────────────

  @Post('invoices/:id/payment-link')
  @RequirePermission('billing:write')
  @ApiOperation({
    summary: 'Create a Razorpay Payment Link and dispatch via WhatsApp',
    description:
      'Returns a short_url (e.g. rzp.io/l/xxx). Also fires invoice.sent → ' +
      'WhatsApp service sends the link to the patient automatically.',
  })
  createPaymentLink(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePaymentLinkDto,
  ) {
    return this.razorpayService.createPaymentLink(clinicId, id, dto);
  }

  // ── Public checkout resolver (used by /pay/[orderId] page) ──────────────

  @Get('orders/:razorpayOrderId/checkout')
  @Public()
  @ApiOperation({
    summary: 'Resolve a Razorpay orderId to checkout params (public, no JWT)',
    description: 'Called by the /pay/[orderId] page to get key + amount for Razorpay.js',
  })
  resolveCheckout(
    @Param('razorpayOrderId') razorpayOrderId: string,
  ) {
    return this.razorpayService.resolveCheckout(razorpayOrderId);
  }

  // ── Manual payment ────────────────────────────────────────────────────────

  @Post('invoices/:id/payments')
  @RequirePermission('billing:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a manual (cash/UPI/card/etc.) payment on an invoice' })
  recordManualPayment(
    @ClinicId() clinicId: string,
    @UserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordManualPaymentDto,
  ) {
    return this.billingService.recordManualPayment(clinicId, id, dto, userId);
  }

  // ── Invoice lifecycle ─────────────────────────────────────────────────────

  @Patch('invoices/:id/cancel')
  @RequirePermission('billing:write')
  @ApiOperation({ summary: 'Cancel a draft or unpaid invoice' })
  cancel(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.billingService.cancel(clinicId, id);
  }

  // ── Treatment Packages ────────────────────────────────────────────────────

  @Get('packages')
  @ApiOperation({ summary: 'List treatment packages' })
  listPackages(@ClinicId() clinicId: string, @Query('activeOnly') activeOnly?: string) {
    return this.packagesService.listPackages(clinicId, activeOnly !== 'false');
  }

  @Post('packages')
  @RequirePermission('billing:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a treatment package (bundle)' })
  createPackage(@ClinicId() clinicId: string, @Body() dto: CreateTreatmentPackageDto) {
    return this.packagesService.createPackage(clinicId, dto);
  }

  @Get('packages/:id')
  @ApiOperation({ summary: 'Get package detail with recent enrollments' })
  getPackage(@ClinicId() clinicId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.packagesService.getPackage(clinicId, id);
  }

  @Patch('packages/:id')
  @RequirePermission('billing:write')
  @ApiOperation({ summary: 'Update package (name / price / active status)' })
  updatePackage(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTreatmentPackageDto,
  ) {
    return this.packagesService.updatePackage(clinicId, id, dto);
  }

  // ── Package Enrollments ───────────────────────────────────────────────────

  @Get('enrollments')
  @ApiOperation({ summary: 'List package enrollments' })
  listEnrollments(
    @ClinicId() clinicId: string,
    @Query('patientId') patientId?: string,
    @Query('status') status?: string,
  ) {
    return this.packagesService.listEnrollments(clinicId, patientId, status);
  }

  @Post('enrollments')
  @RequirePermission('billing:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enroll a patient in a package with optional installment plan' })
  enrollPatient(@ClinicId() clinicId: string, @Body() dto: EnrollPatientDto) {
    return this.packagesService.enrollPatient(clinicId, dto);
  }

  @Get('enrollments/:id')
  @ApiOperation({ summary: 'Get enrollment detail with invoices' })
  getEnrollment(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.packagesService.getEnrollment(clinicId, id);
  }

  @Post('enrollments/mark-visit')
  @RequirePermission('billing:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one visit as completed in an enrollment' })
  markVisitCompleted(@ClinicId() clinicId: string, @Body() dto: MarkVisitCompletedDto) {
    return this.packagesService.markVisitCompleted(clinicId, dto);
  }

  // ── Insurance Claims ──────────────────────────────────────────────────────

  @Get('insurance-claims')
  @ApiOperation({ summary: 'List insurance claims' })
  listClaims(
    @ClinicId() clinicId: string,
    @Query('patientId') patientId?: string,
    @Query('status') status?: string,
  ) {
    return this.insuranceService.listClaims(clinicId, patientId, status);
  }

  @Post('insurance-claims')
  @RequirePermission('billing:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Raise an insurance claim against an invoice' })
  createClaim(@ClinicId() clinicId: string, @Body() dto: CreateInsuranceClaimDto) {
    return this.insuranceService.createClaim(clinicId, dto);
  }

  @Get('insurance-claims/:id')
  @ApiOperation({ summary: 'Get insurance claim detail' })
  getClaim(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.insuranceService.getClaim(clinicId, id);
  }

  @Patch('insurance-claims/:id')
  @RequirePermission('billing:write')
  @ApiOperation({ summary: 'Update claim status / approved/reimbursed amounts' })
  updateClaim(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInsuranceClaimDto,
  ) {
    return this.insuranceService.updateClaim(clinicId, id, dto);
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  @Get('reports/daily-revenue')
  @UseGuards(RevenueAccessGuard)
  @ApiOperation({ summary: 'Daily revenue breakdown for a date range' })
  async getDailyRevenue(
    @ClinicId() clinicId: string,
    @Query() dto: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getDailyRevenue(clinicId, dto.from, dto.to, dto.format);
    if (dto.format === ReportFormat.CSV) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="daily-revenue-${dto.from}-${dto.to}.csv"`);
    }
    return result;
  }

  @Get('reports/outstanding')
  @UseGuards(RevenueAccessGuard)
  @ApiOperation({ summary: 'Outstanding dues with 30/60/90/90+ day aging buckets' })
  async getOutstandingDues(
    @ClinicId() clinicId: string,
    @Query('format') format: ReportFormat = ReportFormat.JSON,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getOutstandingDues(clinicId, format);
    if (format === ReportFormat.CSV) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="outstanding-dues.csv"');
    }
    return result;
  }

  @Get('reports/gst')
  @UseGuards(RevenueAccessGuard)
  @ApiOperation({ summary: 'Month-wise GST report with CGST/SGST/IGST breakdown' })
  async getGstReport(
    @ClinicId() clinicId: string,
    @Query() dto: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.reportsService.getGstReport(clinicId, dto.from, dto.to, dto.format);
    if (dto.format === ReportFormat.CSV) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="gst-report-${dto.from}-${dto.to}.csv"`);
    }
    return result;
  }
}
