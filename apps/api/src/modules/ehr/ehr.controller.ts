/**
 * EhrController  — /v1/patients/:patientId/ehr
 *
 * Routes:
 *  GET    /patients/:patientId/ehr/chart                 — full dental chart
 *  PATCH  /patients/:patientId/ehr/chart/tooth/:fdi      — update one tooth
 *  PATCH  /patients/:patientId/ehr/chart/bulk            — bulk-update teeth
 *  GET    /patients/:patientId/ehr/timeline              — paginated visit timeline
 *  POST   /patients/:patientId/ehr/visits                — create visit
 *  GET    /patients/:patientId/ehr/visits/:visitId       — single visit
 *  PATCH  /patients/:patientId/ehr/visits/:visitId       — update visit
 *  POST   /patients/:patientId/ehr/visits/:visitId/diagnoses — add diagnosis
 */

import {
  Controller, Get, Post, Patch, Param, Body, Query,
  ParseUUIDPipe, ParseIntPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { EhrService } from './ehr.service';
import { CreateVisitDto, UpdateVisitDto } from './dto/create-visit.dto';
import { UpdateToothDto, BulkUpdateToothDto } from './dto/update-tooth.dto';
import { ClinicId } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

@ApiTags('EHR')
@ApiBearerAuth()
@Controller({ path: 'patients/:patientId/ehr', version: '1' })
export class EhrController {
  constructor(private readonly ehrService: EhrService) {}

  // ── Dental Chart ───────────────────────────────────────────────────────────

  @Get('chart')
  @RequirePermission('patients:read')
  @ApiOperation({ summary: 'Get or auto-create the dental chart for a patient' })
  getChart(
    @ClinicId()                            clinicId:  string,
    @Param('patientId', ParseUUIDPipe)     patientId: string,
  ) {
    return this.ehrService.getOrCreateChart(clinicId, patientId);
  }

  @Patch('chart/tooth/:fdi')
  @RequirePermission('treatments:write')
  @ApiOperation({ summary: 'Update a single tooth by FDI number (11–48)' })
  updateTooth(
    @ClinicId()                        clinicId:  string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('fdi', ParseIntPipe)        fdi:       number,
    @Body() dto: UpdateToothDto,
  ) {
    return this.ehrService.updateTooth(clinicId, patientId, fdi, dto);
  }

  @Patch('chart/bulk')
  @RequirePermission('treatments:write')
  @ApiOperation({ summary: 'Bulk-update multiple teeth to the same condition' })
  bulkUpdateTeeth(
    @ClinicId()                        clinicId:  string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: BulkUpdateToothDto,
  ) {
    return this.ehrService.bulkUpdateTeeth(clinicId, patientId, dto);
  }

  // ── Visits / Timeline ─────────────────────────────────────────────────────

  @Get('timeline')
  @RequirePermission('patients:read')
  @ApiOperation({ summary: 'Paginated visit timeline for a patient' })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getTimeline(
    @ClinicId()                        clinicId:  string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page')  page  = 1,
    @Query('limit') limit = 10,
  ) {
    return this.ehrService.getPatientTimeline(clinicId, patientId, +page, +limit);
  }

  @Post('visits')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('treatments:write')
  @ApiOperation({ summary: 'Create a clinical visit record' })
  createVisit(
    @ClinicId()                        clinicId:  string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: CreateVisitDto,
  ) {
    return this.ehrService.createVisit(clinicId, patientId, dto);
  }

  @Get('visits/:visitId')
  @RequirePermission('patients:read')
  @ApiOperation({ summary: 'Get a single visit with diagnoses, prescriptions, attachments' })
  getVisit(
    @ClinicId()                        clinicId: string,
    @Param('visitId', ParseUUIDPipe)   visitId:  string,
  ) {
    return this.ehrService.getVisit(clinicId, visitId);
  }

  @Patch('visits/:visitId')
  @RequirePermission('treatments:write')
  @ApiOperation({ summary: 'Update clinical notes and vitals for a visit' })
  updateVisit(
    @ClinicId()                        clinicId: string,
    @Param('visitId', ParseUUIDPipe)   visitId:  string,
    @Body() dto: UpdateVisitDto,
  ) {
    return this.ehrService.updateVisit(clinicId, visitId, dto);
  }

  @Post('visits/:visitId/diagnoses')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('treatments:write')
  @ApiOperation({ summary: 'Add a diagnosis to a visit' })
  addDiagnosis(
    @ClinicId()                        clinicId:  string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('visitId', ParseUUIDPipe)   visitId:   string,
    @Body() body: {
      fdiNumber?: number; icdCode?: string; description: string; severity?: string;
    },
  ) {
    return this.ehrService.addDiagnosis(clinicId, visitId, patientId, body);
  }
}
