import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TwilioSenderService } from '../templates/twilio-sender.service';
import { WhatsappSessionService, WaSession } from '../session/whatsapp-session.service';
import { TemplateBuilder, TEMPLATE_SIDS } from '../templates/template-builder';
import dayjs from 'dayjs';

/**
 * RESCHEDULE FLOW
 *
 *  [START]
 *    ▼
 *  SELECT_APPOINTMENT  →  list upcoming appointments
 *    ▼  (user picks one)
 *  ACTION_CHOICE       →  Reschedule / Cancel buttons
 *    ├─ RESCHEDULE ──▶  SELECT_DATE → SELECT_SLOT → CONFIRM_RESCHEDULE
 *    └─ CANCEL ──────▶  CONFIRM_CANCEL → [cancel via API] → template sent
 *
 * CANCEL FLOW shares the same service — just starts at SELECT_APPOINTMENT
 * with a 'cancel' intent.
 */

@Injectable()
export class RescheduleFlow {
  private readonly logger = new Logger(RescheduleFlow.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly sender:   TwilioSenderService,
    private readonly sessions: WhatsappSessionService,
  ) {}

  // ── Entry ─────────────────────────────────────────────────────────────────

  async start(phone: string, clinicId: string, intent: 'reschedule' | 'cancel' = 'reschedule'): Promise<void> {
    const session = await this.sessions.startFlow(
      phone,
      clinicId,
      intent === 'cancel' ? 'CANCEL' : 'RESCHEDULE',
      'SELECT_APPOINTMENT',
    );
    await this.sessions.patchData(phone, { intent });
    await this.listUpcomingAppointments(phone, session.clinicId);
  }

  async handle(session: WaSession, incomingText: string, buttonId?: string): Promise<void> {
    const input = (buttonId ?? incomingText).trim();

    switch (session.step) {
      case 'SELECT_APPOINTMENT':    return this.handleAppointmentSelection(session, input);
      case 'ACTION_CHOICE':         return this.handleActionChoice(session, input);
      case 'SELECT_DATE':           return this.handleDateInput(session, input);
      case 'SELECT_SLOT':           return this.handleSlotSelection(session, input);
      case 'CONFIRM_RESCHEDULE':    return this.handleRescheduleConfirm(session, input);
      case 'CONFIRM_CANCEL':        return this.handleCancelConfirm(session, input);
    }
  }

  // ── Step 1: List upcoming appointments ───────────────────────────────────

  private async listUpcomingAppointments(phone: string, clinicId: string): Promise<void> {
    const patient = await this.prisma.patient.findFirst({
      where: { clinicId, phone },
    });

    if (!patient) {
      await this.sender.sendText(phone, '⚠️ We could not find your patient record. Please call us for help.');
      await this.sessions.end(phone);
      return;
    }

    const upcoming = await this.prisma.appointment.findMany({
      where: {
        clinicId,
        patientId:       patient.id,
        appointmentDate: { gte: new Date() },
        status:          { in: ['scheduled', 'confirmed'] },
      },
      include: { dentist: { select: { fullName: true } } },
      orderBy: { appointmentDate: 'asc' },
      take:    5,
    });

    if (!upcoming.length) {
      await this.sender.sendText(phone, '📭 You have no upcoming appointments.\n\nReply *BOOK* to schedule one.');
      await this.sessions.end(phone);
      return;
    }

    await this.sessions.patchData(phone, { appointments: upcoming, patientId: patient.id });

    await this.sender.sendList(phone, TemplateBuilder.list({
      header:  '📅 Your Upcoming Appointments',
      body:    'Select the appointment you want to change:',
      button:  'Select appointment',
      sections: [{
        title: 'Appointments',
        rows:  upcoming.map((a, i) => ({
          id:          a.id,
          title:       dayjs(a.appointmentDate).format('D MMM YYYY') + ' at ' + a.startTime.slice(0, 5),
          description: `Dr. ${a.dentist.fullName} · ${a.status}`,
        })),
      }],
    }));
  }

  private async handleAppointmentSelection(session: WaSession, input: string): Promise<void> {
    const appointments: any[] = session.data.appointments ?? [];
    let appt = appointments.find((a) => a.id === input);
    if (!appt) {
      const idx = parseInt(input, 10) - 1;
      appt = appointments[idx];
    }

    if (!appt) {
      await this.sender.sendText(session.phone, '❌ Invalid choice. Please reply with the number from the list.');
      return;
    }

    await this.sessions.advanceStep(session.phone, 'ACTION_CHOICE', { appointmentId: appt.id, appointment: appt });

    // If intent is already set (direct cancel flow), skip the action choice
    if (session.data.intent === 'cancel') {
      await this.askCancelConfirm(session.phone, appt);
      return;
    }

    const dateStr = dayjs(appt.appointmentDate).format('D MMM YYYY');

    await this.sender.sendButtons(session.phone, TemplateBuilder.buttons(
      `📋 *Selected Appointment*\n\n` +
      `📅 ${dateStr} at ${String(appt.startTime).slice(0, 5)}\n` +
      `🦷 Dr. ${appt.dentist?.fullName ?? ''}\n\n` +
      `What would you like to do?`,
      [
        { id: 'ACTION_RESCHEDULE', title: '🔄 Reschedule' },
        { id: 'ACTION_CANCEL',     title: '❌ Cancel'      },
      ],
    ));
  }

