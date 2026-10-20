import {
  Injectable, NotFoundException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChairsService } from './chairs.service';

export interface BookSlotOptions {
  clinicId:        string;
  patientId:       string;
  dentistId:       string;
  appointmentDate: string;
  startTime:       string;
  endTime:         string;
  type?:           string;
  chiefComplaint?: string;
  bookedByUserId?: string;
  preferChairId?:  string;
}

@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma:  PrismaService,
    private readonly chairs:  ChairsService,
  ) {}

  /**
   * Core booking method:
   * 1. Checks dentist is not double-booked
   * 2. Checks patient is not double-booked
   * 3. Auto-assigns best available chair (respects preferChairId)
   * 4. Creates or links AppointmentSlot + Appointment atomically
   */
  async bookAppointment(opts: BookSlotOptions) {
    const {
      clinicId, patientId, dentistId,
      appointmentDate, startTime, endTime,
    } = opts;

    const date = new Date(appointmentDate);

    // ── 1. Double-booking check: dentist ─────────────────────────────────────
    const dentistConflict = await this.prisma.appointment.findFirst({
      where: {
        clinicId,
        dentistId,
        appointmentDate: date,
        status:   { notIn: ['cancelled', 'no_show'] },
        AND: [
          { startTime: { lt: endTime } },
          { endTime:   { gt: startTime } },
        ],
      },
    });
    if (dentistConflict) {
      throw new ConflictException(
        `Dentist already has an appointment from ${dentistConflict.startTime} to ${dentistConflict.endTime}`,
      );
    }

    // ── 2. Double-booking check: patient ─────────────────────────────────────
    const patientConflict = await this.prisma.appointment.findFirst({
      where: {
        clinicId,
        patientId,
        appointmentDate: date,
        status:   { notIn: ['cancelled', 'no_show'] },
        AND: [
          { startTime: { lt: endTime } },
          { endTime:   { gt: startTime } },
        ],
      },
    });
    if (patientConflict) {
      throw new ConflictException(
        `Patient already has an appointment at this time`,
      );
    }

    // ── 3. Chair assignment ───────────────────────────────────────────────────
    let chairId: string | null | undefined = opts.preferChairId ?? null;
    if (chairId) {
      // Verify preferred chair is actually free
      const chairConflict = await this.prisma.appointment.findFirst({
        where: {
          clinicId,
          chairId,
          appointmentDate: date,
          status:   { notIn: ['cancelled', 'no_show'] },
          AND: [
            { startTime: { lt: endTime } },
            { endTime:   { gt: startTime } },
          ],
        },
      });
      if (chairConflict) {
        // Preferred chair busy — fall back to auto-assign
        chairId = await this.chairs.nextFreeChair(clinicId, appointmentDate, startTime, endTime);
      }
    } else {
      chairId = await this.chairs.nextFreeChair(clinicId, appointmentDate, startTime, endTime);
    }

    // ── 4. Find or create slot ────────────────────────────────────────────────
    let slot = await this.prisma.appointmentSlot.findUnique({
      where: {
        clinicId_dentistId_slotDate_startTime: {
          clinicId,
          dentistId,
          slotDate: date,
          startTime,
        },
      },
    });

    if (!slot) {
      slot = await this.prisma.appointmentSlot.create({
        data: {
          clinicId,
          dentistId,
          slotDate:  date,
          startTime,
          endTime,
          isBooked:  true,
          chairId:   chairId ?? undefined,
        },
      });
    } else if (slot.isBooked && !slot.isBlocked) {
      throw new ConflictException('This slot is already booked');
    }

    // ── 5. Create appointment ─────────────────────────────────────────────────
    const appointment = await this.prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: {
          clinicId,
          patientId,
          dentistId,
          chairId:         chairId ?? undefined,
          slotId:          slot!.id,
          appointmentDate: date,
          startTime,
          endTime,
          type:            opts.type as any ?? 'consultation',
          chiefComplaint:  opts.chiefComplaint,
          bookedByUserId:  opts.bookedByUserId,
          bookedVia:       'web',
          status:          'scheduled',
        },
        include: {
          patient: { select: { id: true, fullName: true, phone: true } },
          dentist: { select: { id: true, fullName: true } },
          chair:   { select: { id: true, name: true, chairNumber: true } },
          slot:    true,
        },
      });

      await tx.appointmentSlot.update({
        where: { id: slot!.id },
        data:  { isBooked: true, chairId: chairId ?? undefined },
      });

      return appt;
    });

    return appointment;
  }

  /**
   * Returns all doctors with their schedule for a given date,
   * grouped by chair for the utilization view.
   */
  async getDaySchedule(clinicId: string, date: string) {
    const d = new Date(date);

    const [appointments, chairs] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          clinicId,
          appointmentDate: d,
          status: { notIn: ['cancelled'] },
        },
        include: {
          patient: { select: { id: true, fullName: true, phone: true } },
          dentist: { select: { id: true, fullName: true, avatarUrl: true } },
          chair:   true,
        },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.chair.findMany({
        where:   { clinicId, isActive: true },
        orderBy: { chairNumber: 'asc' },
      }),
    ]);

    // By dentist
    const dentistMap = new Map<string, any>();
    for (const appt of appointments) {
      const key = appt.dentistId;
      if (!dentistMap.has(key)) {
        dentistMap.set(key, { dentist: appt.dentist, appointments: [] });
      }
      dentistMap.get(key).appointments.push(appt);
    }

    // By chair
    const chairMap = chairs.map(chair => ({
      chair,
      appointments: appointments.filter(a => a.chairId === chair.id),
    }));

    return {
      date,
      byDentist: Array.from(dentistMap.values()),
      byChair:   chairMap,
      totalAppointments: appointments.length,
    };
  }

  /** Get all available time slots for a dentist on a date (not yet booked) */
  async getFreeSlots(clinicId: string, dentistId: string, date: string) {
    const d = new Date(date);
    const slots = await this.prisma.appointmentSlot.findMany({
      where: {
        clinicId,
        dentistId,
        slotDate:  d,
        isBooked:  false,
        isBlocked: false,
      },
      include: {
        chair: { select: { id: true, name: true, chairNumber: true, color: true } },
      },
      orderBy: { startTime: 'asc' },
    });
    return slots;
  }
}
