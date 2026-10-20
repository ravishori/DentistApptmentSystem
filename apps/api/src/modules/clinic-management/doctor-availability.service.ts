import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateAvailabilityDto, UpdateAvailabilityDto,
  CreateScheduleOverrideDto, GenerateSlotsDto, AvailabilityQueryDto,
  DayOfWeek,
} from './dto/clinic-management.dto';
import { ChairsService } from './chairs.service';

const DAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

@Injectable()
export class DoctorAvailabilityService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly chairs:   ChairsService,
  ) {}

  // ── Availability rules ────────────────────────────────────────────────────

  async createAvailability(clinicId: string, dto: CreateAvailabilityDto) {
    await this.assertDentist(clinicId, dto.dentistId);
    this.validateTimeRange(dto.startTime, dto.endTime);
    this.validateRule(dto.startTime, dto.endTime, dto.slotMins ?? 30, dto.validFrom, dto.validUntil);
    await this.assertNoRuleOverlap(clinicId, dto.dentistId, dto.dayOfWeek, dto.startTime, dto.endTime,
      dto.validFrom, dto.validUntil);

    return this.prisma.doctorAvailability.create({
      data: {
        clinicId,
        dentistId:  dto.dentistId,
        dayOfWeek:  dto.dayOfWeek as any,
        startTime:  dto.startTime,
        endTime:    dto.endTime,
        slotMins:   dto.slotMins ?? 30,
        validFrom:  dto.validFrom  ? new Date(dto.validFrom)  : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      },
      include: { dentist: { select: { id: true, fullName: true } } },
    });
  }

  async listAvailabilities(clinicId: string, dentistId?: string) {
    return this.prisma.doctorAvailability.findMany({
      where:   { clinicId, ...(dentistId && { dentistId }), isActive: true },
      include: { dentist: { select: { id: true, fullName: true } } },
      orderBy: [{ dentistId: 'asc' }, { dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async updateAvailability(clinicId: string, id: string, dto: UpdateAvailabilityDto) {
    const avail = await this.prisma.doctorAvailability.findFirst({ where: { id, clinicId } });
    if (!avail) throw new NotFoundException('Availability rule not found');

    const startTime = dto.startTime ?? avail.startTime;
    const endTime   = dto.endTime   ?? avail.endTime;
    const slotMins  = dto.slotMins  ?? avail.slotMins;
    const validFrom  = dto.validFrom  ?? avail.validFrom?.toISOString().split('T')[0];
    const validUntil = dto.validUntil ?? avail.validUntil?.toISOString().split('T')[0];
    this.validateTimeRange(startTime, endTime);
    this.validateRule(startTime, endTime, slotMins, validFrom, validUntil);
    if (dto.isActive !== false) {
      await this.assertNoRuleOverlap(clinicId, avail.dentistId, avail.dayOfWeek, startTime, endTime,
        validFrom, validUntil, id);
    }

    const { validFrom: vf, validUntil: vu, ...rest } = dto;
    return this.prisma.doctorAvailability.update({
      where: { id },
      data: {
        ...rest,
        ...(vf && { validFrom:  new Date(vf) }),
        ...(vu && { validUntil: new Date(vu) }),
      } as any,
    });
  }

  async deleteAvailability(clinicId: string, id: string) {
    const avail = await this.prisma.doctorAvailability.findFirst({ where: { id, clinicId } });
    if (!avail) throw new NotFoundException('Availability rule not found');
    return this.prisma.doctorAvailability.update({ where: { id }, data: { isActive: false } });
  }

  // ── Schedule overrides ────────────────────────────────────────────────────

  async createOverride(clinicId: string, dto: CreateScheduleOverrideDto) {
    await this.assertDentist(clinicId, dto.dentistId);
    if (isNaN(new Date(dto.date).getTime())) throw new BadRequestException('Invalid date');

    if (dto.type === 'working') {
      if (!dto.startTime || !dto.endTime) {
        throw new BadRequestException('startTime and endTime required for working override');
      }
      this.validateTimeRange(dto.startTime, dto.endTime);
    }

    if (dto.chairId) {
      const chair = await this.prisma.chair.findFirst({ where: { id: dto.chairId, clinicId } });
      if (!chair) throw new NotFoundException('Chair not found in this clinic');
    }

    return this.prisma.doctorSchedule.upsert({
      where: { clinicId_dentistId_date: { clinicId, dentistId: dto.dentistId, date: new Date(dto.date) } },
      create: {
        clinicId,
        dentistId:  dto.dentistId,
        date:       new Date(dto.date),
        type:       dto.type as any,
        startTime:  dto.startTime,
        endTime:    dto.endTime,
        chairId:    dto.chairId,
        reason:     dto.reason,
      },
      update: {
        type:      dto.type as any,
        startTime: dto.startTime,
        endTime:   dto.endTime,
        chairId:   dto.chairId,
        reason:    dto.reason,
      },
    });
  }

  async listOverrides(clinicId: string, dentistId: string, from: string, to: string) {
    this.assertDateRange(from, to);
    return this.prisma.doctorSchedule.findMany({
      where: {
        clinicId,
        dentistId,
        date: { gte: new Date(from), lte: new Date(to) },
      },
      orderBy: { date: 'asc' },
    });
  }

  // ── Availability check ────────────────────────────────────────────────────

  async getAvailability(clinicId: string, query: AvailabilityQueryDto) {
    const { dentistId, from, to } = query;
    this.assertDateRange(from, to);

    const dentists = dentistId
      ? [await this.prisma.user.findFirst({
          where: { id: dentistId, clinicId, role: 'dentist' },
          select: { id: true, fullName: true, avatarUrl: true },
        })]
      : await this.prisma.user.findMany({
          where:  { clinicId, role: 'dentist', isActive: true },
          select: { id: true, fullName: true, avatarUrl: true },
          orderBy: { fullName: 'asc' },
        });

    const fromDate = new Date(from);
    const toDate   = new Date(to);
    const days     = this.eachDay(fromDate, toDate);

    const result: Array<{ dentist: any; schedule: ReturnType<typeof days.map> }> = [];
    for (const dentist of dentists) {
      if (!dentist) continue;

      const rules = await this.prisma.doctorAvailability.findMany({
        where: { clinicId, dentistId: dentist.id, isActive: true },
      });

      const overrides = await this.prisma.doctorSchedule.findMany({
        where: { clinicId, dentistId: dentist.id, date: { gte: fromDate, lte: toDate } },
      });

      const bookedSlots = await this.prisma.appointmentSlot.findMany({
        where: {
          clinicId,
          dentistId: dentist.id,
          slotDate:  { gte: fromDate, lte: toDate },
        },
        include: {
          appointment: {
            include: { patient: { select: { id: true, fullName: true } } },
          },
        },
      });

      const schedule = days.map(day => {
        const dayStr = day.toISOString().split('T')[0];
        const dow    = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][day.getDay()];

        const override = overrides.find(o =>
          new Date(o.date).toISOString().split('T')[0] === dayStr,
        );

        if (override?.type !== 'working' && override) {
          return { date: dayStr, status: override.type, slots: [], dentist };
        }

        const dayRules = rules.filter(r => r.dayOfWeek === dow && (
          (!r.validFrom  || new Date(r.validFrom)  <= day) &&
          (!r.validUntil || new Date(r.validUntil) >= day)
        ));

        if (!dayRules.length && !override) {
          return { date: dayStr, status: 'unavailable', slots: [], dentist };
        }

        const workStart = override?.startTime ?? dayRules[0]?.startTime ?? '09:00';
        const workEnd   = override?.endTime   ?? dayRules[0]?.endTime   ?? '18:00';
        const slotMins  = dayRules[0]?.slotMins ?? 30;

        const slots = bookedSlots
          .filter(s => s.slotDate.toISOString().split('T')[0] === dayStr)
          .map(s => ({
            id:        s.id,
            startTime: s.startTime,
            endTime:   s.endTime,
            isBooked:  s.isBooked,
            isBlocked: s.isBlocked,
            chairId:   s.chairId,
            patient:   s.appointment?.patient ?? null,
          }));

        return {
          date:       dayStr,
          status:     'working',
          workStart,
          workEnd,
          slotMins,
          slots,
          dentist,
        };
      });

      result.push({ dentist, schedule });
    }

    return result;
  }

  // ── Slot generation ───────────────────────────────────────────────────────

  async generateSlots(clinicId: string, dto: GenerateSlotsDto) {
    await this.assertDentist(clinicId, dto.dentistId);
    this.assertDateRange(dto.from, dto.to);

    const fromDate = new Date(dto.from);
    const toDate   = new Date(dto.to);
    const days     = this.eachDay(fromDate, toDate);

    const rules = await this.prisma.doctorAvailability.findMany({
      where: { clinicId, dentistId: dto.dentistId, isActive: true },
    });
    if (!rules.length) throw new BadRequestException('No availability rules found for this dentist');

    const overrides = await this.prisma.doctorSchedule.findMany({
      where: { clinicId, dentistId: dto.dentistId, date: { gte: fromDate, lte: toDate } },
    });

    let created = 0;
    let skipped = 0;

    for (const day of days) {
      const dayStr = day.toISOString().split('T')[0];
      const dow    = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][day.getDay()];

      const override = overrides.find(o =>
        new Date(o.date).toISOString().split('T')[0] === dayStr,
      );
      if (override && override.type !== 'working') continue;

      const dayRules = rules.filter(r => r.dayOfWeek === dow && (
        (!r.validFrom  || new Date(r.validFrom)  <= day) &&
        (!r.validUntil || new Date(r.validUntil) >= day)
      ));
      if (!dayRules.length) continue;

      const effective = override?.startTime && override?.endTime
        ? [{ ...dayRules[0], startTime: override.startTime, endTime: override.endTime }]
        : dayRules;

      for (const rule of effective) {
        const start = rule.startTime;
        const end   = rule.endTime;
        const slotMins = rule.slotMins;

        const timeSlots = this.buildTimeSlots(start, end, slotMins);

        for (const { startTime, endTime } of timeSlots) {
          const existing = await this.prisma.appointmentSlot.findUnique({
            where: {
              clinicId_dentistId_slotDate_startTime: {
                clinicId,
                dentistId: dto.dentistId,
                slotDate:  day,
                startTime,
              },
            },
          });
          if (existing) { skipped++; continue; }

          let chairId: string | null = null;
          if (dto.autoAssignChair) {
            chairId = await this.chairs.nextFreeChair(clinicId, dayStr, startTime, endTime);
          }

          await this.prisma.appointmentSlot.create({
            data: {
              clinicId,
              dentistId: dto.dentistId,
              slotDate:  day,
              startTime,
              endTime,
              chairId:   chairId ?? undefined,
            },
          });
          created++;
        }
      }
    }

    return { created, skipped, from: dto.from, to: dto.to };
  }

  // ── Doctor list ───────────────────────────────────────────────────────────

  async getDoctors(clinicId: string) {
    return this.prisma.user.findMany({
      where:   { clinicId, role: 'dentist', isActive: true },
      select:  {
        id: true, fullName: true, email: true, phone: true,
        specialization: true, registrationNumber: true, avatarUrl: true,
        availabilities: {
          where:   { isActive: true },
          orderBy: { dayOfWeek: 'asc' },
        },
      },
      orderBy: { fullName: 'asc' },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async assertDentist(clinicId: string, dentistId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: dentistId, clinicId, role: 'dentist' },
    });
    if (!user) throw new NotFoundException('Dentist not found in this clinic');
    return user;
  }

  private static readonly MAX_RANGE_DAYS = 92;
  private static readonly TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  private assertDateRange(from: string, to: string) {
    const f = new Date(from), t = new Date(to);
    if (isNaN(f.getTime()) || isNaN(t.getTime())) throw new BadRequestException('Invalid date range');
    if (f > t) throw new BadRequestException('from must not be after to');
    if ((t.getTime() - f.getTime()) / 86400000 > DoctorAvailabilityService.MAX_RANGE_DAYS) {
      throw new BadRequestException(`Date range must not exceed ${DoctorAvailabilityService.MAX_RANGE_DAYS} days`);
    }
  }

  private validateRule(start: string, end: string, slotMins: number, validFrom?: string, validUntil?: string) {
    const re = DoctorAvailabilityService.TIME_RE;
    if (!re.test(start) || !re.test(end)) throw new BadRequestException('Times must be HH:MM (00:00-23:59)');
    if (!Number.isInteger(slotMins) || slotMins < 10 || slotMins > 120) {
      throw new BadRequestException('slotMins must be an integer between 10 and 120');
    }
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if ((eh * 60 + em) - (sh * 60 + sm) < slotMins) {
      throw new BadRequestException('Working window is shorter than one slot');
    }
    if (validFrom && validUntil && new Date(validFrom) > new Date(validUntil)) {
      throw new BadRequestException('validFrom must not be after validUntil');
    }
  }

  private async assertNoRuleOverlap(
    clinicId: string, dentistId: string, dayOfWeek: string,
    start: string, end: string, validFrom?: string, validUntil?: string, excludeId?: string,
  ) {
    const others = await this.prisma.doctorAvailability.findMany({
      where: { clinicId, dentistId, dayOfWeek: dayOfWeek as any, isActive: true,
               ...(excludeId && { id: { not: excludeId } }) },
    });
    const fromA = validFrom  ? new Date(validFrom).getTime()  : -Infinity;
    const toA   = validUntil ? new Date(validUntil).getTime() : Infinity;
    for (const o of others) {
      const fromB = o.validFrom  ? new Date(o.validFrom).getTime()  : -Infinity;
      const toB   = o.validUntil ? new Date(o.validUntil).getTime() : Infinity;
      const datesOverlap = fromA <= toB && fromB <= toA;
      const timesOverlap = start < o.endTime && o.startTime < end;
      if (datesOverlap && timesOverlap) {
        throw new ConflictException('Overlaps an existing availability rule for this day');
      }
    }
  }

  private validateTimeRange(start: string, end: string) {
    if (start >= end) {
      throw new BadRequestException('endTime must be after startTime');
    }
  }

  private eachDay(from: Date, to: Date): Date[] {
    const days: Date[] = [];
    const cur = new Date(from);
    while (cur <= to) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  private buildTimeSlots(
    start: string,
    end: string,
    slotMins: number,
  ): { startTime: string; endTime: string }[] {
    const slots: { startTime: string; endTime: string }[] = [];
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let cur = sh * 60 + sm;
    const endMins = eh * 60 + em;

    while (cur + slotMins <= endMins) {
      const s = `${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`;
      const e = `${String(Math.floor((cur + slotMins) / 60)).padStart(2, '0')}:${String((cur + slotMins) % 60).padStart(2, '0')}`;
      slots.push({ startTime: s, endTime: e });
      cur += slotMins;
    }
    return slots;
  }
}
