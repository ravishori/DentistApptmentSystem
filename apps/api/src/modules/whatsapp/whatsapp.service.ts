import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import dayjs from 'dayjs';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ── Core send helpers ─────────────────────────────────────────────────────

  async sendText(clinicId: string, to: string, text: string) {
    const conv = await this.getOrCreateConversation(clinicId, to);
    const msg = await this.prisma.whatsappMessage.create({
      data: {
        clinicId,
        conversationId: conv.id,
        direction:      'outbound',
        type:           'text',
        content:        text,
        status:         'queued',
      },
    });

    try {
      const externalId = await this.dispatch(clinicId, to, { type: 'text', text: { body: text } });
      await this.prisma.whatsappMessage.update({
        where: { id: msg.id },
        data:  { status: 'sent', externalId: externalId },
      });
    } catch (err) {
      this.logger.error(`WA send failed → ${to}: ${(err as Error).message}`);
      await this.prisma.whatsappMessage.update({
        where: { id: msg.id },
        data:  { status: 'failed', failureReason: (err as Error).message },
      });
    }
    return msg;
  }

  async sendTemplate(
    clinicId:     string,
    to:           string,
    templateName: string,
    params:       Record<string, string>,
    language =    'en',
  ) {
    const conv = await this.getOrCreateConversation(clinicId, to);

    const payload = {
      type: 'template',
      template: {
        namespace:  'dental_ease',
        name:       templateName,
        language:   { policy: 'deterministic', code: language },
        components: [{
          type:       'body',
          parameters: Object.values(params).map((v) => ({ type: 'text', text: v })),
        }],
      },
    };

    const msg = await this.prisma.whatsappMessage.create({
      data: {
        clinicId,
        conversationId: conv.id,
        direction:      'outbound',
        type:           'template',
        content:        `[Template: ${templateName}]`,
        templateName,
        templateParams: params,
        status:         'queued',
      },
    });

    try {
      const externalId = await this.dispatch(clinicId, to, payload);
      await this.prisma.whatsappMessage.update({
        where: { id: msg.id },
        data:  { status: 'sent', externalId: externalId },
      });
    } catch (err) {
      this.logger.error(`Template send failed: ${(err as Error).message}`);
      await this.prisma.whatsappMessage.update({
        where: { id: msg.id },
        data:  { status: 'failed', failureReason: (err as Error).message },
      });
    }
    return msg;
  }

  // ── Pre-built clinic notification senders ─────────────────────────────────

  async sendAppointmentConfirmation(clinicId: string, phone: string, data: {
    patientName: string; dentistName: string; date: string; time: string; clinicName: string;
  }) {
    return this.sendTemplate(clinicId, phone, 'appointment_confirmation', data);
  }

  async sendReminder24h(clinicId: string, phone: string, data: {
    patientName: string; dentistName: string; date: string; time: string; clinicName: string;
  }) {
    return this.sendTemplate(clinicId, phone, 'appointment_reminder_24h', data);
  }

  async sendReminder2h(clinicId: string, phone: string, data: {
    patientName: string; time: string; clinicName: string;
  }) {
    return this.sendTemplate(clinicId, phone, 'appointment_reminder_2h', data);
  }

  async sendFollowup(clinicId: string, phone: string, data: {
    patientName: string; dentistName: string; clinicName: string;
  }) {
    return this.sendTemplate(clinicId, phone, 'appointment_followup', data);
  }

  async sendInvoiceLink(clinicId: string, phone: string, data: {
    patientName: string; invoiceNumber: string; amount: string; paymentLink: string;
  }) {
    return this.sendTemplate(clinicId, phone, 'invoice_payment_link', data);
  }

  // ── Webhook (inbound from 360Dialog) ─────────────────────────────────────

  async receiveWebhook(clinicId: string, payload: any) {
    const messages = payload?.entry?.[0]?.changes?.[0]?.value?.messages ?? [];

    for (const msg of messages) {
      const conv = await this.getOrCreateConversation(clinicId, msg.from);

      await this.prisma.whatsappMessage.create({
        data: {
          clinicId,
          conversationId:    conv.id,
          direction:         'inbound',
          type:              'text',
          content:           msg.text?.body ?? msg.interactive?.button_reply?.title ?? '',
          externalId: msg.id,
          status:            'read',
        },
      });

      await this.prisma.whatsappConversation.update({
        where: { id: conv.id },
        data:  { lastMessageAt: new Date() },
      });
    }

    // Delivery status updates
    const statuses = payload?.entry?.[0]?.changes?.[0]?.value?.statuses ?? [];
    for (const s of statuses) {
      await this.prisma.whatsappMessage.updateMany({
        where: { externalId: s.id },
        data:  { status: s.status },
      });
    }
  }

  // ── Conversations API ─────────────────────────────────────────────────────

  async getConversations(clinicId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.whatsappConversation.findMany({
        where:   { clinicId },
        orderBy: { lastMessageAt: 'desc' },
        include: {
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          patient:  { select: { fullName: true } },
        },
        skip,
        take: limit,
      }),
      this.prisma.whatsappConversation.count({ where: { clinicId } }),
    ]);
    return { items, total, page, limit };
  }

  async getMessages(clinicId: string, conversationId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.whatsappMessage.findMany({
        where:   { clinicId, conversationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.whatsappMessage.count({ where: { clinicId, conversationId } }),
    ]);
    return { items, total, page, limit };
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  @OnEvent('appointment.booked')
  async onAppointmentBooked({ appointment, clinicId }: any) {
    const { patient, dentist, clinic } = appointment;
    if (!patient.waOptIn || !patient.phone) return;

    await this.sendAppointmentConfirmation(clinicId, patient.phone, {
      patientName: patient.fullName,
      dentistName: dentist.fullName,
      date:        dayjs(appointment.appointmentDate).format('D MMM YYYY'),
      time:        appointment.startTime.slice(0, 5),
      clinicName:  clinic.name,
    });
  }

  @OnEvent('appointment.reminder_24h')
  async onReminder24h({ appointment }: any) {
    const { patient, dentist, clinic } = appointment;
    if (!patient.waOptIn || !patient.phone) return;

    await this.sendReminder24h(appointment.clinicId, patient.phone, {
      patientName: patient.fullName,
      dentistName: dentist.fullName,
      date:        dayjs(appointment.appointmentDate).format('D MMM YYYY'),
      time:        appointment.startTime.slice(0, 5),
      clinicName:  clinic.name,
    });
  }

  @OnEvent('appointment.reminder_2h')
  async onReminder2h({ appointment }: any) {
    const { patient, clinic } = appointment;
    if (!patient.waOptIn || !patient.phone) return;

    await this.sendReminder2h(appointment.clinicId, patient.phone, {
      patientName: patient.fullName,
      time:        appointment.startTime.slice(0, 5),
      clinicName:  clinic.name,
    });
  }

  @OnEvent('appointment.followup')
  async onFollowup({ appointment }: any) {
    const { patient, dentist, clinic } = appointment;
    if (!patient.waOptIn || !patient.phone) return;

    await this.sendFollowup(appointment.clinicId, patient.phone, {
      patientName: patient.fullName,
      dentistName: dentist.fullName,
      clinicName:  clinic.name,
    });
  }

  @OnEvent('invoice.sent')
  async onInvoiceSent({ invoice, paymentLink, clinicId }: any) {
    const patient = invoice?.patient ?? invoice;
    if (!patient?.phone) return;

    await this.sendInvoiceLink(invoice.clinicId ?? clinicId, patient.phone, {
      patientName:   patient.fullName,
      invoiceNumber: invoice.invoiceNumber,
      amount:        `₹${Number(invoice.balanceAmount ?? invoice.totalAmount).toLocaleString('en-IN')}`,
      paymentLink,
    });
  }

  /**
   * Fires after RazorpayService.recordSuccessfulPayment() completes.
   * Sends a payment receipt WhatsApp message to the patient.
   */
  @OnEvent('payment.success')
  async onPaymentSuccess({
    clinicId, invoiceId, patientId, amountPaid, razorpayPaymentId,
  }: {
    clinicId: string; invoiceId: string; patientId: string;
    amountPaid: number; razorpayPaymentId: string;
  }) {
    const [invoice, patient, clinic] = await Promise.all([
      this.prisma.invoice.findUnique({ where: { id: invoiceId } }),
      this.prisma.patient.findUnique({
        where:  { id: patientId },
        select: { fullName: true, phone: true, waOptIn: true },
      }),
      this.prisma.clinic.findUnique({
        where:  { id: clinicId },
        select: { name: true, waApiKey: true },
      }),
    ]);

    if (!patient?.waOptIn || !patient?.phone || !invoice || !clinic) return;

    await this.sendTemplate(clinicId, patient.phone, 'payment_receipt', {
      patientName:   patient.fullName,
      amount:        `₹${amountPaid.toLocaleString('en-IN')}`,
      invoiceNumber: invoice.invoiceNumber,
      paymentId:     razorpayPaymentId,
      clinicName:    clinic.name,
    });

    this.logger.log(`Payment receipt sent to ${patient.phone} for invoice ${invoiceId}`);
  }

  /**
   * Fires after RazorpayService.recordRefund() completes.
   * Notifies the patient that their refund is being processed.
   */
  @OnEvent('payment.refunded')
  async onPaymentRefunded({
    clinicId, patientId, invoiceId, amountRefunded,
  }: {
    clinicId: string; patientId: string; invoiceId: string; amountRefunded: number;
  }) {
    const [patient, invoice] = await Promise.all([
      this.prisma.patient.findUnique({
        where:  { id: patientId },
        select: { fullName: true, phone: true, waOptIn: true },
      }),
      this.prisma.invoice.findUnique({ where: { id: invoiceId } }),
    ]);

    if (!patient?.waOptIn || !patient?.phone || !invoice) return;

    await this.sendText(
      clinicId,
      patient.phone,
      `Hi ${patient.fullName}, a refund of ₹${amountRefunded.toLocaleString('en-IN')} for invoice ${invoice.invoiceNumber} has been initiated. It will reflect in 5–7 business days.`,
    );
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async getOrCreateConversation(clinicId: string, phone: string) {
    const existing = await this.prisma.whatsappConversation.findFirst({
      where: { clinicId, patientPhone: phone },
    });
    if (existing) return existing;

    const patient = await this.prisma.patient.findFirst({
      where: { clinicId, phone },
      select: { id: true },
    });

    return this.prisma.whatsappConversation.create({
      data: { clinicId, patientPhone: phone, patientId: patient?.id },
    });
  }

  private async dispatch(clinicId: string, to: string, payload: any): Promise<string> {
    const clinic = await this.prisma.clinic.findUnique({
      where:  { id: clinicId },
      select: { waApiKey: true },
    });

    const apiKey = clinic?.waApiKey ?? this.config.get<string>('whatsapp.apiKey');
    const baseUrl = this.config.get<string>('whatsapp.baseUrl');

    const response = await axios.post(
      `${baseUrl}/messages`,
      { to, messaging_product: 'whatsapp', ...payload },
      { headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' } },
    );
    return response.data?.messages?.[0]?.id;
  }
}
