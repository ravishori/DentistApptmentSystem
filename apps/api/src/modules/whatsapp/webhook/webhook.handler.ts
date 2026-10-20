import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { WhatsappSessionService } from '../session/whatsapp-session.service';
import { TwilioSenderService } from '../templates/twilio-sender.service';
import { TemplateBuilder } from '../templates/template-builder';
import { BookingFlow } from '../flows/booking.flow';
import { RescheduleFlow } from '../flows/reschedule.flow';
import { FollowupFlow } from '../flows/followup.flow';

/**
 * WebhookHandler — single entry point for ALL inbound WhatsApp messages.
 *
 * Twilio sends a POST to /api/v1/whatsapp/webhook/:clinicId with form-encoded body:
 *
 *   From=whatsapp:+919876543210
 *   Body=BOOK
 *   ButtonPayload=QUICK_CONFIRM          (if button tapped)
 *   MessageSid=SMxxx
 *   ProfileName=Ravi Shori
 *
 * Routing logic:
 *   1. Load session for the phone number
 *   2. If session has an active flow → route to that flow's handler
 *   3. Else → parse global keyword from message body → launch the right flow
 *   4. If unrecognised → send the MAIN MENU
 *
 * Global keywords (work regardless of session state):
 *   BOOK / 1          → BookingFlow
 *   RESCHEDULE / 2    → RescheduleFlow (reschedule intent)
 *   CANCEL / 3        → RescheduleFlow (cancel intent)
 *   PAY / INVOICE / 4 → Payment link for outstanding invoice
 *   STATUS / 5        → Next appointment info
 *   MENU / 0 / HELP   → Main menu
 *   STOP / OPTOUT     → Opt out of WhatsApp messages
 *   CONFIRM           → Quick-confirm from 24h reminder
 */

const MAIN_MENU = `🦷 *DentalEase — Main Menu*

Reply with a number or keyword:

1️⃣  *BOOK* — Book an appointment
2️⃣  *RESCHEDULE* — Change appointment
3️⃣  *CANCEL* — Cancel appointment
4️⃣  *PAY* — Pay outstanding invoice
5️⃣  *STATUS* — Next appointment info

💬 *HELP* — Talk to our team
🚫 *STOP* — Unsubscribe from WhatsApp`;

@Injectable()
export class WebhookHandler {
  private readonly logger = new Logger(WebhookHandler.name);

  constructor(
    private readonly prisma:       PrismaService,
    private readonly sessions:     WhatsappSessionService,
    private readonly sender:       TwilioSenderService,
    private readonly bookingFlow:  BookingFlow,
    private readonly rescheduleFlow: RescheduleFlow,
    private readonly followupFlow: FollowupFlow,
  ) {}

  // ── Main entry: called by WhatsappController ──────────────────────────────

  async handle(clinicId: string, twilioPayload: Record<string, string>): Promise<void> {
    const rawFrom   = twilioPayload['From'] ?? '';           // "whatsapp:+919876543210"
    const phone     = rawFrom.replace('whatsapp:', '');
    const body      = (twilioPayload['Body'] ?? '').trim();
    const buttonId  = twilioPayload['ButtonPayload'];        // set when user taps a button

    if (!phone) {
      this.logger.warn('Webhook received with no From field');
      return;
    }

    this.logger.log(`Inbound WA → ${phone} | body="${body}" | button="${buttonId ?? ''}"`);

    // Persist raw inbound message
    await this.persistMessage(clinicId, phone, body, buttonId);

    // Load or create session
    const session = await this.sessions.get(phone, clinicId);

    // ── Global override keywords ─────────────────────────────────────────────
    const keyword = (buttonId ?? body).toUpperCase().trim();

    if (['STOP', 'OPTOUT', 'UNSUBSCRIBE'].includes(keyword)) {
      return this.handleOptOut(phone, clinicId);
    }

    if (['MENU', '0', 'HELP', 'HI', 'HELLO', 'START'].includes(keyword)) {
      await this.sessions.reset(phone, clinicId);
      return this.sendMenu(phone);
    }

    // ── If an active flow exists, route to it ────────────────────────────────
    if (session.flow) {
      return this.routeToFlow(session, body, buttonId, clinicId);
    }

    // ── No active session — handle global keywords ───────────────────────────
    switch (keyword) {
      case 'BOOK':
      case '1':
        return this.bookingFlow.start(phone, clinicId);

      case 'RESCHEDULE':
      case '2':
        return this.rescheduleFlow.start(phone, clinicId, 'reschedule');

      case 'CANCEL':
      case '3':
        return this.rescheduleFlow.start(phone, clinicId, 'cancel');

      case 'PAY':
      case 'INVOICE':
      case '4':
        return this.sendPaymentLink(phone, clinicId);

      case 'STATUS':
      case '5':
        return this.sendNextAppointmentStatus(phone, clinicId);

      case 'CONFIRM':
      case 'QUICK_CONFIRM':
        return this.handleQuickConfirm(phone, clinicId);

      case 'QUICK_RESCHEDULE':
        return this.rescheduleFlow.start(phone, clinicId, 'reschedule');

      case 'QUICK_CANCEL':
        return this.rescheduleFlow.start(phone, clinicId, 'cancel');

      default:
        return this.sendMenu(phone);
    }
  }

  // ── Flow router ───────────────────────────────────────────────────────────

