/**
 * RazorpayService
 *
 * Handles two distinct Razorpay flows:
 *
 *  1. ORDERS  — embed Razorpay Checkout SDK in the browser.
 *               Client calls POST /billing/invoices/:id/order
 *               → get {orderId, amount, key} → open rzp.open() in browser
 *               → on success, client calls POST /billing/payments/verify (HMAC check)
 *
 *  2. PAYMENT LINKS — Razorpay-hosted payment page, shareable URL.
 *               Call POST /billing/invoices/:id/payment-link
 *               → Razorpay creates a hosted page and returns short_url
 *               → We store the link, fire invoice.sent event → WhatsApp sends it
 *               → Razorpay fires server-side webhook on payment (no client round-trip)
 *
 * Payment Links are the right choice for WhatsApp flows since the patient
 * receives a URL they open in their own browser without the clinic's app.
 */

import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Razorpay from 'razorpay';
import * as crypto from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreatePaymentLinkDto } from '../dto/payment-link.dto';
import { PaymentMethod, Prisma } from '@prisma/client';

/** Constant-time hex comparison that never throws on malformed or differently-sized input. */
function safeEqualHex(expectedHex: string, actualHex: string | undefined): boolean {
  if (!actualHex || !/^[0-9a-f]+$/i.test(actualHex) || actualHex.length !== expectedHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(actualHex, 'hex'));
}

