/**
 * RazorpayWebhookService
 *
 * Validates the HMAC signature then dispatches to the correct handler
 * for each Razorpay event type.
 *
 * Razorpay webhook payload structure:
 * {
 *   entity:  "event",
 *   event:   "payment.captured",
 *   contains: ["payment"],
 *   payload: {
 *     payment: {
 *       entity: { id, order_id, amount, status, notes, method, ... }
 *     }
 *   }
 * }
 */

import { Injectable, Logger } from '@nestjs/common';
import { RazorpayService } from './razorpay.service';
import { PrismaService } from '../../../prisma/prisma.service';

// All event types we care about
type RazorpayEvent =
  | 'payment.captured'
  | 'payment.failed'
  | 'payment_link.paid'
  | 'payment_link.partially_paid'
  | 'refund.processed'
  | 'refund.failed';

@Injectable()
export class RazorpayWebhookService {
  private readonly logger = new Logger(RazorpayWebhookService.name);

  constructor(
    private readonly razorpay: RazorpayService,
    private readonly prisma:   PrismaService,
  ) {}

  async process(rawBody: Buffer, signature: string, payload: any): Promise<void> {
    // ── 1. Verify HMAC signature ──────────────────────────────────────────────
    const isValid = this.razorpay.verifyWebhookSignature(rawBody, signature ?? '');
    if (!isValid) {
      this.logger.error(`Invalid webhook signature — discarding event: ${payload.event}`);
      return;
    }

    const event = payload.event as RazorpayEvent;

    // ── 2. Dispatch to handler ────────────────────────────────────────────────
    switch (event) {
      case 'payment.captured':
        await this.onPaymentCaptured(payload);
        break;

      case 'payment.failed':
        await this.onPaymentFailed(payload);
        break;

      case 'payment_link.paid':
        await this.onPaymentLinkPaid(payload);
        break;

      case 'payment_link.partially_paid':
        await this.onPaymentLinkPartiallyPaid(payload);
        break;

      case 'refund.processed':
        await this.onRefundProcessed(payload);
        break;

      case 'refund.failed':
        this.logger.warn(`Refund failed: ${JSON.stringify(payload.payload?.refund?.entity)}`);
        break;

      default:
        this.logger.debug(`Unhandled Razorpay event: ${event}`);
    }
  }

  // ── payment.captured ──────────────────────────────────────────────────────
  // Fired when an Order payment is fully captured.
  // notes.invoiceId was embedded when we created the order.

  private async onPaymentCaptured(payload: any) {
    const entity    = payload.payload.payment.entity;
    const invoiceId = entity.notes?.invoiceId as string | undefined;
    const clinicId  = entity.notes?.clinicId  as string | undefined;
    const patientId = entity.notes?.patientId as string | undefined;

    if (!invoiceId || !clinicId) {
      this.logger.warn(`payment.captured missing notes — orderId: ${entity.order_id}`);
      return;
    }

    await this.razorpay.recordSuccessfulPayment({
      clinicId,
      invoiceId,
      patientId:         patientId ?? await this.resolvePatientId(invoiceId),
      amountPaid:        entity.amount / 100,     // paise → rupees
      razorpayOrderId:   entity.order_id,
      razorpayPaymentId: entity.id,
      method:            entity.method ?? 'razorpay',
    });
  }

  // ── payment.failed ────────────────────────────────────────────────────────
  // Mark invoice back to 'sent' (not cancelled) so patient can retry.

  private async onPaymentFailed(payload: any) {
    const entity    = payload.payload.payment.entity;
    const invoiceId = entity.notes?.invoiceId as string | undefined;

    if (!invoiceId) return;

    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.status === 'paid') return;

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data:  { status: 'sent' },   // keep as 'sent' so retry is possible
    });

    this.logger.warn(
      `Payment failed for invoice ${invoiceId} — reason: ${entity.error_description ?? 'unknown'}`,
    );

    // Optionally fire an event so a WhatsApp "payment failed" message can be sent
    // this.emitter.emit('payment.failed', { invoiceId, ... });
  }

  // ── payment_link.paid ─────────────────────────────────────────────────────
  // Fired when a Payment Link is fully paid.
  // notes.invoiceId was embedded when we created the payment link.

  private async onPaymentLinkPaid(payload: any) {
    const linkEntity    = payload.payload.payment_link.entity;
    const paymentEntity = payload.payload.payment?.entity;

    const invoiceId = linkEntity.notes?.invoiceId as string | undefined;
    const clinicId  = linkEntity.notes?.clinicId  as string | undefined;
    const patientId = linkEntity.notes?.patientId as string | undefined;

    if (!invoiceId || !clinicId) {
      this.logger.warn(`payment_link.paid missing notes — linkId: ${linkEntity.id}`);
      return;
    }

    await this.razorpay.recordSuccessfulPayment({
      clinicId,
      invoiceId,
      patientId:         patientId ?? await this.resolvePatientId(invoiceId),
      amountPaid:        linkEntity.amount_paid / 100,
      razorpayOrderId:   linkEntity.id,
      razorpayPaymentId: paymentEntity?.id ?? `pl_${linkEntity.id}`,
      method:            paymentEntity?.method ?? 'payment_link',
    });
  }

  // ── payment_link.partially_paid ───────────────────────────────────────────
  // Fired when partial_payment is enabled and the customer pays part of the amount.

  private async onPaymentLinkPartiallyPaid(payload: any) {
    const linkEntity    = payload.payload.payment_link.entity;
    const paymentEntity = payload.payload.payment?.entity;

    const invoiceId = linkEntity.notes?.invoiceId as string | undefined;
    const clinicId  = linkEntity.notes?.clinicId  as string | undefined;
    const patientId = linkEntity.notes?.patientId as string | undefined;

    if (!invoiceId || !clinicId || !paymentEntity) return;

    await this.razorpay.recordSuccessfulPayment({
      clinicId,
      invoiceId,
      patientId:         patientId ?? await this.resolvePatientId(invoiceId),
      amountPaid:        paymentEntity.amount / 100,
      razorpayOrderId:   linkEntity.id,
      razorpayPaymentId: paymentEntity.id,
      method:            paymentEntity.method ?? 'payment_link',
      isPartial:         true,
    });
  }

  // ── refund.processed ──────────────────────────────────────────────────────

  private async onRefundProcessed(payload: any) {
    const entity = payload.payload.refund.entity;

    // Find the clinic from the original payment
    const originalPayment = await this.prisma.payment.findFirst({
      where: { razorpayPaymentId: entity.payment_id },
    });

    if (!originalPayment) {
      this.logger.warn(`Refund for unknown payment: ${entity.payment_id}`);
      return;
    }

    await this.razorpay.recordRefund({
      clinicId:          originalPayment.clinicId,
      razorpayRefundId:  entity.id,
      razorpayPaymentId: entity.payment_id,
      amountRefunded:    entity.amount / 100,
      speed:             entity.speed_processed ?? 'normal',
    });
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  private async resolvePatientId(invoiceId: string): Promise<string> {
    const inv = await this.prisma.invoice.findUnique({
      where:  { id: invoiceId },
      select: { patientId: true },
    });
    return inv?.patientId ?? '';
  }
}
