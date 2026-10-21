import {
  Controller, Get, Post, Param, Body, Query,
  ParseUUIDPipe, HttpCode, HttpStatus, Res, BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from './whatsapp.service';
import { WebhookHandler } from './webhook/webhook.handler';
import { PublicBookingService } from './public-booking.service';
import { SendTextDto, SendTemplateDto, StartBookingDto, paramsAreValid } from './dto/send-message.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { logEvent } from '../../common/observability/structured-logger';
import { sanitizeStack, summariseError } from '../../common/observability/redaction';
import { Public } from '../../common/decorators/public.decorator';
import { ClinicId } from '../../common/decorators/current-user.decorator';

@ApiTags('WhatsApp')
@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly webhookHandler:  WebhookHandler,
    private readonly publicBooking:   PublicBookingService,
    private readonly config:          ConfigService,
  ) {}

  // ── Webhook verification (GET) — Twilio doesn't use Meta's hub.challenge ──
  // Twilio validates via X-Twilio-Signature on POST only.
  // We expose a simple GET for uptime/health checks.

  @Get('webhook/:clinicId')
  @Public()
  @ApiOperation({ summary: 'Webhook health check / Meta hub.challenge' })
  verifyWebhook(
    @Param('clinicId') clinicId: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const verifyToken = this.config.get<string>('whatsapp.verifyToken');
    if (mode === 'subscribe' && token === verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.status(200).json({ status: 'ok' });
  }

  // ── Twilio webhook receiver (POST) ────────────────────────────────────────
  // Twilio sends form-encoded POST body (application/x-www-form-urlencoded).
  // @Body() will be the parsed form fields.

  @Post('webhook/:clinicId')
  @Public()
  @HttpCode(HttpStatus.OK)       // Twilio expects 200 or retries
  @ApiOperation({ summary: 'Inbound WhatsApp messages from Twilio' })
  async receiveWebhook(
    @Param('clinicId') clinicId: string,
    @Body() payload: Record<string, string>,
  ) {
    // Run async — respond to Twilio immediately (< 10s SLA)
    this.webhookHandler.handle(clinicId, payload).catch((err) =>
      logEvent('error', 'whatsapp.webhook_failed', { error: summariseError(err), stack: sanitizeStack(err instanceof Error ? err.stack : undefined) }),
    );
    // Twilio expects an empty 200 or TwiML — return empty TwiML
    return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  }

  // ── Conversations ─────────────────────────────────────────────────────────

  @Get('conversations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List WhatsApp conversations' })
  getConversations(
    @ClinicId() clinicId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.whatsappService.getConversations(clinicId, +page, +limit);
  }

  @Get('conversations/:id/messages')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get messages in a conversation' })
  getMessages(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.whatsappService.getMessages(clinicId, conversationId, +page, +limit);
  }

  // ── Manual send (staff) ───────────────────────────────────────────────────
  // Requires `whatsapp:send` (dentist, receptionist, admins; NOT assistant) and a recipient that is a patient of the
  // CALLER'S clinic who has opted in. Rate limited per client.

  @Post('send')
  @RequirePermission('whatsapp:send')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send a plain text WhatsApp message to an opted-in patient of this clinic' })
  async sendText(@ClinicId() clinicId: string, @Body() dto: SendTextDto) {
    await this.whatsappService.assertRecipientConsented(clinicId, dto.to);
    return this.whatsappService.sendText(clinicId, dto.to, dto.message);
  }

  @Post('send-template')
  @RequirePermission('whatsapp:send')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send an allow-listed template message to an opted-in patient of this clinic' })
  async sendTemplate(@ClinicId() clinicId: string, @Body() dto: SendTemplateDto) {
    if (!paramsAreValid(dto.params)) throw new BadRequestException('params must be at most 10 string values of 300 characters or less');
    await this.whatsappService.assertRecipientConsented(clinicId, dto.to);
    return this.whatsappService.sendTemplate(clinicId, dto.to, dto.templateName, dto.params);
  }

  // ── Start booking flow (public: QR / click-to-chat) ───────────────────────
  // Strict per-IP throttle here; per-phone cooldown, clinic check and consent gate in PublicBookingService.
  // Always answers 202 {accepted:true} so it cannot be used to probe patients or opt-out state.

  @Post('start-booking')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Initiate booking flow for a phone number (QR / click-to-chat)' })
  startBooking(@Body() dto: StartBookingDto) {
    return this.publicBooking.start(dto.clinicId, dto.phone);
  }
}
