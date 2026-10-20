import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import dayjs from 'dayjs';

/**
 * RemindersService — cron-driven appointment reminder dispatcher.
 *
 * Runs every 30 minutes and emits domain events consumed by
 * WhatsApp / Notification modules via EventEmitter2.
 * Each appointment row carries a `reminderStatus` to prevent duplicate sends.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly emitter: EventEmitter2,
  ) {}

  @Cron('0 */30 * * * *', { name: 'appointment-reminders' })
  async dispatch() {
    this.logger.debug('Reminder cron tick');
    await Promise.all([this.send24h(), this.send2h(), this.sendFollowup()]);
  }

  // ── 24-hour reminder ────────────────────────────────────────────────────

  private async send24h() {
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');

    const appts = await this.prisma.appointment.findMany({
      where: {
        appointmentDate: new Date(tomorrow),
        status:          'scheduled',
        reminderStatus:  'pending',
        patient:         { waOptIn: true },
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, waOptIn: true } },
        dentist: { select: { fullName: true } },
        clinic:  { select: { id: true, name: true } },
      },
    });

    for (const appt of appts) {
      this.emitter.emit('appointment.reminder_24h', { appointment: appt });

      await this.prisma.appointment.update({
        where: { id: appt.id },
        data:  { reminderStatus: 'sent_24h', reminder24hAt: new Date() },
      });

      this.logger.log(`24h reminder queued → appt ${appt.id}`);
    }
  }

  // ── 2-hour reminder ─────────────────────────────────────────────────────

  private async send2h() {
    const today   = dayjs().format('YYYY-MM-DD');
    const nowTime = dayjs().format('HH:mm:ss');
    const in2h    = dayjs().add(2, 'hour').format('HH:mm:ss');

    const appts = await this.prisma.appointment.findMany({
      where: {
        appointmentDate: new Date(today),
        startTime:       { gte: nowTime, lte: in2h },
        reminderStatus:  'sent_24h',
        patient:         { waOptIn: true },
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        clinic:  { select: { id: true, name: true } },
      },
    });

    for (const appt of appts) {
      this.emitter.emit('appointment.reminder_2h', { appointment: appt });

      await this.prisma.appointment.update({
        where: { id: appt.id },
        data:  { reminderStatus: 'sent_2h', reminder2hAt: new Date() },
      });
    }
  }

  // ── Post-visit follow-up (sent 24h after completion) ────────────────────

  private async sendFollowup() {
    const threshold = dayjs().subtract(24, 'hour').toDate();

    const appts = await this.prisma.appointment.findMany({
      where: {
        status:         'completed',
        reminderStatus: 'sent_2h',
        updatedAt:      { lte: threshold },
        patient:        { waOptIn: true },
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        dentist: { select: { fullName: true } },
        clinic:  { select: { id: true, name: true } },
      },
    });

    for (const appt of appts) {
      this.emitter.emit('appointment.followup', { appointment: appt });

      await this.prisma.appointment.update({
        where: { id: appt.id },
        data:  { reminderStatus: 'sent_followup', followupSentAt: new Date() },
      });
    }
  }
}
