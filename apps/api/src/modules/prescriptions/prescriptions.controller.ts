/**
 * PrescriptionsController — /v1/patients/:patientId/prescriptions
 *                           /v1/prescription-templates
 *
 * Routes:
 *  POST   /patients/:patientId/prescriptions              — create
 *  GET    /patients/:patientId/prescriptions              — list
 *  GET    /patients/:patientId/prescriptions/:rxId        — single
 *  GET    /patients/:patientId/prescriptions/:rxId/pdf    — download PDF
 *
 *  GET    /prescription-templates                         — list templates
 *  POST   /prescription-templates                         — create template
 *  DELETE /prescription-templates/:id                     — deactivate template
 */

import {
  Controller, Get, Post, Delete, Param, Body, Query, Res,
  ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiProduces } from '@nestjs/swagger';
import { PrescriptionsService } from './prescriptions.service';
import {
  CreatePrescriptionDto, CreateTemplateDto,
} from './dto/create-prescription.dto';
import { ClinicId } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

// ── Patient prescriptions ─────────────────────────────────────────────────────

@ApiTags('Prescriptions')
@ApiBearerAuth()
@Controller({ path: 'patients/:patientId/prescriptions', version: '1' })
export class PrescriptionsController {
  constructor(private readonly svc: PrescriptionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('treatments:write')
  @ApiOperation({ summary: 'Create a new prescription for a patient' })
  create(
    @ClinicId()                        clinicId:  string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: CreatePrescriptionDto,
  ) {
    return this.svc.create(clinicId, patientId, dto);
  }

  @Get()
  @RequirePermission('treatments:read')
  @ApiOperation({ summary: 'List all prescriptions for a patient' })
  list(
    @ClinicId()                        clinicId:  string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page')  page  = 1,
    @Query('limit') limit = 20,
  ) {
    return this.svc.findAll(clinicId, patientId, +page, +limit);
  }

  @Get(':rxId')
  @RequirePermission('treatments:read')
  @ApiOperation({ summary: 'Get a single prescription with all items' })
  findOne(
    @ClinicId()                      clinicId: string,
    @Param('rxId', ParseUUIDPipe)    rxId:     string,
  ) {
    return this.svc.findOne(clinicId, rxId);
  }

  @Get(':rxId/pdf')
  @RequirePermission('treatments:read')
  @ApiOperation({ summary: 'Download prescription as PDF' })
  @ApiProduces('application/pdf')
  async downloadPdf(
    @ClinicId()                   clinicId: string,
    @Param('rxId', ParseUUIDPipe) rxId:     string,
    @Res() res: Response,
  ) {
    const buffer = await this.svc.generatePdf(clinicId, rxId);
    const rx     = await this.svc.findOne(clinicId, rxId);

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="rx-${rx.id.slice(-8)}.pdf"`,
      'Content-Length':      buffer.length,
    });
    res.end(buffer);
  }
}

// ── Prescription templates ────────────────────────────────────────────────────

@ApiTags('Prescription Templates')
@ApiBearerAuth()
@Controller({ path: 'prescription-templates', version: '1' })
export class PrescriptionTemplatesController {
  constructor(private readonly svc: PrescriptionsService) {}

  @Get()
  @RequirePermission('treatments:read')
  @ApiOperation({ summary: 'List prescription templates for this clinic' })
  list(@ClinicId() clinicId: string) {
    return this.svc.listTemplates(clinicId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('treatments:write')
  @ApiOperation({ summary: 'Create a prescription template (e.g. "Post-RCT")' })
  create(@ClinicId() clinicId: string, @Body() dto: CreateTemplateDto) {
    return this.svc.createTemplate(clinicId, dto);
  }

  @Delete(':id')
  @RequirePermission('treatments:write')
  @ApiOperation({ summary: 'Deactivate a prescription template' })
  remove(
    @ClinicId()                  clinicId: string,
    @Param('id', ParseUUIDPipe)  id:       string,
  ) {
    return this.svc.deleteTemplate(clinicId, id);
  }
}
