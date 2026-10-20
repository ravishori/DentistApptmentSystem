import {
  Controller, Get, Post, Patch, Param, Body, Query,
  ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PatientsService } from './patients.service';
import {
  CreatePatientDto, UpdatePatientDto, SearchPatientsDto, LinkFamilyDto,
} from './dto/patient.dto';
import { ClinicId } from '../../common/decorators/current-user.decorator';

@ApiTags('Patients')
@ApiBearerAuth()
@Controller({ path: 'patients', version: '1' })
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  @ApiOperation({ summary: 'Search and list patients (paginated)' })
  findAll(@ClinicId() clinicId: string, @Query() dto: SearchPatientsDto) {
    return this.patientsService.findAll(clinicId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Patient detail with appointments, invoices, family' })
  findOne(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.patientsService.findOne(clinicId, id);
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
  getTimeline(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.patientsService.getTimeline(clinicId, id);
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
