import {
  Injectable, NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { GenerateSlotsDto, BlockSlotDto } from './dto/generate-slots.dto';
import dayjs from 'dayjs';

@Injectable()
export class SlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache:  CacheService,
  ) {}

  // ── Get available slots ──────────────────────────────────────────────────

  /** Dates are plain calendar days (YYYY-MM-DD); anything else is a client error, not a database error. */
  private assertCalendarDate(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || Number.isNaN(new Date(date).getTime())) {
      throw new BadRequestException('date must be a valid YYYY-MM-DD date');
    }
  }

  /**
   * Every slot of a dentist on a day with its state (free, booked, blocked + reason) so reception can block and unblock.
   * Not cached: the clinic must see the current state. Always scoped to the caller's clinic.
   */
  async listForDay(clinicId: string, dentistId: string, date: string) {
    this.assertCalendarDate(date);
    return this.prisma.appointmentSlot.findMany({
      where:   { clinicId, dentistId, slotDate: new Date(date) },
      select:  { id: true, dentistId: true, slotDate: true, startTime: true, endTime: true, isBooked: true, isBlocked: true, blockReason: true },
      orderBy: { startTime: 'asc' },
    });
  }

  async getAvailable(clinicId: string, dentistId: string, date: string) {
    this.assertCalendarDate(date);
    const key = CacheService.keys.slots(clinicId, dentistId, date);
    return this.cache.wrap(
      key,
      () =>
        this.prisma.appointmentSlot.findMany({
          where:   { clinicId, dentistId, slotDate: new Date(date), isBooked: false, isBlocked: false },
          orderBy: { startTime: 'asc' },
        }),
      120, // 2-min TTL — slot availability changes frequently
    );
  }

  // ── Generate slots for a dentist on a given day ─────────────────────────

  async generate(clinicId: string, dto: GenerateSlotsDto) {
    const { dentistId, date, workStart, workEnd, slotDuration, breakStart, breakEnd } = dto;

    // Verify dentist belongs to clinic
    const dentist = await this.prisma.user.findFirst({
      where: { id: dentistId, clinicId },
    });
    if (!dentist) throw new NotFoundException('Dentist not found in this clinic');

    if (workStart >= workEnd) throw new BadRequestException('workEnd must be after workStart');
    if (!!breakStart !== !!breakEnd) throw new BadRequestException('breakStart and breakEnd must be given together');
    if (breakStart && breakEnd && breakStart >= breakEnd) {
      throw new BadRequestException('breakEnd must be after breakStart');
    }

    // Delete existing UN-booked, un-blocked slots for this day (safe to regenerate)
    await this.prisma.appointmentSlot.deleteMany({
      where: { clinicId, dentistId, slotDate: new Date(date), isBooked: false, isBlocked: false },
    });

    // Build slot grid
    const slotDate = new Date(date);
    const slots: {
      clinicId:   string; dentistId: string; slotDate: Date;
      startTime:  string; endTime:   string;
    }[] = [];

    let cursor = dayjs(`${date} ${workStart}`);
    const end  = dayjs(`${date} ${workEnd}`);

    while (cursor.isBefore(end)) {
      const next = cursor.add(slotDuration, 'minute');
      if (next.isAfter(end)) break;

      const inBreak =
        breakStart && breakEnd &&
        cursor.isBefore(dayjs(`${date} ${breakEnd}`)) &&
        next.isAfter(dayjs(`${date} ${breakStart}`));

      if (!inBreak) {
        slots.push({
          clinicId,
          dentistId,
          slotDate,
          startTime: cursor.format('HH:mm:ss'),
          endTime:   next.format('HH:mm:ss'),
        });
      }
      cursor = next;
    }

    await this.prisma.appointmentSlot.createMany({ data: slots, skipDuplicates: true });

    // Invalidate cache for this dentist/day
    await this.cache.del(CacheService.keys.slots(clinicId, dentistId, date));

    return { generated: slots.length, date, dentistId };
  }

  // ── Block / unblock a slot ───────────────────────────────────────────────

  async block(clinicId: string, dto: BlockSlotDto) {
    const slot = await this.prisma.appointmentSlot.findFirst({
      where: { id: dto.slotId, clinicId },
    });
    if (!slot)         throw new NotFoundException('Slot not found');
    if (slot.isBooked) throw new ConflictException('Cannot block an already-booked slot');

    const updated = await this.prisma.appointmentSlot.update({
      where: { id: dto.slotId },
      data:  { isBlocked: true, blockReason: dto.reason },
    });

    await this.cache.del(CacheService.keys.slots(clinicId, slot.dentistId, slot.slotDate.toISOString().split('T')[0]));
    return updated;
  }

  async unblock(clinicId: string, slotId: string) {
    const slot = await this.prisma.appointmentSlot.findFirst({
      where: { id: slotId, clinicId },
    });
    if (!slot) throw new NotFoundException('Slot not found');

    const updated = await this.prisma.appointmentSlot.update({
      where: { id: slotId },
      data:  { isBlocked: false, blockReason: null },
    });
    await this.cache.del(CacheService.keys.slots(clinicId, slot.dentistId, slot.slotDate.toISOString().split('T')[0]));
    return updated;
  }
}
