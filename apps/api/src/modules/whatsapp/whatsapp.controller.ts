import {
  Controller, Get, Post, Param, Body, Query,
  ParseUUIDPipe, HttpCode, HttpStatus, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from './whatsapp.service';
import { WebhookHandler } from './webhook/webhook.handler';
import { BookingFlow } from './flows/booking.flow';
import { Public } from '../../common/decorators/public.decorator';
import { ClinicId } from '../../common/decorators/current-user.decorator';
import { IsString, IsObject, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class SendTextDto {
  @ApiProperty() @IsString() to: string;
  @ApiProperty() @IsString() message: string;
}

class SendTemplateDto {
  @ApiProperty() @IsString() to: string;
  @ApiProperty() @IsString() templateName: string;
  @ApiProperty() @IsObject() params: Record<string, string>;
}

@ApiTags('WhatsApp')
@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly webhookHandler:  WebhookHandler,
    private readonly bookingFlow:     BookingFlow,
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
      console.error('Webhook processing error:', err),
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

  // ── Manual / test send ────────────────────────────────────────────────────

  @Post('send')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send a plain text WhatsApp message (manual/testing)' })
  sendText(@ClinicId() clinicId: string, @Body() dto: SendTextDto) {
    return this.whatsappService.sendText(clinicId, dto.to, dto.message);
  }

  @Post('send-template')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send a pre-approved template message' })
  sendTemplate(@ClinicId() clinicId: string, @Body() dto: SendTemplateDto) {
    return this.whatsappService.sendTemplate(clinicId, dto.to, dto.templateName, dto.params);
  }

  // ── Start booking flow (for deep links / QR codes) ────────────────────────

  @Post('start-booking')
  @Public()
  @ApiOperation({ summary: 'Initiate booking flow for a phone number (QR / click-to-chat)' })
  startBooking(
    @Param('clinicId') clinicId: string,
    @Body() dto: { phone: string },
  ) {
    return this.bookingFlow.start(dto.phone, clinicId);
  }
}
