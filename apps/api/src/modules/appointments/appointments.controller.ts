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

@ApiTags('Appointments')
@ApiBearerAuth()
@Controller({ path: 'appointments', version: '1' })
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly slotsService: SlotsService,
  ) {}

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
  todaySchedule(
    @ClinicId() clinicId: string,
    @Query('dentistId') dentistId?: string,
  ) {
    return this.appointmentsService.todaySchedule(clinicId, dentistId);
  }

  // ── List ──────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List / filter appointments (paginated)' })
  findAll(
    @ClinicId() clinicId: string,
    @Query() filters: FilterAppointmentsDto,
  ) {
    return this.appointmentsService.findAll(clinicId, filters);
  }

  // ── Single ────────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get full appointment detail (treatments + invoice)' })
  findOne(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.appointmentsService.findOne(clinicId, id);
  }

  // ── Book ──────────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Book a new appointment' })
  book(
    @ClinicId() clinicId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BookAppointmentDto,
  ) {
    return this.appointmentsService.book(clinicId, user.id, dto);
  }

  // ── Status ────────────────────────────────────────────────────────────────

  @Patch(':id/status')
  @ApiOperation({ summary: 'Transition appointment status (FSM-guarded)' })
  updateStatus(
    @ClinicId() clinicId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentStatusDto,
  ) {
    return this.appointmentsService.updateStatus(clinicId, id, dto, user.id);
  }

  // ── Reschedule ────────────────────────────────────────────────────────────

  @Post(':id/reschedule')
  @ApiOperation({ summary: 'Reschedule appointment to a new date/time slot' })
  reschedule(
    @ClinicId() clinicId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.appointmentsService.reschedule(clinicId, id, dto, user.id);
  }
}
