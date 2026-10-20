import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TwilioSenderService } from '../templates/twilio-sender.service';
import { WhatsappSessionService, WaSession } from '../session/whatsapp-session.service';
import { TemplateBuilder } from '../templates/template-builder';
import dayjs from 'dayjs';

/**
 * BOOKING FLOW — conversation steps
 *
 *  [START]
 *    │
 *    ▼
 *  SELECT_DENTIST  →  send list of active dentists
 *    │  (user picks dentist)
 *    ▼
 *  SELECT_DATE     →  ask for preferred date (YYYY-MM-DD or natural text)
 *    │  (user types date)
 *    ▼
 *  SELECT_SLOT     →  send available slots as interactive list
 *    │  (user picks slot)
 *    ▼
 *  CONFIRM         →  show summary + Yes/No buttons
 *    │  (user confirms)
 *    ▼
 *  [BOOK via API]  →  send confirmation template
 *    │
 *  [END]
 */

@Injectable()
export class BookingFlow {
  private readonly logger = new Logger(BookingFlow.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly sender:   TwilioSenderService,
    private readonly sessions: WhatsappSessionService,
  ) {}

  // ── Entry point ───────────────────────────────────────────────────────────

  async start(phone: string, clinicId: string): Promise<void> {
    const session = await this.sessions.startFlow(phone, clinicId, 'BOOKING', 'SELECT_DENTIST');
    await this.askDentist(phone, session);
  }

  // ── Step router ───────────────────────────────────────────────────────────

  async handle(session: WaSession, incomingText: string, buttonId?: string): Promise<void> {
    const input = (buttonId ?? incomingText).trim();

    switch (session.step) {
      case 'SELECT_DENTIST': return this.handleDentistSelection(session, input);
      case 'SELECT_DATE':    return this.handleDateInput(session, input);
      case 'SELECT_SLOT':    return this.handleSlotSelection(session, input);
      case 'CONFIRM':        return this.handleConfirmation(session, input);
    }
  }

  // ── Step 1: Choose dentist ────────────────────────────────────────────────

  private async askDentist(phone: string, session: WaSession): Promise<void> {
    const dentists = await this.prisma.user.findMany({
      where:  { clinicId: session.clinicId, isActive: true, role: { in: ['dentist', 'clinic_admin'] } },
      select: { id: true, fullName: true, specialization: true },
      orderBy: { fullName: 'asc' },
    });

    if (!dentists.length) {
      await this.sender.sendText(phone, '⚠️ No dentists available right now. Please call us to book.');
      await this.sessions.end(phone);
      return;
    }

    // Cache dentist list in session for reference during selection
    await this.sessions.patchData(phone, { dentists });

    await this.sender.sendList(phone, TemplateBuilder.list({
      header:  '🦷 Book an Appointment',
      body:    'Please choose a dentist:',
      button:  'Select dentist',
      sections: [{
        title: 'Available Dentists',
        rows:  dentists.map((d) => ({
          id:          d.id,
          title:       `Dr. ${d.fullName}`,
          description: d.specialization ?? 'General Dentistry',
        })),
      }],
    }));
  }

  private async handleDentistSelection(session: WaSession, input: string): Promise<void> {
    const dentists: any[] = session.data.dentists ?? [];

    // Match by list row ID (UUID) or by number (1, 2, 3...)
    let dentist = dentists.find((d) => d.id === input);
    if (!dentist) {
      const idx = parseInt(input, 10) - 1;
      dentist = dentists[idx];
    }

    if (!dentist) {
      await this.sender.sendText(session.phone, '❌ Invalid choice. Please reply with the number of the dentist.');
      return;
    }

    await this.sessions.advanceStep(session.phone, 'SELECT_DATE', {
      dentistId:   dentist.id,
      dentistName: dentist.fullName,
    });

    await this.sender.sendText(
      session.phone,
      `Great! You selected *Dr. ${dentist.fullName}*.\n\nPlease enter your preferred date:\n📅 Format: *DD-MM-YYYY*\n_(e.g. 15-11-2024)_`,
    );
  }

  // ── Step 2: Choose date ───────────────────────────────────────────────────

  private async handleDateInput(session: WaSession, input: string): Promise<void> {
    // Accept DD-MM-YYYY or YYYY-MM-DD
    let parsed = dayjs(input, 'DD-MM-YYYY', true);
    if (!parsed.isValid()) parsed = dayjs(input, 'YYYY-MM-DD', true);

    if (!parsed.isValid() || parsed.isBefore(dayjs(), 'day')) {
      await this.sender.sendText(
        session.phone,
        '❌ Invalid or past date. Please enter a future date in DD-MM-YYYY format.',
      );
      return;
    }

    const dateStr = parsed.format('YYYY-MM-DD');

    // Check available slots
    const slots = await this.prisma.appointmentSlot.findMany({
      where:   {
        clinicId:  session.clinicId,
        dentistId: session.data.dentistId,
        slotDate:  new Date(dateStr),
        isBooked:  false,
        isBlocked: false,
      },
      orderBy: { startTime: 'asc' },
    });

    if (!slots.length) {
      await this.sender.sendText(
        session.phone,
        `😕 No available slots on *${parsed.format('D MMM YYYY')}* with Dr. ${session.data.dentistName}.\n\nPlease try another date (DD-MM-YYYY):`,
      );
      return;
    }

    await this.sessions.advanceStep(session.phone, 'SELECT_SLOT', { date: dateStr, slots });

    // Group slots into morning / afternoon / evening
    const morning   = slots.filter((s) => s.startTime < '12:00:00');
    const afternoon = slots.filter((s) => s.startTime >= '12:00:00' && s.startTime < '17:00:00');
    const evening   = slots.filter((s) => s.startTime >= '17:00:00');

    const toRow = (s: any) => ({
      id:    s.id,
      title: s.startTime.slice(0, 5),
      description: `Until ${s.endTime.slice(0, 5)}`,
    });

    const sections = [
      ...(morning.length   ? [{ title: '🌅 Morning',   rows: morning.map(toRow) }]   : []),
      ...(afternoon.length ? [{ title: '☀️ Afternoon', rows: afternoon.map(toRow) }] : []),
      ...(evening.length   ? [{ title: '🌆 Evening',   rows: evening.map(toRow) }]   : []),
    ];

    await this.sender.sendList(session.phone, TemplateBuilder.list({
      header:   `📅 ${parsed.format('ddd, D MMM YYYY')}`,
      body:     `Available slots with Dr. ${session.data.dentistName}:`,
      footer:   `${slots.length} slots available`,
      button:   'Choose slot',
      sections,
    }));
  }

