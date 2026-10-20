import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { winstonLogger } from './winston.logger';

const COOLDOWN_MS = 60_000;  // dedupe identical errors within 60 seconds

@Injectable()
export class ErrorEmailService {
  private readonly logger      = new Logger(ErrorEmailService.name);
  private readonly transport:    nodemailer.Transporter | null;
  private readonly alertTo:      string;
  private readonly from:         string;
  private readonly recentErrors  = new Map<string, number>();

  constructor(private readonly config: ConfigService) {
    this.alertTo = config.get<string>('ALERT_EMAIL') ?? 'ravishori@gmail.com';
    this.from    = config.get<string>('EMAIL_FROM')  ?? this.alertTo;
    this.transport = this.buildTransport();

    if (!this.transport) {
      this.logger.warn(
        '⚠️  Error-email transport is NOT configured. Set GMAIL_USER + GMAIL_APP_PASSWORD ' +
        'in .env to enable email alerts. Errors will still be logged to console.',
      );
    } else {
      this.logger.log(`✉️  Error alerts will be emailed to ${this.alertTo}`);
    }
  }

  /**
   * Build a nodemailer transport. Prefers Gmail SMTP if credentials are present,
   * otherwise returns null (errors fall back to console-only logging).
   */
  private buildTransport(): nodemailer.Transporter | null {
    const gmailUser = this.config.get<string>('GMAIL_USER');
    const gmailPass = this.config.get<string>('GMAIL_APP_PASSWORD');

    if (gmailUser && gmailPass && !gmailPass.startsWith('your_')) {
      return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: gmailUser, pass: gmailPass },
      });
    }

    // Generic SMTP fallback
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (host && port && user && pass) {
      return nodemailer.createTransport({
        host, port, secure: port === 465,
        auth: { user, pass },
      });
    }

    return null;
  }

  async sendAlert(opts: {
    subject:   string;
    error:     Error | string | { message: string; stack?: string; name?: string };
    context?:  string;
    request?:  { method?: string; url?: string; ip?: string; userId?: string; clinicId?: string };
    extra?:    Record<string, unknown>;
  }) {
    // Normalise error
    const errMsg   = typeof opts.error === 'string' ? opts.error
                   : (opts.error as any).message ?? String(opts.error);
    const errStack = typeof opts.error === 'string' ? undefined
                   : (opts.error as any).stack;

    // Always log to console first — never gated by transport
    winstonLogger.error(`[${opts.context ?? 'app'}] ${opts.subject}`, {
      message: errMsg,
      stack:   errStack,
      request: opts.request,
      extra:   opts.extra,
    });

    if (!this.transport) return;

    // Dedupe
    const fingerprint = `${opts.subject}::${errMsg.slice(0, 120)}`;
    const last        = this.recentErrors.get(fingerprint) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) return;
    this.recentErrors.set(fingerprint, Date.now());

    const env = this.config.get<string>('NODE_ENV') ?? 'unknown';

    const html = `
      <h2 style="color:#d9534f;margin-bottom:8px">DentalEase Error Alert</h2>
      <table style="border-collapse:collapse;font-family:monospace;font-size:13px">
        <tr><td style="padding:4px 8px;font-weight:bold;background:#f5f5f5">Environment</td><td>${env}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;background:#f5f5f5">Context</td><td>${escapeHtml(opts.context ?? '–')}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;background:#f5f5f5">Message</td><td>${escapeHtml(errMsg)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;background:#f5f5f5">Time</td><td>${new Date().toISOString()}</td></tr>
        ${opts.request ? `
          <tr><td style="padding:4px 8px;font-weight:bold;background:#f5f5f5">Request</td><td>${escapeHtml(`${opts.request.method ?? ''} ${opts.request.url ?? ''}`)}</td></tr>
          <tr><td style="padding:4px 8px;font-weight:bold;background:#f5f5f5">IP</td><td>${escapeHtml(opts.request.ip ?? '–')}</td></tr>
          <tr><td style="padding:4px 8px;font-weight:bold;background:#f5f5f5">User</td><td>${escapeHtml(opts.request.userId ?? 'anonymous')}</td></tr>
          <tr><td style="padding:4px 8px;font-weight:bold;background:#f5f5f5">Clinic</td><td>${escapeHtml(opts.request.clinicId ?? '–')}</td></tr>
        ` : ''}
        ${opts.extra ? `<tr><td style="padding:4px 8px;font-weight:bold;background:#f5f5f5">Extra</td>
            <td><pre style="margin:0">${escapeHtml(JSON.stringify(opts.extra, null, 2))}</pre></td></tr>` : ''}
      </table>
      <h3 style="margin-top:16px">Stack trace</h3>
      <pre style="background:#f5f5f5;padding:12px;border-radius:4px;font-size:11px;white-space:pre-wrap">${escapeHtml(errStack ?? 'No stack available')}</pre>
      <p style="color:#888;font-size:11px;margin-top:16px">
        Auto-generated by DentalEase API. Identical errors are throttled to 1 per minute.
      </p>
    `;

    try {
      await this.transport.sendMail({
        from:    this.from,
        to:      this.alertTo,
        subject: `[DentalEase ${env.toUpperCase()}] ${opts.subject}`,
        html,
        text:    `${opts.subject}\n\n${errMsg}\n\n${errStack ?? ''}`,
      });
      this.logger.log(`📧  Alert sent → ${this.alertTo}: ${opts.subject}`);
    } catch (mailErr) {
      winstonLogger.error('Failed to send error alert email', {
        original: errMsg,
        mailErr:  String(mailErr),
      });
    }
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
