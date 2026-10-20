import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import { TwilioTextMessage, TwilioTemplateMessage, ButtonsPayload, ListPayload } from './template-builder';

type TwilioClient = ReturnType<typeof Twilio>;

@Injectable()
export class TwilioSenderService {
  private readonly logger = new Logger(TwilioSenderService.name);
  private readonly client: TwilioClient;
  private readonly from:   string;

  constructor(private readonly config: ConfigService) {
    this.client = Twilio(
      config.get<string>('twilio.accountSid'),
      config.get<string>('twilio.authToken'),
    );
    this.from = `whatsapp:${config.get<string>('twilio.whatsappNumber')}`;
  }

  // ── Plain text ────────────────────────────────────────────────────────────

  async sendText(to: string, body: string): Promise<string> {
    try {
      const msg = await this.client.messages.create({
        from: this.from,
        to:   `whatsapp:${to}`,
        body,
      });
      this.logger.log(`Text sent → ${to} | SID: ${msg.sid}`);
      return msg.sid;
    } catch (err) {
      this.logger.error(`Text failed → ${to}: ${(err as Error).message}`);
      throw err;
    }
  }

  // ── Pre-approved template ─────────────────────────────────────────────────

  async sendTemplate(payload: TwilioTemplateMessage): Promise<string> {
    try {
      const msg = await this.client.messages.create({
        from:             payload.from,
        to:               payload.to,
        contentSid:       payload.contentSid,
        contentVariables: payload.contentVariables,
      } as any);
      this.logger.log(`Template sent → ${payload.to} | SID: ${msg.sid}`);
      return msg.sid;
    } catch (err) {
      this.logger.error(`Template failed → ${payload.to}: ${(err as Error).message}`);
      throw err;
    }
  }

  // ── Interactive buttons (free-form 24h window) ────────────────────────────
  // Twilio renders interactive buttons via the Content API.
  // Within 24h session window we can send free-form interactive messages.

  async sendButtons(to: string, payload: ButtonsPayload): Promise<string> {
    // Build a text fallback with numbered options for non-interactive clients
    const numberedList = payload.buttons
      .map((b, i) => `${i + 1}. ${b.title}`)
      .join('\n');

    const body = `${payload.body}\n\n${numberedList}\n\n_Reply with the number or keyword_`;

    // In production: use Twilio Content API SID for interactive buttons.
    // Fallback: plain text with inline options.
    return this.sendText(to, body);
  }

  // ── Interactive list ──────────────────────────────────────────────────────

  async sendList(to: string, payload: ListPayload): Promise<string> {
    const rows = payload.sections
      .flatMap((s) => s.rows)
      .map((r, i) => `${i + 1}. ${r.title}${r.description ? ` — ${r.description}` : ''}`)
      .join('\n');

    const body = [
      payload.header,
      '',
      payload.body,
      '',
      rows,
      payload.footer ? `\n_${payload.footer}_` : '',
      `\nReply with a number to ${payload.button.toLowerCase()}`,
    ].join('\n');

    return this.sendText(to, body);
  }

  // ── Bulk (rate-limited) ───────────────────────────────────────────────────

  async sendBulk(
    messages: TwilioTemplateMessage[],
    onProgress?: (sent: number, total: number) => void,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < messages.length; i++) {
      try {
        await this.sendTemplate(messages[i]);
        sent++;
      } catch {
        failed++;
      }

      onProgress?.(sent + failed, messages.length);

      // Twilio rate limit: ~10 msg/sec — add 120ms delay per message
      if (i < messages.length - 1) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    return { sent, failed };
  }

  get fromNumber(): string {
    const from = this.config.get<string>('twilio.whatsappNumber');
    if (!from) throw new Error('twilio.whatsappNumber is not configured');
    return from;
  }
}
