import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, ParseUUIDPipe,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ChairsService } from './chairs.service';
import { DoctorAvailabilityService } from './doctor-availability.service';
import { SchedulingService } from './scheduling.service';
import {
  CreateChairDto, UpdateChairDto,
  CreateAvailabilityDto, UpdateAvailabilityDto,
  CreateScheduleOverrideDto,
  GenerateSlotsDto, AvailabilityQueryDto,
  BookAppointmentDto,
} from './dto/clinic-management.dto';
import { ClinicId, UserId } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Clinic Management')
@ApiBearerAuth()
@Controller({ path: 'clinic-management', version: '1' })
export class ClinicManagementController {
  constructor(
    private readonly chairs:        ChairsService,
    private readonly availability:  DoctorAvailabilityService,
    private readonly scheduling:    SchedulingService,
  ) {}

  // ── Chairs ────────────────────────────────────────────────────────────────

  @Get('chairs')
  @ApiOperation({ summary: 'List all chairs in the clinic' })
  listChairs(
    @ClinicId() clinicId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.chairs.findAll(clinicId, activeOnly !== 'false');
  }

  @Post('chairs')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard) @Roles('clinic_admin', 'super_admin')
  @ApiOperation({ summary: 'Create a dental chair (admin only)' })
  createChair(@ClinicId() clinicId: string, @Body() dto: CreateChairDto) {
    return this.chairs.create(clinicId, dto);
  }

  @Patch('chairs/:id')
  @UseGuards(RolesGuard) @Roles('clinic_admin', 'super_admin')
  @ApiOperation({ summary: 'Update a chair' })
  updateChair(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChairDto,
  ) {
    return this.chairs.update(clinicId, id, dto);
  }

  @Delete('chairs/:id')
  @UseGuards(RolesGuard) @Roles('clinic_admin', 'super_admin')
  @ApiOperation({ summary: 'Deactivate a chair' })
  removeChair(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chairs.remove(clinicId, id);
  }

  @Get('chairs/utilization')
  @ApiOperation({ summary: 'Chair utilization for a specific date' })
  chairUtilization(
    @ClinicId() clinicId: string,
    @Query('date') date: string,
  ) {
    return this.chairs.utilization(clinicId, date ?? new Date().toISOString().split('T')[0]);
  }

  // ── Doctors ───────────────────────────────────────────────────────────────

  @Get('doctors')
  @ApiOperation({ summary: 'List all active dentists with their availability rules' })
  getDoctors(@ClinicId() clinicId: string) {
    return this.availability.getDoctors(clinicId);
  }

  // ── Availability rules ────────────────────────────────────────────────────

  @Get('availability')
  @ApiOperation({ summary: 'List availability rules (optionally filtered by dentist)' })
  listAvailabilities(
    @ClinicId() clinicId: string,
    @Query('dentistId') dentistId?: string,
  ) {
    return this.availability.listAvailabilities(clinicId, dentistId);
  }

  @Post('availability')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard) @Roles('clinic_admin', 'dentist', 'super_admin')
  @ApiOperation({ summary: 'Create a recurring availability rule for a dentist' })
  createAvailability(@ClinicId() clinicId: string, @Body() dto: CreateAvailabilityDto) {
    return this.availability.createAvailability(clinicId, dto);
  }

  @Patch('availability/:id')
  @UseGuards(RolesGuard) @Roles('clinic_admin', 'dentist', 'super_admin')
  @ApiOperation({ summary: 'Update an availability rule' })
  updateAvailability(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.availability.updateAvailability(clinicId, id, dto);
  }

  @Delete('availability/:id')
  @UseGuards(RolesGuard) @Roles('clinic_admin', 'dentist', 'super_admin')
  @ApiOperation({ summary: 'Deactivate an availability rule' })
  deleteAvailability(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.availability.deleteAvailability(clinicId, id);
  }

  // ── Schedule overrides ────────────────────────────────────────────────────

  @Post('schedule-overrides')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard) @Roles('clinic_admin', 'dentist', 'super_admin')
  @ApiOperation({ summary: 'Create/upsert a one-off schedule override (leave, holiday, etc.)' })
  createOverride(@ClinicId() clinicId: string, @Body() dto: CreateScheduleOverrideDto) {
    return this.availability.createOverride(clinicId, dto);
  }

  @Get('schedule-overrides')
  @ApiOperation({ summary: 'List schedule overrides for a dentist in a date range' })
  listOverrides(
    @ClinicId() clinicId: string,
    @Query('dentistId') dentistId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.availability.listOverrides(clinicId, dentistId, from, to);
  }

  // ── Availability view ─────────────────────────────────────────────────────

  @Get('availability/check')
  @ApiOperation({
    summary: 'Get per-doctor availability grid for a date range',
    description: 'Returns each doctor\'s working/leave status and booked slots per day',
  })
  checkAvailability(@ClinicId() clinicId: string, @Query() query: AvailabilityQueryDto) {
    return this.availability.getAvailability(clinicId, query);
  }

  // ── Slot generation ───────────────────────────────────────────────────────

  @Post('slots/generate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard) @Roles('clinic_admin', 'super_admin', 'receptionist')
  @ApiOperation({ summary: 'Generate appointment slots from a dentist\'s availability rules' })
  generateSlots(@ClinicId() clinicId: string, @Body() dto: GenerateSlotsDto) {
    return this.availability.generateSlots(clinicId, dto);
  }

  @Get('slots/free')
  @ApiOperation({ summary: 'Get free (unbooked) slots for a dentist on a specific date' })
  getFreeSlots(
    @ClinicId() clinicId: string,
    @Query('dentistId', ParseUUIDPipe) dentistId: string,
    @Query('date') date: string,
  ) {
    return this.scheduling.getFreeSlots(clinicId, dentistId, date);
  }

  // ── Day schedule ──────────────────────────────────────────────────────────

  @Get('schedule/day')
  @ApiOperation({ summary: 'Full day schedule grouped by dentist AND by chair' })
  getDaySchedule(@ClinicId() clinicId: string, @Query('date') date: string) {
    return this.scheduling.getDaySchedule(clinicId, date ?? new Date().toISOString().split('T')[0]);
  }

  // ── Book appointment ──────────────────────────────────────────────────────

  @Post('appointments')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard) @Roles('clinic_admin', 'receptionist', 'super_admin', 'dentist')
  @ApiOperation({ summary: 'Book an appointment with double-booking prevention and auto chair assignment' })
  bookAppointment(
    @ClinicId() clinicId: string,
    @UserId() userId: string,
    @Body() dto: BookAppointmentDto,
  ) {
    return this.scheduling.bookAppointment({
      clinicId,
      dentistId:       dto.dentistId,
      patientId:       dto.patientId,
      appointmentDate: dto.date,
      startTime:       dto.startTime,
      endTime:         dto.endTime,
      preferChairId:   dto.chairId,
      type:            dto.type,
      bookedByUserId:  userId,
    });
  }
}
