import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { BookAppointmentDto } from './dto/book-appointment.dto';
import {
  UpdateAppointmentStatusDto,
  RescheduleAppointmentDto,
} from './dto/update-appointment.dto';
import { FilterAppointmentsDto } from './dto/filter-appointments.dto';
import { AppointmentStatus, Prisma } from '@prisma/client';
import dayjs from 'dayjs';

// ── Prisma include shape reused across queries ─────────────────────────────
const APPOINTMENT_INCLUDE = {
  patient: {
    select: {
      id: true, fullName: true, phone: true, patientCode: true, waOptIn: true,
    },
  },
  dentist: { select: { id: true, fullName: true, specialization: true } },
  clinic:  { select: { id: true, name: true } },
  slot:    { select: { id: true, startTime: true, endTime: true } },
} satisfies Prisma.AppointmentInclude;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma:  PrismaService,
    private readonly cache:   CacheService,
    private readonly emitter: EventEmitter2,
  ) {}

  // ── List / filter ─────────────────────────────────────────────────────────

  async findAll(clinicId: string, filters: FilterAppointmentsDto) {
    const {
      date, startDate, endDate, dentistId,
      patientId, status, type, page = 1, limit = 20,
    } = filters;

    const where: Prisma.AppointmentWhereInput = {
      clinicId,
      ...(date      && { appointmentDate: new Date(date) }),
      ...(startDate && { appointmentDate: { gte: new Date(startDate) } }),
      ...(endDate   && { appointmentDate: { lte: new Date(endDate) } }),
      ...(startDate && endDate && {
        appointmentDate: { gte: new Date(startDate), lte: new Date(endDate) },
      }),
      ...(dentistId && { dentistId }),
      ...(patientId && { patientId }),
      ...(status    && { status }),
      ...(type      && { type }),
    };

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        include:  APPOINTMENT_INCLUDE,
        orderBy:  [{ appointmentDate: 'asc' }, { startTime: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  // ── Single appointment ────────────────────────────────────────────────────

  async findOne(clinicId: string, id: string) {
    const appt = await this.prisma.appointment.findFirst({
      where:   { id, clinicId },
      include: {
        ...APPOINTMENT_INCLUDE,
        treatments: {
          include: { procedure: { select: { name: true, code: true } } },
        },
        invoice: {
          select: { id: true, invoiceNumber: true, status: true, totalAmount: true },
        },
      },
    });

    if (!appt) throw new NotFoundException('Appointment not found');
    return appt;
  }

  // ── Book ─────────────────────────────────────────────────────────────────

  async book(clinicId: string, bookedByUserId: string, dto: BookAppointmentDto) {
    // 1. Validate patient belongs to clinic
    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, clinicId },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    // 2. Validate dentist belongs to clinic
    const dentist = await this.prisma.user.findFirst({
      where: { id: dto.dentistId, clinicId, isActive: true },
    });
    if (!dentist) throw new NotFoundException('Dentist not found');

    // 3. Find and lock the slot
    const slotDate = new Date(dto.date);
    const slot = await this.prisma.appointmentSlot.findFirst({
      where: {
        clinicId,
        dentistId: dto.dentistId,
        slotDate,
        startTime: dto.startTime + ':00',  // normalise to HH:MM:SS
        isBooked:  false,
        isBlocked: false,
      },
    });

    if (!slot) {
      throw new BadRequestException(
        `No available slot for ${dto.startTime} on ${dto.date} with this dentist`,
      );
    }

    // 4. Conflict check — ensure no existing appointment for that slot
    const conflict = await this.prisma.appointment.findFirst({
      where: {
        clinicId,
        dentistId:       dto.dentistId,
        appointmentDate: slotDate,
        startTime:       slot.startTime,
        status:          { notIn: ['cancelled', 'no_show'] },
      },
    });
    if (conflict) throw new ConflictException('Slot already booked');

    // 5. Create appointment + mark slot — in one transaction
    const appointment = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: only one concurrent request can flip isBooked false -> true
      const claimed = await tx.appointmentSlot.updateMany({
        where: { id: slot.id, isBooked: false, isBlocked: false },
        data:  { isBooked: true },
      });
      if (claimed.count !== 1) throw new ConflictException('Slot already booked');

      const appt = await tx.appointment.create({
        data: {
          clinicId,
          patientId:       dto.patientId,
          dentistId:       dto.dentistId,
          slotId:          slot.id,
          appointmentDate: slotDate,
          startTime:       slot.startTime,
          endTime:         slot.endTime,
          type:            dto.type,
          chiefComplaint:  dto.chiefComplaint,
          estimatedCost:   dto.estimatedCost,
          bookedVia:       dto.bookedVia ?? 'web',
          bookedByUserId,
        },
        include: APPOINTMENT_INCLUDE,
      });

      return appt;
    });

    // 6. Update patient last-visit and increment counter
    await this.prisma.patient.update({
      where: { id: dto.patientId },
      data:  {
        lastVisitDate: slotDate,
        totalVisits:   { increment: 1 },
      },
    });

    // 7. Invalidate slot cache
    await this.cache.del(CacheService.keys.slots(clinicId, dto.dentistId, dto.date));

    // 8. Emit event → WhatsApp confirmation, notification queue
    this.emitter.emit('appointment.booked', { appointment, clinicId });

    return appointment;
  }

  // ── Update status ────────────────────────────────────────────────────────

  async updateStatus(
    clinicId: string,
    id: string,
    dto: UpdateAppointmentStatusDto,
    actorId: string,
  ) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id, clinicId },
    });
    if (!appt) throw new NotFoundException('Appointment not found');

    // Guard invalid transitions
    this.assertValidTransition(appt.status, dto.status);

    const data: Prisma.AppointmentUpdateInput = {
      status: dto.status,
      ...(dto.clinicalNotes && { clinicalNotes: dto.clinicalNotes }),
    };

    if (dto.status === AppointmentStatus.cancelled) {
      data.cancelledAt   = new Date();
      data.cancelReason  = dto.reason;
      data.cancelledBy   = { connect: { id: actorId } };

    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.appointment.update({
        where:   { id },
        data,
        include: APPOINTMENT_INCLUDE,
      });
      // Cancellation releases the slot atomically with the status change
      if (dto.status === AppointmentStatus.cancelled && appt.slotId) {
        await tx.appointmentSlot.update({
          where: { id: appt.slotId },
          data:  { isBooked: false },
        });
      }
      return u;
    });

    if (dto.status === AppointmentStatus.cancelled && appt.slotId) {
      const dateStr = dayjs(appt.appointmentDate).format('YYYY-MM-DD');
      await this.cache.del(CacheService.keys.slots(clinicId, appt.dentistId, dateStr));
    }

    // Emit event → automation
    this.emitter.emit(`appointment.${dto.status}`, { appointment: updated, clinicId });

    return updated;
  }

  // ── Reschedule ───────────────────────────────────────────────────────────

  async reschedule(
    clinicId: string,
    id: string,
    dto: RescheduleAppointmentDto,
    actorId: string,
  ) {
    const original = await this.prisma.appointment.findFirst({
      where: { id, clinicId },
    });
    if (!original) throw new NotFoundException('Appointment not found');
    if (!['scheduled', 'confirmed'].includes(original.status)) {
      throw new BadRequestException('Only scheduled or confirmed appointments can be rescheduled');
    }

    const newSlot = await this.prisma.appointmentSlot.findFirst({
      where: {
        clinicId,
        dentistId: original.dentistId,
        slotDate:  new Date(dto.date),
        startTime: dto.startTime + ':00',
        isBooked:  false,
        isBlocked: false,
      },
    });
    if (!newSlot) throw new BadRequestException('Requested slot is not available');
    if (newSlot.id === original.slotId) {
      throw new BadRequestException('Appointment is already in the requested slot');
    }

    const [cancelled, rescheduled] = await this.prisma.$transaction(async (tx) => {
      // Atomic claim of the new slot first; abort whole reschedule if lost the race
      const claimed = await tx.appointmentSlot.updateMany({
        where: { id: newSlot.id, isBooked: false, isBlocked: false },
        data:  { isBooked: true },
      });
      if (claimed.count !== 1) throw new ConflictException('Requested slot is no longer available');

      // Cancel original
      const c = await tx.appointment.update({
        where: { id },
        data:  {
          status:            AppointmentStatus.rescheduled,
          cancelledAt:       new Date(),
          cancelReason:      dto.reason ?? 'Rescheduled',
          cancelledById:     actorId,
        },
      });

      // Release original slot
      if (original.slotId) {
        await tx.appointmentSlot.update({
          where: { id: original.slotId },
          data:  { isBooked: false },
        });
      }

      // Create new appointment
      const r = await tx.appointment.create({
        data: {
          clinicId,
          patientId:          original.patientId,
          dentistId:          original.dentistId,
          slotId:             newSlot.id,
          appointmentDate:    new Date(dto.date),
          startTime:          newSlot.startTime,
          endTime:            newSlot.endTime,
          type:               original.type,
          chiefComplaint:     original.chiefComplaint,
          estimatedCost:      original.estimatedCost,
          bookedVia:          original.bookedVia,
          bookedByUserId:     actorId,
          rescheduledFromId:  original.id,
        },
        include: APPOINTMENT_INCLUDE,
      });

      return [c, r];
    });

    // Invalidate both dates' slot caches
    const origDate = dayjs(original.appointmentDate).format('YYYY-MM-DD');
    await Promise.all([
      this.cache.del(CacheService.keys.slots(clinicId, original.dentistId, origDate)),
      this.cache.del(CacheService.keys.slots(clinicId, original.dentistId, dto.date)),
    ]);

    this.emitter.emit('appointment.rescheduled', {
      original: cancelled, rescheduled, clinicId,
    });

    return rescheduled;
  }

  // ── Today's schedule ─────────────────────────────────────────────────────

  async todaySchedule(clinicId: string, dentistId?: string) {
    const today = dayjs().format('YYYY-MM-DD');
    return this.prisma.appointment.findMany({
      where: {
        clinicId,
        appointmentDate: new Date(today),
        status: { notIn: [AppointmentStatus.cancelled] },
        ...(dentistId && { dentistId }),
      },
      include: APPOINTMENT_INCLUDE,
      orderBy: { startTime: 'asc' },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private assertValidTransition(
    from: AppointmentStatus,
    to:   AppointmentStatus,
  ) {
    const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
      scheduled:   ['confirmed', 'cancelled', 'no_show', 'in_progress'],
      confirmed:   ['in_progress', 'cancelled', 'no_show'],
      in_progress: ['completed', 'cancelled'],
      completed:   [],
      cancelled:   [],
      no_show:     [],
      rescheduled: [],
    };

    if (!TRANSITIONS[from]?.includes(to)) {
      throw new BadRequestException(
        `Cannot transition from '${from}' to '${to}'`,
      );
    }
  }
}