  // ── Step 2: Action choice ─────────────────────────────────────────────────

  private async handleActionChoice(session: WaSession, input: string): Promise<void> {
    const upper = input.toUpperCase();

    if (['ACTION_RESCHEDULE', 'RESCHEDULE', '1', 'R'].includes(upper)) {
      await this.sessions.advanceStep(session.phone, 'SELECT_DATE');
      await this.sender.sendText(
        session.phone,
        '📅 Enter your new preferred date:\n_(Format: DD-MM-YYYY)_',
      );
    } else if (['ACTION_CANCEL', 'CANCEL', '2', 'C'].includes(upper)) {
      await this.askCancelConfirm(session.phone, session.data.appointment);
    } else {
      await this.sender.sendText(session.phone, '❌ Please reply *1* to Reschedule or *2* to Cancel.');
    }
  }

  // ── Reschedule sub-flow ───────────────────────────────────────────────────

  private async handleDateInput(session: WaSession, input: string): Promise<void> {
    let parsed = dayjs(input, 'DD-MM-YYYY', true);
    if (!parsed.isValid()) parsed = dayjs(input, 'YYYY-MM-DD', true);

    if (!parsed.isValid() || parsed.isBefore(dayjs(), 'day')) {
      await this.sender.sendText(session.phone, '❌ Invalid or past date. Try again (DD-MM-YYYY):');
      return;
    }

    const dateStr = parsed.format('YYYY-MM-DD');
    const appt    = session.data.appointment;

    const slots = await this.prisma.appointmentSlot.findMany({
      where:   {
        clinicId:  session.clinicId,
        dentistId: appt.dentistId,
        slotDate:  new Date(dateStr),
        isBooked:  false,
        isBlocked: false,
      },
      orderBy: { startTime: 'asc' },
    });

    if (!slots.length) {
      await this.sender.sendText(
        session.phone,
        `😕 No slots on *${parsed.format('D MMM YYYY')}*. Try another date:`,
      );
      return;
    }

    await this.sessions.advanceStep(session.phone, 'SELECT_SLOT', { newDate: dateStr, newSlots: slots });

    const toRow = (s: any) => ({
      id:          s.id,
      title:       s.startTime.slice(0, 5),
      description: `Until ${s.endTime.slice(0, 5)}`,
    });

    await this.sender.sendList(session.phone, TemplateBuilder.list({
      header:   `📅 ${parsed.format('ddd, D MMM YYYY')}`,
      body:     'Choose a new time slot:',
      button:   'Select slot',
      sections: [{ title: 'Available Slots', rows: slots.map(toRow) }],
    }));
  }

  private async handleSlotSelection(session: WaSession, input: string): Promise<void> {
    const slots: any[] = session.data.newSlots ?? [];
    let slot = slots.find((s) => s.id === input);
    if (!slot) {
      const idx = parseInt(input, 10) - 1;
      slot = slots[idx];
    }

    if (!slot) {
      await this.sender.sendText(session.phone, '❌ Invalid slot. Please reply with the number.');
      return;
    }

    await this.sessions.advanceStep(session.phone, 'CONFIRM_RESCHEDULE', {
      newSlotId:    slot.id,
      newStartTime: slot.startTime,
      newEndTime:   slot.endTime,
    });

    const appt    = session.data.appointment;
    const newDate = dayjs(session.data.newDate).format('D MMM YYYY');
    const oldDate = dayjs(appt.appointmentDate).format('D MMM YYYY');

    await this.sender.sendButtons(session.phone, TemplateBuilder.buttons(
      `🔄 *Reschedule Summary*\n\n` +
      `❌ *From:* ${oldDate} at ${String(appt.startTime).slice(0, 5)}\n` +
      `✅ *To:*   ${newDate} at ${slot.startTime.slice(0, 5)}\n\n` +
      `Confirm reschedule?`,
      [
        { id: 'CONFIRM_YES', title: '✅ Confirm' },
        { id: 'CONFIRM_NO',  title: '❌ Cancel'  },
      ],
    ));
  }