  // ── Step 3: Choose slot ───────────────────────────────────────────────────

  private async handleSlotSelection(session: WaSession, input: string): Promise<void> {
    const slots: any[] = session.data.slots ?? [];

    let slot = slots.find((s) => s.id === input);
    if (!slot) {
      const idx = parseInt(input, 10) - 1;
      slot = slots[idx];
    }

    if (!slot) {
      await this.sender.sendText(session.phone, '❌ Invalid selection. Please reply with the slot number.');
      return;
    }

    await this.sessions.advanceStep(session.phone, 'CONFIRM', {
      slotId:    slot.id,
      startTime: slot.startTime,
      endTime:   slot.endTime,
    });

    const date = dayjs(session.data.date).format('ddd, D MMM YYYY');

    await this.sender.sendButtons(session.phone, TemplateBuilder.buttons(
      `📋 *Appointment Summary*\n\n` +
      `👤 Patient: ${session.data.patientName ?? 'You'}\n` +
      `🦷 Dentist: Dr. ${session.data.dentistName}\n` +
      `📅 Date: ${date}\n` +
      `🕐 Time: ${slot.startTime.slice(0, 5)} – ${slot.endTime.slice(0, 5)}\n\n` +
      `Confirm this appointment?`,
      [
        { id: 'CONFIRM_YES', title: '✅ Yes, Book it' },
        { id: 'CONFIRM_NO',  title: '❌ No, Cancel'  },
      ],
    ));
  }

  // ── Step 4: Confirm ───────────────────────────────────────────────────────

  private async handleConfirmation(session: WaSession, input: string): Promise<void> {
    const upper = input.toUpperCase();

    if (!['CONFIRM_YES', 'YES', '1', 'Y'].includes(upper)) {
      await this.sender.sendText(session.phone, '👍 No problem! Your booking has been cancelled.\n\nReply *MENU* to start over.');
      await this.sessions.end(session.phone);
      return;
    }

    // Look up patient by phone
    const patient = await this.prisma.patient.findFirst({
      where: { clinicId: session.clinicId, phone: session.phone },
    });
    if (!patient) {
      await this.sender.sendText(
        session.phone,
        `⚠️ We couldn't find your patient record.\nPlease call us at your clinic to book, or visit us in person.`,
      );
      await this.sessions.end(session.phone);
      return;
    }

    // Conflict guard — re-check the slot is still free
    const slot = await this.prisma.appointmentSlot.findFirst({
      where: { id: session.data.slotId, isBooked: false, isBlocked: false },
    });
    if (!slot) {
      await this.sender.sendText(
        session.phone,
        `😟 Sorry, that slot was just taken! Let's find you another one.`,
      );
      await this.sessions.advanceStep(session.phone, 'SELECT_DATE');
      await this.sender.sendText(session.phone, 'Please enter your preferred date again (DD-MM-YYYY):');
      return;
    }

    // Book via $transaction
    const clinic = await this.prisma.clinic.findUnique({
      where:  { id: session.clinicId },
      select: { name: true },
    });

    const appointment = await this.prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: {
          clinicId:        session.clinicId,
          patientId:       patient.id,
          dentistId:       session.data.dentistId,
          slotId:          slot.id,
          appointmentDate: new Date(session.data.date),
          startTime:       slot.startTime,
          endTime:         slot.endTime,
          type:            'consultation',
          bookedVia:       'whatsapp',   // bookedByUserId references User; a patient id would violate the FK
        },
      });
      await tx.appointmentSlot.update({
        where: { id: slot.id },
        data:  { isBooked: true },
      });
      return appt;
    });

    this.logger.log(`Booked via WhatsApp → appt ${appointment.id} patient ${patient.id}`);

    await this.sessions.end(session.phone);

    const date = dayjs(session.data.date).format('D MMM YYYY');
    await this.sender.sendTemplate(TemplateBuilder.appointmentConfirmation({
      patientName: patient.fullName,
      dentistName: session.data.dentistName,
      date,
      time:        session.data.startTime.slice(0, 5),
      clinicName:  clinic?.name ?? 'Our Clinic',
      to:          session.phone,
      from:        this.sender.fromNumber,
    }));
  }
}