  private async routeToFlow(
    session:   ReturnType<WhatsappSessionService['get']> extends Promise<infer T> ? T : never,
    body:      string,
    buttonId:  string | undefined,
    clinicId:  string,
  ): Promise<void> {
    switch (session.flow) {
      case 'BOOKING':
        return this.bookingFlow.handle(session, body, buttonId);
      case 'RESCHEDULE':
      case 'CANCEL':
        return this.rescheduleFlow.handle(session, body, buttonId);
      case 'FOLLOWUP':
        return this.followupFlow.handle(session, body, buttonId);
      default:
        await this.sessions.reset(session.phone, clinicId);
        return this.sendMenu(session.phone);
    }
  }

  // ── Global action handlers ────────────────────────────────────────────────

  private async sendMenu(phone: string): Promise<void> {
    await this.sender.sendText(phone, MAIN_MENU);
  }

  private async sendPaymentLink(phone: string, clinicId: string): Promise<void> {
    const patient = await this.prisma.patient.findFirst({ where: { clinicId, phone } });
    if (!patient) {
      await this.sender.sendText(phone, '⚠️ Patient record not found. Please call us.');
      return;
    }

    const invoice = await this.prisma.invoice.findFirst({
      where:   { clinicId, patientId: patient.id, status: { in: ['draft', 'sent', 'partially_paid'] } },
      orderBy: { createdAt: 'desc' },
    });

    if (!invoice || Number(invoice.balanceAmount) <= 0) {
      await this.sender.sendText(phone, '✅ You have no outstanding invoices. Thank you!');
      return;
    }

    // The actual payment order is created by BillingService — here we just inform
    const webUrl = process.env.WEB_URL ?? 'https://app.dentalease.in';
    const payUrl = `${webUrl}/pay?invoice=${invoice.id}`;

    await this.sender.sendTemplate(
      TemplateBuilder.paymentLink({
        patientName:   patient.fullName,
        invoiceNumber: invoice.invoiceNumber,
        amount:        Number(invoice.balanceAmount).toFixed(0),
        paymentUrl:    payUrl,
        to:            phone,
        from:          this.sender.fromNumber,
      }),
    );
  }

  private async sendNextAppointmentStatus(phone: string, clinicId: string): Promise<void> {
    const patient = await this.prisma.patient.findFirst({ where: { clinicId, phone } });
    if (!patient) {
      await this.sender.sendText(phone, '⚠️ Patient record not found. Please call us.');
      return;
    }

    const next = await this.prisma.appointment.findFirst({
      where: {
        clinicId,
        patientId:       patient.id,
        appointmentDate: { gte: new Date() },
        status:          { in: ['scheduled', 'confirmed'] },
      },
      orderBy: { appointmentDate: 'asc' },
      include: { dentist: { select: { fullName: true } } },
    });

    if (!next) {
      await this.sender.sendText(
        phone,
        `📭 You have no upcoming appointments.\n\nReply *BOOK* to schedule one.`,
      );
      return;
    }

    const dateStr = new Date(next.appointmentDate).toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    await this.sender.sendText(
      phone,
      `📅 *Your Next Appointment*\n\n` +
      `🗓 ${dateStr}\n` +
      `🕐 ${next.startTime.slice(0, 5)}\n` +
      `🦷 Dr. ${next.dentist.fullName}\n` +
      `📋 Status: ${next.status.toUpperCase()}\n\n` +
      `Reply *RESCHEDULE* to change or *CANCEL* to cancel.`,
    );
  }

  private async handleQuickConfirm(phone: string, clinicId: string): Promise<void> {
    const patient = await this.prisma.patient.findFirst({ where: { clinicId, phone } });
    if (!patient) return;

    const appt = await this.prisma.appointment.findFirst({
      where: {
        clinicId,
        patientId:       patient.id,
        appointmentDate: { gte: new Date() },
        status:          'scheduled',
      },
      orderBy: { appointmentDate: 'asc' },
    });

    if (!appt) {
      await this.sender.sendText(phone, '📭 No appointment found to confirm.');
      return;
    }

    await this.prisma.appointment.update({
      where: { id: appt.id },
      data:  { status: 'confirmed' },
    });

    await this.sender.sendText(
      phone,
      `✅ Appointment confirmed for ${new Date(appt.appointmentDate).toLocaleDateString('en-IN')} at ${appt.startTime.slice(0, 5)}. See you then!`,
    );
  }

  private async handleOptOut(phone: string, clinicId: string): Promise<void> {
    await this.prisma.patient.updateMany({
      where: { clinicId, phone },
      data:  { waOptIn: false },
    });
    await this.sessions.end(phone);
    await this.sender.sendText(
      phone,
      `You have been unsubscribed from WhatsApp notifications. Reply *START* anytime to re-subscribe.`,
    );
    this.logger.log(`Patient opted out of WhatsApp → ${phone}`);
  }

  // ── Persist inbound message ───────────────────────────────────────────────

  private async persistMessage(
    clinicId: string, phone: string, body: string, buttonId?: string,
  ): Promise<void> {
    const conv = await this.prisma.whatsappConversation.findFirst({
      where: { clinicId, patientPhone: phone },
    });
    if (!conv) return;

    await this.prisma.whatsappMessage.create({
      data: {
        clinicId,
        conversationId: conv.id,
        direction:      'inbound',
        type:           buttonId ? 'interactive' : 'text',
        content:        buttonId ? `[Button: ${buttonId}] ${body}` : body,
        status:         'delivered',
      },
    }).catch(() => {});

    await this.prisma.whatsappConversation.update({
      where: { id: conv.id },
      data:  { lastMessageAt: new Date() },
    }).catch(() => {});
  }
}