  private async handleRescheduleConfirm(session: WaSession, input: string): Promise<void> {
    if (!['CONFIRM_YES', 'YES', '1', 'Y'].includes(input.toUpperCase())) {
      await this.sender.sendText(session.phone, '👍 Reschedule cancelled. Your original appointment is kept.\n\nReply *MENU* for options.');
      await this.sessions.end(session.phone);
      return;
    }

    const appt    = session.data.appointment;
    const newSlot = await this.prisma.appointmentSlot.findFirst({
      where: { id: session.data.newSlotId, isBooked: false, isBlocked: false },
    });

    if (!newSlot) {
      await this.sender.sendText(session.phone, '😟 That slot was just taken. Please choose another date.');
      await this.sessions.advanceStep(session.phone, 'SELECT_DATE');
      return;
    }

    // Execute reschedule transaction
    await this.prisma.$transaction(async (tx) => {
      // Mark original as rescheduled
      await tx.appointment.update({
        where: { id: appt.id },
        data:  { status: 'rescheduled', cancelledAt: new Date(), cancelReason: 'Rescheduled via WhatsApp' },
      });
      if (appt.slotId) {
        await tx.appointmentSlot.update({ where: { id: appt.slotId }, data: { isBooked: false } });
      }

      // Create new appointment
      await tx.appointment.create({
        data: {
          clinicId:           session.clinicId,
          patientId:          session.data.patientId,
          dentistId:          appt.dentistId,
          slotId:             newSlot.id,
          appointmentDate:    new Date(session.data.newDate),
          startTime:          newSlot.startTime,
          endTime:            newSlot.endTime,
          type:               appt.type,
          chiefComplaint:     appt.chiefComplaint,
          bookedVia:          'whatsapp',
          bookedByUserId:     session.data.patientId,
          rescheduledFromId:  appt.id,
        },
      });
      await tx.appointmentSlot.update({ where: { id: newSlot.id }, data: { isBooked: true } });
    });

    await this.sessions.end(session.phone);

    const clinic = await this.prisma.clinic.findUnique({ where: { id: session.clinicId }, select: { name: true } });
    const newDate = dayjs(session.data.newDate).format('D MMM YYYY');

    await this.sender.sendTemplate({
      to:   `whatsapp:${session.phone}`,
      from: `whatsapp:${this.sender.fromNumber}`,
      contentSid:       TEMPLATE_SIDS.RESCHEDULED,
      contentVariables: TemplateBuilder.vars([
        session.data.patientName ?? 'Patient',
        newDate,
        newSlot.startTime.slice(0, 5),
        appt.dentist?.fullName ?? '',
        clinic?.name ?? '',
      ]),
    });
  }

  // ── Cancel sub-flow ───────────────────────────────────────────────────────

  private async askCancelConfirm(phone: string, appt: any): Promise<void> {
    await this.sessions.advanceStep(phone, 'CONFIRM_CANCEL');
    const dateStr = dayjs(appt.appointmentDate).format('D MMM YYYY');

    await this.sender.sendButtons(phone, TemplateBuilder.buttons(
      `⚠️ *Cancel Appointment*\n\n` +
      `📅 ${dateStr} at ${String(appt.startTime).slice(0, 5)}\n` +
      `🦷 Dr. ${appt.dentist?.fullName ?? ''}\n\n` +
      `Are you sure you want to cancel?`,
      [
        { id: 'CANCEL_YES', title: '✅ Yes, Cancel' },
        { id: 'CANCEL_NO',  title: '❌ No, Keep it' },
      ],
    ));
  }

  private async handleCancelConfirm(session: WaSession, input: string): Promise<void> {
    if (!['CANCEL_YES', 'YES', '1', 'Y'].includes(input.toUpperCase())) {
      await this.sender.sendText(session.phone, '✅ Your appointment is kept. See you then!');
      await this.sessions.end(session.phone);
      return;
    }

    const appt = session.data.appointment;

    await this.prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appt.id },
        data:  { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Cancelled via WhatsApp' },
      });
      if (appt.slotId) {
        await tx.appointmentSlot.update({ where: { id: appt.slotId }, data: { isBooked: false } });
      }
    });

    await this.sessions.end(session.phone);

    const dateStr = dayjs(appt.appointmentDate).format('D MMM YYYY');

    await this.sender.sendTemplate({
      to:   `whatsapp:${session.phone}`,
      from: `whatsapp:${this.sender.fromNumber}`,
      contentSid:       TEMPLATE_SIDS.APPOINTMENT_CANCELLED,
      contentVariables: TemplateBuilder.vars([
        session.data.patientName ?? 'Patient',
        dateStr,
        String(appt.startTime).slice(0, 5),
      ]),
    });
  }
}
