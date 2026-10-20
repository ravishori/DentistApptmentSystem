import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type WhatsappProvider = 'twilio' | '360dialog';

/**
 * Decides which WhatsApp provider owns a message that BOTH integrations are able to send.
 *
 * Verified roles (neither provider is disabled by this policy — it only picks ONE sender per duplicated message):
 *   Twilio     (TwilioSenderService)  conversational flows (booking / reschedule / follow-up sessions), 48h + 24h
 *                                      reminder crons, post-visit follow-up, broadcasts, inbound webhook, and the
 *                                      booking confirmation in ReminderFlow.
 *   360Dialog  (WhatsappService)      event-driven transactional messages: booking confirmation, 24h/2h reminders,
 *                                      follow-up, invoice payment link, payment receipt and refund notices. The
 *                                      2h reminder, payment link and receipts exist ONLY here (Twilio has no
 *                                      implementation), so this path must stay enabled.
 * Duplicated today: the booking confirmation (both listen to `appointment.booked`). This policy routes it.
 *
 * Selection: WHATSAPP_PROVIDER (default "twilio", the configured primary in .env.example). If the primary has no
 * usable credentials and the other does, the other sends instead, so a confirmation is never silently dropped.
 */
@Injectable()
export class WhatsappProviderPolicy {
  private readonly logger = new Logger(WhatsappProviderPolicy.name);

  constructor(private readonly config: ConfigService) {}

  /** Provider named by configuration; unknown values fall back to Twilio (the documented default). */
  primary(): WhatsappProvider {
    const raw = (this.config.get<string>('whatsapp.provider') ?? 'twilio').trim().toLowerCase();
    if (raw === 'twilio') return 'twilio';
    if (raw === '360dialog' || raw === 'd360' || raw === '360') return '360dialog';
    this.logger.warn(`Unknown WHATSAPP_PROVIDER "${raw}" — using twilio`);
    return 'twilio';
  }

  /** Real-looking credentials only: .env.example placeholders (ACxxxx…, your_…) do not count as configured. */
  isConfigured(provider: WhatsappProvider): boolean {
    if (provider === 'twilio') {
      const sid = this.config.get<string>('twilio.accountSid') ?? '';
      const token = this.config.get<string>('twilio.authToken') ?? '';
      return /^AC[0-9a-fA-F]{32}$/.test(sid) && token.length >= 16 && !/^(your_|change|x+$)/i.test(token);
    }
    const key = this.config.get<string>('whatsapp.apiKey') ?? '';
    return key.length >= 16 && !/^(your_|change|x+$)/i.test(key);
  }

  /** The provider that should send messages both integrations could send. */
  effective(): WhatsappProvider {
    const primary = this.primary();
    if (this.isConfigured(primary)) return primary;
    const other: WhatsappProvider = primary === 'twilio' ? '360dialog' : 'twilio';
    return this.isConfigured(other) ? other : primary;   // nothing usable: keep the primary (its failure is then visible)
  }

  /** True when `provider` is the one that owns a duplicated message. */
  shouldSend(provider: WhatsappProvider): boolean {
    return this.effective() === provider;
  }
}
