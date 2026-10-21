import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';
import dayjs from 'dayjs';
import { maskPhone } from '../../common/observability/redaction';

/**
 * @deprecated NOT REGISTERED in any module and intentionally left that way.
 * Every handler here is already implemented by WhatsappService (@OnEvent listeners for booked,
 * reminder_24h/2h and followup) and by the ReminderFlow/FollowupFlow crons. Registering this class would
 * send each WhatsApp message twice, and its 24h follow-up uses an in-memory setTimeout that is lost on restart.
 * Kept only so it compiles; remove it once the owner approves deleting the file.
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wa:     WhatsappService,
  ) {}

  @OnEvent('appointment.booked')
  async onBooked({ appointment, clinicId }: { appointment: any; clinicId: string }) {
    const p = appointment.patient;
    if (!p?.waOptIn || !p?.phone) return;

    await this.wa.sendAppointmentConfirmation(clinicId, p.phone, {
      patientName: p.fullName,
      dentistName: appointment.dentist?.fullName ?? 'our dentist',
      date:        dayjs(appointment.appointmentDate).format('DD MMM YYYY'),
      time:        appointment.startTime,
      clinicName:  appointment.clinic?.name ?? 'the clinic',
    });
    this.logger.log(`Confirmation sent → ${maskPhone(p.phone)} for appt ${appointment.id}`);
  }

  @OnEvent('appointment.reminder_24h')
  async onReminder24h({ appointment }: { appointment: any }) {
    const p = appointment.patient;
    if (!p?.waOptIn || !p?.phone) return;
    if (appointment.reminderStatus !== 'pending') return;

    await this.wa.sendReminder24h(appointment.clinicId, p.phone, {
      patientName: p.fullName,
      dentistName: appointment.dentist?.fullName ?? 'our dentist',
      date:        dayjs(appointment.appointmentDate).format('DD MMM YYYY'),
      time:        appointment.startTime,
      clinicName:  '',
    });

    await this.prisma.appointment.update({
      where: { id: appointment.id },
      data:  { reminderStatus: 'sent_24h' as any, reminder24hAt: new Date() },
    });
  }

  @OnEvent('appointment.reminder_2h')
  async onReminder2h({ appointment }: { appointment: any }) {
    const p = appointment.patient;
    if (!p?.waOptIn || !p?.phone) return;

    await this.wa.sendReminder2h(appointment.clinicId, p.phone, {
      patientName: p.fullName,
      time:        appointment.startTime,
      clinicName:  '',
    });

    await this.prisma.appointment.update({
      where: { id: appointment.id },
      data:  { reminderStatus: 'sent_2h' as any, reminder2hAt: new Date() },
    });
  }

  @OnEvent('appointment.completed')
  async onCompleted({ appointment }: { appointment: any }) {
    const p = appointment.patient;
    if (!p?.waOptIn || !p?.phone) return;

    setTimeout(async () => {
      await this.wa.sendFollowup(appointment.clinicId, p.phone, {
        patientName: p.fullName,
        dentistName: appointment.dentist?.fullName ?? 'our dentist',
        clinicName:  '',
      });
    }, 24 * 60 * 60 * 1000);
  }

  @OnEvent('appointment.cancelled')
  async onCancelled({ appointment }: { appointment: any }) {
    const p = appointment.patient;
    if (!p?.waOptIn || !p?.phone) return;

    await this.wa.sendText(
      appointment.clinicId, p.phone,
      `Hi ${p.fullName}, your appointment on ${dayjs(appointment.appointmentDate).format('DD MMM')} ` +
      `has been cancelled. To rebook, reply with *BOOK* or visit our website.`,
    );
  }

  @OnEvent('invoice.sent')
  async onInvoiceSent({ invoice, paymentLink }: { invoice: any; paymentLink: string }) {
    const p = invoice.patient;
    if (!p?.waOptIn || !p?.phone) return;

    await this.wa.sendInvoiceLink(invoice.clinicId, p.phone, {
      patientName:   p.fullName,
      invoiceNumber: invoice.invoiceNumber,
      amount:        `₹${Number(invoice.totalAmount).toLocaleString('en-IN')}`,
      paymentLink,
    });
  }
}
