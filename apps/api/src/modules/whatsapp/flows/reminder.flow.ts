import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { TwilioSenderService } from '../templates/twilio-sender.service';
import { TemplateBuilder } from '../templates/template-builder';
import { WhatsappProviderPolicy } from '../whatsapp-provider.policy';
import { WhatsappService } from '../whatsapp.service';
import { deliverWithFailover, orderFor, rememberIfAmbiguous, ambiguityKey, DeliveryError } from '../reminder-delivery';
import dayjs from 'dayjs';
import { claimReminder, confirmReminder, releaseReminder } from '../../appointments/reminder-claim';
import { errText } from '../../../common/observability/redaction';

/**
 * REMINDER FLOW
 *
 * Two cron-driven reminder windows:
 *   48h reminder  — cron: every 30 min, finds appointments tomorrow+1 day
 *   24h reminder  — cron: every 30 min, finds appointments tomorrow
 *
 * Each appointment tracks reminders via reminderStatus:
 *   pending → sent_24h → sent_followup
 *   (the 48h reminder has no persisted state: ReminderStatus has no sent_48h value; it is
 *    sent once by a 30-minute sliding window over appointment start time — see dispatch48h)
 *
 * The 24h reminder uses interactive buttons so patients can confirm/reschedule
 * directly from the message — driving them into the session-based flows.
 */

@Injectable()
export class ReminderFlow {
  private readonly logger = new Logger(ReminderFlow.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly sender:  TwilioSenderService,
    @Optional() private readonly policy?: WhatsappProviderPolicy,
    @Optional() private readonly whatsapp?: WhatsappService,
  ) {}

  // ── 48-hour reminder ──────────────────────────────────────────────────────
  // Runs every 30 min. Targets appointments exactly 48h away.

  @Cron('0 */30 * * * *', { name: 'reminder-48h' })
  async dispatch48h(): Promise<void> {
    // Stateless idempotency: each run owns the half-open window [now+48h, now+48h+30min),
    // so an appointment falls in exactly one run. A missed run skips the reminder rather than spamming.
    const windowStart = dayjs().add(48, 'hour');
    const windowEnd   = windowStart.add(30, 'minute');
    const dates = [...new Set([windowStart, windowEnd].map((d) => d.format('YYYY-MM-DD')))];

    const candidates = await this.prisma.appointment.findMany({
      where: {
        appointmentDate: { in: dates.map((d) => new Date(d)) },
        status:          { in: ['scheduled', 'confirmed'] },
        reminderStatus:  'pending',
        patient:         { waOptIn: true },
      },
      include: {
        patient: { select: { fullName: true, phone: true } },
        dentist: { select: { fullName: true } },
        clinic:  { select: { name: true } },
      },
    });
    const appointments = candidates.filter((a) => {
      const start = dayjs(`${dayjs(a.appointmentDate).format('YYYY-MM-DD')} ${a.startTime}`);
      return !start.isBefore(windowStart) && start.isBefore(windowEnd);
    });

    this.logger.log(`48h reminder batch: ${appointments.length} appointments`);

    for (const appt of appointments) {
      if (!appt.patient.phone) continue;

      try {
        await this.sender.sendTemplate(
          TemplateBuilder.reminder48h({
            patientName: appt.patient.fullName,
            dentistName: appt.dentist.fullName,
            date:        dayjs(appt.appointmentDate).format('D MMM YYYY'),
            time:        appt.startTime.slice(0, 5),
            clinicName:  appt.clinic.name,
            to:          appt.patient.phone,
            from:        this.sender.fromNumber,
          }),
        );

        this.logger.log(`48h reminder sent → appt ${appt.id}`);
      } catch (err) {
        this.logger.error(`48h reminder failed → appt ${appt.id}: ${errText(err)}`);
      }
    }
  }

  // ── 24-hour reminder ──────────────────────────────────────────────────────
  // Also includes interactive CONFIRM / RESCHEDULE / CANCEL buttons.

