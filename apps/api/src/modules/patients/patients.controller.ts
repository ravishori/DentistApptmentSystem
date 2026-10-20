import {
  Controller, Get, Post, Patch, Param, Body, Query,
  ParseUUIDPipe, HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PatientsService } from './patients.service';
import {
  CreatePatientDto, UpdatePatientDto, SearchPatientsDto, LinkFamilyDto,
} from './dto/patient.dto';
import { ClinicId } from '../../common/decorators/current-user.decorator';
import { AppRequest } from '../../common/types/request.types';
import { roleHasPermission } from '../../common/guards/permissions.guard';
import { redactPatientDetail, redactPatientList, redactPatientTimeline } from './patient-financials';

@ApiTags('Patients')
@ApiBearerAuth()
@Controller({ path: 'patients', version: '1' })
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  /** Patient-level money (balance, invoices, treatment prices) needs the billing:read permission. */
  private canSeeFinancials(req: AppRequest): boolean {
    return roleHasPermission(req.user?.role, 'billing:read');
  }

  @Get()
  @ApiOperation({ summary: 'Search and list patients (paginated)' })
  async findAll(@ClinicId() clinicId: string, @Req() req: AppRequest, @Query() dto: SearchPatientsDto) {
    const result = await this.patientsService.findAll(clinicId, dto);
    return this.canSeeFinancials(req) ? result : redactPatientList(result);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Patient detail with appointments, invoices, family' })
  async findOne(
    @ClinicId() clinicId: string,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const patient = await this.patientsService.findOne(clinicId, id);
    return this.canSeeFinancials(req) ? patient : redactPatientDetail(patient);
  }

  @Get(':id/family')
  @ApiOperation({ summary: 'Get all family members linked to this patient' })
  getFamily(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.patientsService.getFamily(clinicId, id);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Full appointment + invoice timeline for a patient' })
  async getTimeline(
    @ClinicId() clinicId: string,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const timeline = await this.patientsService.getTimeline(clinicId, id);
    return this.canSeeFinancials(req) ? timeline : redactPatientTimeline(timeline);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new patient' })
  create(@ClinicId() clinicId: string, @Body() dto: CreatePatientDto) {
    return this.patientsService.create(clinicId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update patient profile' })
  update(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
  ) {
    return this.patientsService.update(clinicId, id, dto);
  }

  @Patch(':id/family-link')
  @ApiOperation({ summary: 'Link patient under a family head' })
  linkFamily(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkFamilyDto,
  ) {
    return this.patientsService.linkFamily(clinicId, id, dto.familyHeadId, dto.relationship);
  }
}
