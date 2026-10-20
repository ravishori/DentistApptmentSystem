/**
 * RazorpayWebhookController
 *
 * Receives server-to-server events from Razorpay.
 * Endpoint: POST /api/v1/billing/webhooks/razorpay
 *
 * Security model:
 *   – Route is @Public() (no JWT) — authenticated via HMAC signature instead
 *   – Raw body is preserved (rawBody: true in main.ts) for signature verification
 *   – We respond 200 immediately then process async to meet Razorpay's 5-second SLA
 *   – Idempotency is enforced inside RazorpayService.recordSuccessfulPayment()
 *
 * Events handled:
 *   payment.captured         → full payment success (most common)
 *   payment.failed           → charge declined / timeout
 *   payment_link.paid        → Payment Link fully paid
 *   payment_link.partially_paid → partial payment on a Payment Link
 *   refund.processed         → refund settled
 *   refund.failed            → refund could not be processed
 */

import {
  Controller, Post, Headers, RawBodyRequest,
  Req, HttpCode, HttpStatus, Logger, UnauthorizedException, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator';
import { RazorpayWebhookService } from './razorpay-webhook.service';

@ApiTags('Billing')
@Controller({ path: 'billing/webhooks', version: '1' })
export class RazorpayWebhookController {
  private readonly logger = new Logger(RazorpayWebhookController.name);

  constructor(private readonly webhookService: RazorpayWebhookService) {}

  @Post('razorpay')
  @Public()
  // Server-to-server; allow Razorpay retries/bursts but cap forged-traffic floods
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Razorpay server-side webhook (HMAC-authenticated)' })
  @ApiExcludeEndpoint()
  async handle(
    @Req()     req:       RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    const rawBody = req.rawBody;

    if (!rawBody) {
      this.logger.warn('Webhook received without raw body — check rawBody: true in main.ts');
      return { received: true };
    }

    // Authenticate BEFORE parsing or trusting any of the body
    if (!this.webhookService.isAuthentic(rawBody, signature)) {
      this.logger.error('Rejected Razorpay webhook: invalid or unverifiable signature');
      throw new UnauthorizedException();
    }
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Malformed payload');
    }

    this.logger.log(`Razorpay webhook: ${payload.event} | entity: ${payload.payload?.payment?.entity?.id ?? payload.payload?.refund?.entity?.id ?? '?'}`);

    // Process async — respond 200 immediately so Razorpay won't retry
    setImmediate(() =>
      this.webhookService.process(rawBody, signature, payload).catch((err) =>
        this.logger.error(`Webhook processing error: ${err.message}`, err.stack),
      ),
    );

    return { received: true };
  }
}
