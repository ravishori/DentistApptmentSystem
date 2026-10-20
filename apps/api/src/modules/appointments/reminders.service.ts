import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import dayjs from 'dayjs';
import { claimReminder, confirmReminder, releaseReminder, ReminderStep } from './reminder-claim';
import { twoHourWindow, isInTwoHourWindow } from './reminder-window';

/**
 * RemindersService — cron-driven appointment reminder dispatcher.
 *
 * Runs every 30 minutes and emits domain events consumed by
 * WhatsApp / Notification modules via EventEmitter2.
 * Duplicate-safe and retry-safe: each send is wrapped in an atomic claim → deliver → confirm/release
 * (see reminder-claim.ts). A failed delivery releases the claim so the next tick retries; the status only
 * advances after delivery succeeded.
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
    // 24h reminders and follow-ups are owned by ReminderFlow / FollowupFlow, which pin delivery to the configured
    // provider with safe failover. Running them here too would let two schedulers race over the same appointment.
    // The 2h reminder exists only on the event → 360Dialog path (Twilio has no 2h template), so it stays here.
    await this.send2h();
  }

  /** Claim, emit and AWAIT the listeners, then confirm; on any failure release so it is retried. */
  private async deliver(apptId: string, step: ReminderStep, event: string, appointment: unknown): Promise<void> {
    if (!(await claimReminder(this.prisma, apptId, step))) return;   // someone else owns it / already sent
    try {
      await this.emitter.emitAsync(event, { appointment });          // listeners use suppressErrors:false → rejects on failure
      await confirmReminder(this.prisma, apptId, step);
    } catch (err) {
      await releaseReminder(this.prisma, apptId, step);
      this.logger.error(`${step} reminder delivery failed → appt ${apptId}: ${(err as Error).message} (will retry)`);
    }
  }

  // ── 2-hour reminder ─────────────────────────────────────────────────────

  private async send2h() {
    // Real date-time window (may span two calendar dates), not a time-of-day string compare — see reminder-window.ts
    const now = new Date();
    const { dates } = twoHourWindow(now);

    const candidates = await this.prisma.appointment.findMany({
      where: {
        appointmentDate: { in: dates.map((d) => new Date(d)) },
        // never remind about a cancelled / completed / no-show appointment (the reminder status survives those)
        status:          { in: ['scheduled', 'confirmed'] },
        reminderStatus:  'sent_24h',
        patient:         { waOptIn: true },
      },
      include: {
        // waOptIn MUST be selected: the 360Dialog listener re-checks consent on this payload and silently skips
        // (while the scheduler marks the reminder sent) when the flag is missing
        patient: { select: { id: true, fullName: true, phone: true, waOptIn: true } },
        clinic:  { select: { id: true, name: true } },
      },
    });
    const appts = candidates.filter((a) => isInTwoHourWindow(a.appointmentDate, a.startTime, now));

    for (const appt of appts) {
      await this.deliver(appt.id, '2h', 'appointment.reminder_2h', appt);
    }
  }
}
