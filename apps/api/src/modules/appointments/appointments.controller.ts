import {
  Controller, Get, Post, Patch, Param, Body, Query,
  ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation, ApiQuery,
} from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { SlotsService } from './slots.service';
import { BookAppointmentDto } from './dto/book-appointment.dto';
import {
  UpdateAppointmentStatusDto, RescheduleAppointmentDto,
} from './dto/update-appointment.dto';
import { FilterAppointmentsDto } from './dto/filter-appointments.dto';
import { GenerateSlotsDto, BlockSlotDto } from './dto/generate-slots.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, ClinicId } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request.types';
import { UserRole } from '@prisma/client';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { roleHasPermission } from '../../common/guards/permissions.guard';
import { redactAppointment, redactAppointments, redactAppointmentPage } from './appointment-financials';

@ApiTags('Appointments')
@ApiBearerAuth()
@Controller({ path: 'appointments', version: '1' })
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly slotsService: SlotsService,
  ) {}

  /** Patient-level money on appointments (estimated cost, linked invoice, treatment prices) needs billing:read. */
  private canSeeMoney(user: AuthenticatedUser | undefined): boolean {
    return roleHasPermission(user?.role, 'billing:read');
  }

  // ── Slots ─────────────────────────────────────────────────────────────────

  @Get('slots')
  @ApiOperation({ summary: 'Get available slots for a dentist on a date' })
  @ApiQuery({ name: 'dentistId', required: true })
  @ApiQuery({ name: 'date', required: true, example: '2024-11-15' })
  getAvailableSlots(
    @ClinicId() clinicId: string,
    @Query('dentistId', ParseUUIDPipe) dentistId: string,
    @Query('date') date: string,
  ) {
    return this.slotsService.getAvailable(clinicId, dentistId, date);
  }

  @Post('slots/generate')
  @Roles(UserRole.clinic_admin, UserRole.super_admin)
  @ApiOperation({ summary: 'Generate slots for a dentist on a given day' })
  generateSlots(
    @ClinicId() clinicId: string,
    @Body() dto: GenerateSlotsDto,
  ) {
    return this.slotsService.generate(clinicId, dto);
  }

  @Patch('slots/:slotId/block')
  @Roles(UserRole.clinic_admin, UserRole.super_admin, UserRole.receptionist)
  @ApiOperation({ summary: 'Block a slot to prevent booking' })
  blockSlot(
    @ClinicId() clinicId: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: Pick<BlockSlotDto, 'reason'>,
  ) {
    return this.slotsService.block(clinicId, { slotId, reason: dto.reason });
  }

  @Patch('slots/:slotId/unblock')
  @Roles(UserRole.clinic_admin, UserRole.super_admin, UserRole.receptionist)
  @ApiOperation({ summary: 'Unblock a previously blocked slot' })
  unblockSlot(
    @ClinicId() clinicId: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
  ) {
    return this.slotsService.unblock(clinicId, slotId);
  }

  // ── Today's schedule ──────────────────────────────────────────────────────

  @Get('today')
  @ApiOperation({ summary: "Today's appointment schedule" })
  @ApiQuery({ name: 'dentistId', required: false })
  async todaySchedule(
    @ClinicId() clinicId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('dentistId') dentistId?: string,
  ) {
    const rows = await this.appointmentsService.todaySchedule(clinicId, dentistId);
    return this.canSeeMoney(user) ? rows : redactAppointments(rows);
  }

  // ── List ──────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List / filter appointments (paginated)' })
  async findAll(
    @ClinicId() clinicId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: FilterAppointmentsDto,
  ) {
    const page = await this.appointmentsService.findAll(clinicId, filters);
    return this.canSeeMoney(user) ? page : redactAppointmentPage(page);
  }

  // ── Single ────────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get full appointment detail (treatments + invoice)' })
  async findOne(
    @ClinicId() clinicId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const appt = await this.appointmentsService.findOne(clinicId, id);
    return this.canSeeMoney(user) ? appt : redactAppointment(appt);
  }

  // ── Book ──────────────────────────────────────────────────────────────────

  @Post()
  @RequirePermission('appointments:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Book a new appointment' })
  async book(
    @ClinicId() clinicId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BookAppointmentDto,
  ) {
    const appt = await this.appointmentsService.book(clinicId, user.id, dto);
    return this.canSeeMoney(user) ? appt : redactAppointment(appt);
  }

  // ── Status ────────────────────────────────────────────────────────────────

  @Patch(':id/status')
  @RequirePermission('appointments:write')
  @ApiOperation({ summary: 'Transition appointment status (FSM-guarded)' })
  async updateStatus(
    @ClinicId() clinicId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentStatusDto,
  ) {
    const appt = await this.appointmentsService.updateStatus(clinicId, id, dto, user.id);
    return this.canSeeMoney(user) ? appt : redactAppointment(appt);
  }

  // ── Reschedule ────────────────────────────────────────────────────────────

  @Post(':id/reschedule')
  @RequirePermission('appointments:write')
  @ApiOperation({ summary: 'Reschedule appointment to a new date/time slot' })
  async reschedule(
    @ClinicId() clinicId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    const appt = await this.appointmentsService.reschedule(clinicId, id, dto, user.id);
    return this.canSeeMoney(user) ? appt : redactAppointment(appt);
  }
}
