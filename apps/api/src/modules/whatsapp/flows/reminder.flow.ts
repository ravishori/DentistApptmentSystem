import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { TwilioSenderService } from '../templates/twilio-sender.service';
import { TemplateBuilder } from '../templates/template-builder';
import dayjs from 'dayjs';

/**
 * REMINDER FLOW
 *
 * Two cron-driven reminder windows:
 *   48h reminder  — cron: every 30 min, finds appointments tomorrow+1 day
 *   24h reminder  — cron: every 30 min, finds appointments tomorrow
 *
 * Each appointment tracks reminders via reminderStatus:
 *   pending → sent_48h → sent_24h → sent_followup
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
  ) {}

  // ── 48-hour reminder ──────────────────────────────────────────────────────
  // Runs every 30 min. Targets appointments exactly 48h away.

  @Cron('0 */30 * * * *', { name: 'reminder-48h' })
  async dispatch48h(): Promise<void> {
    const targetDate = dayjs().add(2, 'day').format('YYYY-MM-DD');

    const appointments = await this.prisma.appointment.findMany({
      where: {
        appointmentDate: new Date(targetDate),
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

        await this.prisma.appointment.update({
          where: { id: appt.id },
          data:  { reminderStatus: 'sent_48h', reminder24hAt: new Date() },
        });

        this.logger.log(`48h reminder sent → appt ${appt.id}`);
      } catch (err) {
        this.logger.error(`48h reminder failed → appt ${appt.id}: ${(err as Error).message}`);
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
        reminderStatus:  { in: ['pending', 'sent_48h'] },
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
      if (!appt.patient.phone) continue;

      try {
        // Send the template reminder first
        await this.sender.sendTemplate(
          TemplateBuilder.reminder24h({
            patientName: appt.patient.fullName,
            dentistName: appt.dentist.fullName,
            date:        dayjs(appt.appointmentDate).format('D MMM YYYY'),
            time:        appt.startTime.slice(0, 5),
            clinicName:  appt.clinic.name,
            to:          appt.patient.phone,
            from:        this.sender.fromNumber,
          }),
        );

        // Follow up with action buttons (opens 24h interactive window)
        await this.sender.sendButtons(
          appt.patient.phone,
          TemplateBuilder.buttons(
            `Quick actions for your appointment tomorrow:`,
            [
              { id: 'QUICK_CONFIRM',     title: '✅ Confirm'     },
              { id: 'QUICK_RESCHEDULE',  title: '🔄 Reschedule'  },
              { id: 'QUICK_CANCEL',      title: '❌ Cancel'      },
            ],
          ),
        );

        await this.prisma.appointment.update({
          where: { id: appt.id },
          data:  { reminderStatus: 'sent_24h', reminder2hAt: new Date() },
        });

        this.logger.log(`24h reminder + buttons sent → appt ${appt.id}`);
      } catch (err) {
        this.logger.error(`24h reminder failed → appt ${appt.id}: ${(err as Error).message}`);
      }
    }
  }

  // ── Event-driven: appointment.booked ─────────────────────────────────────
  // Instant confirmation right after booking.

  @OnEvent('appointment.booked')
  async onAppointmentBooked({ appointment, clinicId }: any): Promise<void> {
    const { patient, dentist, clinic } = appointment;
    if (!patient?.waOptIn || !patient?.phone) return;

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
      this.logger.error(`Booking confirmation failed: ${(err as Error).message}`);
    }
  }
}