/** Map gateway-reported method strings onto the PaymentMethod enum in schema.prisma. */
function toPaymentMethod(raw: string): PaymentMethod {
  return (['card', 'netbanking', 'upi'] as const).find((m) => m === raw) ?? 'razorpay';
}

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly rzp: Razorpay;

  constructor(
    private readonly prisma:  PrismaService,
    private readonly config:  ConfigService,
    private readonly emitter: EventEmitter2,
  ) {
    this.rzp = new Razorpay({
      key_id:     config.get<string>('razorpay.keyId'),
      key_secret: config.get<string>('razorpay.keySecret'),
    });
  }

  // ── 1. Razorpay Order (for in-browser checkout) ───────────────────────────

  async createOrder(clinicId: string, invoiceId: string) {
    const invoice = await this.loadInvoice(clinicId, invoiceId);
    this.assertPayable(invoice);

    const amountPaise = Math.round(Number(invoice.balanceAmount) * 100);

    const order = await this.rzp.orders.create({
      amount:   amountPaise,
      currency: 'INR',
      receipt:  invoice.invoiceNumber,
      notes: {
        invoiceId,
        clinicId,
        patientId:  invoice.patientId,
        patientName: invoice.patient.fullName,
      },
    });

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data:  { razorpayOrderId: order.id, ...(invoice.status === 'draft' && { status: 'sent' as const }) },
    });

    this.logger.log(`Order created: ${order.id} for invoice ${invoice.invoiceNumber}`);

    return {
      orderId:       order.id,
      amount:        order.amount,             // in paise
      amountDisplay: Number(invoice.balanceAmount),
      currency:      order.currency,
      key:           this.config.get<string>('razorpay.keyId'),
      invoiceNumber: invoice.invoiceNumber,
      patientName:   invoice.patient.fullName,
      description:   `Payment for ${invoice.invoiceNumber}`,
    };
  }

  // ── 2. Razorpay Payment Link (shareable, WA-friendly) ─────────────────────

  async createPaymentLink(clinicId: string, invoiceId: string, dto?: CreatePaymentLinkDto) {
    const invoice = await this.loadInvoice(clinicId, invoiceId);
    this.assertPayable(invoice);

    const patient = invoice.patient;
    const amountPaise = Math.round(Number(invoice.balanceAmount) * 100);
    const expireBy = Math.floor(Date.now() / 1000) + (dto?.expiryHours ?? 48) * 3600;

    const link = await this.rzp.paymentLink.create({
      amount:      amountPaise,
      currency:    'INR',
      accept_partial: dto?.acceptPartial ?? false,
      description: `Invoice ${invoice.invoiceNumber} — ${invoice.clinic.name}`,
      expire_by:   expireBy,
      reference_id: invoice.invoiceNumber,
      customer: {
        name:   patient?.fullName ?? 'Patient',
        email:  patient?.email ?? undefined,
        contact: patient?.phone ?? undefined,
      },
      notify: {
        sms:   dto?.notifySms  ?? false,  // we handle WA ourselves
        email: dto?.notifyEmail ?? false,
      },
      reminder_enable: false,             // we own the reminder schedule
      notes: {
        invoiceId,
        clinicId,
        patientId: invoice.patientId,
      },
      callback_url:    `${this.config.get('app.webUrl')}/pay/success?invoice=${invoiceId}`,
      callback_method: 'get',
    });

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        ...(invoice.status === 'draft' && { status: 'sent' as const }),
        razorpayOrderId:     link.id,   // payment-link id; short_url is returned/emitted, not persisted (no column)
      },
    });

    // Fire event — WhatsApp service picks this up
    this.emitter.emit('invoice.sent', {
      invoice:     { ...invoice, patient },
      paymentLink: link.short_url,
      clinicId,
    });

    this.logger.log(`Payment link created: ${link.id} → ${link.short_url}`);

    return {
      linkId:      link.id,
      shortUrl:    link.short_url,
      amount:      Number(invoice.balanceAmount),
      currency:    'INR',
      expiresAt:   new Date(expireBy * 1000).toISOString(),
      invoiceNumber: invoice.invoiceNumber,
    };
  }

  // ── 3. Client-side signature verification (Order flow) ────────────────────

  /**
   * @param clinicId  Tenant from the caller's JWT, or undefined for the anonymous checkout callback
   *                  (@Public route: the tenant middleware only sets it when a Bearer token is sent).
   *                  When absent the clinic is taken from the invoice AFTER the signed order has been
   *                  proven to belong to that invoice; when present it must match.
   */
  async verifyOrderPayment(clinicId: string | undefined, dto: {
    razorpay_order_id:   string;
    razorpay_payment_id: string;
    razorpay_signature:  string;
    invoiceId:           string;
  }) {
    const keySecret = this.config.get<string>('razorpay.keySecret');
    if (!keySecret) {
      this.logger.error('razorpay.keySecret is not configured; refusing to verify payment');
      throw new BadRequestException('Payment verification is not configured');
    }
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${dto.razorpay_order_id}|${dto.razorpay_payment_id}`)
      .digest('hex');

    if (!safeEqualHex(expected, dto.razorpay_signature)) {
      throw new BadRequestException('Invalid Razorpay signature');
    }

    const invoice = await this.prisma.invoice.findFirst({
      where:   { id: dto.invoiceId, ...(clinicId && { clinicId }) },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, email: true, waOptIn: true } },
        clinic:  { select: { name: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'paid') return { success: true, alreadyPaid: true };

    // The signed order must be the one we created for THIS invoice; otherwise a valid
    // signature from a different (cheaper) order could be replayed against this invoice.
    if (!invoice.razorpayOrderId || invoice.razorpayOrderId !== dto.razorpay_order_id) {
      this.logger.warn(`Order/invoice mismatch on verify: invoice ${dto.invoiceId}`);
      throw new BadRequestException('Order does not belong to this invoice');
    }

    // Confirm with Razorpay that the payment exists, belongs to the order and was authorised.
    const rzpPayment = await this.rzp.payments.fetch(dto.razorpay_payment_id);
    if (rzpPayment.order_id !== dto.razorpay_order_id
        || !['captured', 'authorized'].includes(rzpPayment.status)) {
      throw new BadRequestException('Payment is not completed for this order');
    }

    await this.recordSuccessfulPayment({
      clinicId:           invoice.clinicId,
      invoiceId:          dto.invoiceId,
      patientId:          invoice.patientId,
      amountPaid:         Number(rzpPayment.amount) / 100,
      razorpayOrderId:    dto.razorpay_order_id,
      razorpayPaymentId:  dto.razorpay_payment_id,
      razorpaySignature:  dto.razorpay_signature,
      method:             'razorpay_checkout',
    });

    return { success: true };
  }

  // ── 4. Webhook signature verification ─────────────────────────────────────

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const webhookSecret = this.config.get<string>('razorpay.webhookSecret');
    if (!webhookSecret) {
      // Fail closed: without a secret anyone could forge "payment captured" events.
      this.logger.error('razorpay.webhookSecret is not configured — rejecting webhook');
      return false;
    }
    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    return safeEqualHex(expected, signature);
  }

  // ── 5. Atomic payment recording (shared by webhook + client verify) ────────

  async recordSuccessfulPayment(params: {
    clinicId:          string;
    invoiceId:         string;
    patientId:         string;
    amountPaid:        number;
    razorpayOrderId:   string;
    razorpayPaymentId: string;
    razorpaySignature?: string;
    method:            string;
    isPartial?:        boolean;
  }) {
    // Idempotency: bail out if this payment was already recorded
    const existing = await this.prisma.payment.findFirst({
      where: { razorpayPaymentId: params.razorpayPaymentId },
    });
    if (existing) {
      this.logger.warn(`Duplicate webhook ignored: ${params.razorpayPaymentId}`);
      return existing;
    }

    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: params.invoiceId },
    });
    if (invoice.clinicId !== params.clinicId) {
      this.logger.error(`Tenant mismatch recording payment ${params.razorpayPaymentId}; ignored`);
      return null;
    }
    params = { ...params, patientId: invoice.patientId };

    const newPaid    = Number(invoice.paidAmount) + params.amountPaid;
    const newBalance = Math.max(0, Number(invoice.totalAmount) - newPaid);
    const newStatus  = newBalance === 0 ? 'paid' : 'partially_paid';

    let payment;
    try {
    [payment] = await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          clinicId:          params.clinicId,
          invoiceId:         params.invoiceId,
          patientId:         params.patientId,
          amount:            params.amountPaid,
          method:            toPaymentMethod(params.method),
          status:            'success',
          razorpayOrderId:   params.razorpayOrderId,
          razorpayPaymentId: params.razorpayPaymentId,
          razorpaySignature: params.razorpaySignature,
          paidAt:            new Date(),
        },
      }),

      this.prisma.invoice.update({
        where: { id: params.invoiceId },
        data: {
          paidAmount:    newPaid,
          balanceAmount: newBalance,
          status:        newStatus,
          paidAt:        newStatus === 'paid' ? new Date() : undefined,
        },
      }),

      this.prisma.patient.update({
        where: { id: params.patientId },
        data:  { outstandingBalance: { decrement: params.amountPaid } },
      }),
    ]);
    } catch (err) {
      // Concurrent delivery of the same payment: razorpay_payment_id is UNIQUE, so the loser is a replay
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(`Duplicate payment ignored: ${params.razorpayPaymentId}`);
        return null;
      }
      throw err;
    }

    this.logger.log(
      `Payment recorded: ₹${params.amountPaid} on invoice ${params.invoiceId} → ${newStatus}`,
    );

    // Fire events for downstream listeners (WhatsApp, notifications)
    this.emitter.emit('payment.success', {
      clinicId:          params.clinicId,
      invoiceId:         params.invoiceId,
      patientId:         params.patientId,
      amountPaid:        params.amountPaid,
      razorpayPaymentId: params.razorpayPaymentId,
      isFullPayment:     newStatus === 'paid',
    });

    return payment;
  }

  // ── 6. Refund recording ───────────────────────────────────────────────────

  async recordRefund(params: {
    clinicId:        string;
    razorpayRefundId: string;
    razorpayPaymentId: string;
    amountRefunded:  number;
    speed:           string;
  }) {
    // Find the original payment
    const originalPayment = await this.prisma.payment.findFirst({
      where: { razorpayPaymentId: params.razorpayPaymentId },
    });
    if (!originalPayment) {
      this.logger.warn(`Refund for unknown payment: ${params.razorpayPaymentId}`);
      return;
    }

    if (params.amountRefunded <= 0 || params.amountRefunded > Number(originalPayment.amount)) {
      this.logger.error(`Refund ${params.razorpayRefundId} amount invalid vs payment; needs manual review`);
      return;
    }

    // Idempotency check
    const existingRefund = await this.prisma.payment.findFirst({
      where: { razorpayPaymentId: params.razorpayRefundId },
    });
    if (existingRefund) return;

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: originalPayment.invoiceId },
    });
    if (!invoice) return;

    const newPaid    = Math.max(0, Number(invoice.paidAmount) - params.amountRefunded);
    const newBalance = Number(invoice.totalAmount) - newPaid;

    try {
      await this.prisma.$transaction([
        this.prisma.payment.create({
          data: {
            clinicId:          params.clinicId,
            invoiceId:         originalPayment.invoiceId,
            patientId:         originalPayment.patientId,
            amount:            -params.amountRefunded,   // negative = refund
            method:            'razorpay',
            status:            'refunded',
            razorpayOrderId:   originalPayment.razorpayOrderId,
            razorpayPaymentId: params.razorpayRefundId,
            paidAt:            new Date(),
          },
        }),

        this.prisma.invoice.update({
          where: { id: originalPayment.invoiceId },
          data: {
            paidAmount:    newPaid,
            balanceAmount: newBalance,
            status:        newPaid === 0 ? 'refunded' : 'partially_paid',
          },
        }),

        ...(originalPayment.patientId
          ? [this.prisma.patient.update({
              where: { id: originalPayment.patientId },
              data:  { outstandingBalance: { increment: params.amountRefunded } },
            })]
          : []),
      ]);
    } catch (err) {
      // Concurrent delivery of the same refund id: refund payment id is UNIQUE, so the loser is a replay
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(`Duplicate refund ignored: ${params.razorpayRefundId}`);
        return;
      }
      throw err;
    }

    this.emitter.emit('payment.refunded', {
      clinicId:        params.clinicId,
      invoiceId:       originalPayment.invoiceId,
      patientId:       originalPayment.patientId,
      amountRefunded:  params.amountRefunded,
    });

    this.logger.log(`Refund recorded: ₹${params.amountRefunded} for ${params.razorpayPaymentId}`);
  }

  // ── 7. Public checkout resolve (no JWT required) ─────────────────────────
  // The /pay/[orderId] page hits this to get key + amount for Razorpay.js.

  async resolveCheckout(razorpayOrderId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where:   { razorpayOrderId },
      include: { patient: { select: { fullName: true } } },
    });

    if (!invoice) {
      const { NotFoundException } = await import('@nestjs/common');
      throw new NotFoundException('Order not found');
    }

    if (invoice.status === 'paid') {
      const { ConflictException } = await import('@nestjs/common');
      throw new ConflictException('Invoice already paid');
    }

    return {
      orderId:       razorpayOrderId,
      amount:        Math.round(Number(invoice.balanceAmount) * 100),
      amountDisplay: Number(invoice.balanceAmount),
      currency:      'INR',
      key:           this.config.get<string>('razorpay.keyId'),
      invoiceNumber: invoice.invoiceNumber,
      patientName:   (invoice as any).patient?.fullName ?? '',
      description:   `Payment for ${invoice.invoiceNumber}`,
      invoiceId:     invoice.id,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async loadInvoice(clinicId: string, invoiceId: string) {
    // An undefined clinicId would make Prisma drop the filter and match invoices of ANY tenant
    if (!clinicId) throw new BadRequestException('Clinic context is required');
    const invoice = await this.prisma.invoice.findFirst({
      where:   { id: invoiceId, clinicId },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, email: true, waOptIn: true } },
        clinic:  { select: { name: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  private assertPayable(invoice: any) {
    if (['paid', 'cancelled'].includes(invoice.status)) {
      throw new BadRequestException(
        `Invoice ${invoice.invoiceNumber} is already ${invoice.status}`,
      );
    }
    if (Number(invoice.balanceAmount) <= 0) {
      throw new BadRequestException('No outstanding balance on this invoice');
    }
  }
}