  @Cron('15 */30 * * * *', { name: 'reminder-24h' })
  async dispatch24h(): Promise<void> {
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');

    const appointments = await this.prisma.appointment.findMany({
      where: {
        appointmentDate: new Date(tomorrow),
        status:          { in: ['scheduled', 'confirmed'] },
        reminderStatus:  'pending',
        patient:         { waOptIn: true },
      },
      include: {
        patient: { select: { fullName: true, phone: true } },
        dentist: { select: { fullName: true } },
        clinic:  { select: { name: true, phone: true } },
      },
    });

    this.logger.log(`24h reminder batch: ${appointments.length} appointments`);

    for (const appt of appointments) {
      const phone = appt.patient.phone;
      if (!phone) continue;

      // Atomic claim (shared protocol): only one scheduler / instance may deliver this reminder
      if (!(await claimReminder(this.prisma, appt.id, '24h'))) continue;

      // Twilio: template, then quick-action buttons. A button failure must not cause the template to be re-sent,
      // so it is logged and the reminder still counts as delivered.
      const viaTwilio = async () => {
        await this.sender.sendTemplate(
          TemplateBuilder.reminder24h({
            patientName: appt.patient.fullName,
            dentistName: appt.dentist.fullName,
            date:        dayjs(appt.appointmentDate).format('D MMM YYYY'),
            time:        appt.startTime.slice(0, 5),
            clinicName:  appt.clinic.name,
            to:          phone,
            from:        this.sender.fromNumber,
          }),
        );
        try {
          await this.sender.sendButtons(
            phone,
            TemplateBuilder.buttons(
              `Quick actions for your appointment tomorrow:`,
              [
                { id: 'QUICK_CONFIRM',     title: '✅ Confirm'     },
                { id: 'QUICK_RESCHEDULE',  title: '🔄 Reschedule'  },
                { id: 'QUICK_CANCEL',      title: '❌ Cancel'      },
              ],
            ),
          );
        } catch (err) {
          this.logger.warn(`24h quick-action buttons failed → appt ${appt.id}: ${errText(err)}`);
        }
      };

      // 360Dialog: template only (no interactive buttons on this path)
      const via360 = async () => {
        const sent = await this.whatsapp!.sendReminder24h(appt.clinicId, phone, {
          patientName: appt.patient.fullName,
          dentistName: appt.dentist.fullName,
          date:        dayjs(appt.appointmentDate).format('D MMM YYYY'),
          time:        appt.startTime.slice(0, 5),
          clinicName:  appt.clinic.name,
        });
        if (sent.status === 'failed') {
          throw Object.assign(new Error(sent.failureReason ?? 'WhatsApp delivery failed'), { httpStatus: (sent as { httpStatus?: number }).httpStatus });
        }
      };

      const plan = { twilio: viaTwilio, ...(this.whatsapp ? { '360dialog': via360 } : {}) };
      const key = ambiguityKey('24h', appt.id);
      try {
        const { provider } = await deliverWithFailover(
          await orderFor(this.policy, key, plan),
          plan,
          (from, to) => this.logger.warn(`24h reminder ${from} rejected the message → failing over to ${to} (appt ${appt.id})`),
        );
        await confirmReminder(this.prisma, appt.id, '24h');
        this.logger.log(`24h reminder sent via ${provider} → appt ${appt.id}`);
      } catch (err) {
        await rememberIfAmbiguous(key, err);   // pin retries to the provider whose outcome is unknown
        await releaseReminder(this.prisma, appt.id, '24h');   // nothing confirmed delivered → retried next tick
        const tried = err instanceof DeliveryError ? err.tried.join(',') : '?';
        this.logger.error(`24h reminder failed (tried: ${tried}) → appt ${appt.id}: ${errText(err)} — will retry`);
      }
    }
  }

  // ── Event-driven: appointment.booked ─────────────────────────────────────
  // Instant confirmation right after booking.

  @OnEvent('appointment.booked')
  async onAppointmentBooked({ appointment, clinicId }: any): Promise<void> {
    const { patient, dentist, clinic } = appointment;
    if (!patient?.waOptIn || !patient?.phone) return;
    // WhatsappService (360Dialog) also listens to this event: exactly ONE provider confirms a booking
    if (this.policy && !this.policy.shouldSend('twilio')) return;

    try {
      await this.sender.sendTemplate(
        TemplateBuilder.appointmentConfirmation({
          patientName: patient.fullName,
          dentistName: dentist.fullName,
          date:        dayjs(appointment.appointmentDate).format('D MMM YYYY'),
          time:        appointment.startTime.slice(0, 5),
          clinicName:  clinic.name,
          to:          patient.phone,
          from:        this.sender.fromNumber,
        }),
      );
    } catch (err) {
      this.logger.error(`Booking confirmation failed: ${errText(err)}`);
    }
  }
}
