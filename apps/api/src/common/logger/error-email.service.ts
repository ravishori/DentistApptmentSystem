import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { logEvent, SERVICE_NAME } from '../observability/structured-logger';
import { sanitizeText, summariseError, templatePath } from '../observability/redaction';
import { MetricsService } from '../observability/metrics.service';
import { getRequestId } from '../observability/context-store';

/**
 * Administrator alerting (e-mail). This is the single alert implementation; the exception filter, the client-error
 * endpoint, the infrastructure health monitor and the process-level handlers all go through `report()`.
 *
 * Guarantees
 *  - NEVER blocks or fails the caller: `report()` is synchronous, enqueues and returns a ticket.
 *  - Bounded: queue length, deliveries per hour, de-duplication table and retries are all capped.
 *  - No recursion: delivery failures are only logged + counted; they never produce another alert.
 *  - Honest status: "queued" ≠ "SMTP accepted" ≠ "delivered to an inbox". Only the first two are knowable here.
 *  - Contents are built from sanitised fields only (no stack traces, bodies, headers, IPs, user data or secrets).
 *
 * Configuration (environment; placeholders in .env.example): ALERT_EMAIL_TO (comma list; legacy ALERT_EMAIL),
 * ALERT_EMAIL_FROM (legacy EMAIL_FROM), SMTP_HOST/PORT/USER/PASS/SECURE (legacy GMAIL_USER + GMAIL_APP_PASSWORD),
 * ALERT_COOLDOWN_SECONDS, ALERT_MAX_PER_HOUR, ALERT_QUEUE_MAX, ALERT_MAX_ATTEMPTS, ALERT_RETRY_BASE_MS,
 * ALERT_SMTP_TIMEOUT_MS, ALERT_MIN_SEVERITY, ALERT_ENABLED.
 */

export type AlertSeverity = 'warning' | 'error' | 'critical';
export type AlertKind = 'error' | 'recovery' | 'test';
export type AlertOutcome = 'queued' | 'suppressed' | 'dropped' | 'disabled';
export type DeliveryState = 'smtp_accepted' | 'failed' | 'dropped';

export interface AlertEvent {
  severity: AlertSeverity;
  code: string;
  subsystem: string;
  summary: string;
  route?: string;
  requestId?: string;
  clinicId?: string;
  /** Extra discriminator for de-duplication (e.g. a component name). */
  discriminator?: string;
  kind?: AlertKind;
}

export interface AlertTicket {
  id?: string;
  outcome: AlertOutcome;
  reason?: string;
  /** Resolves when the queued alert reaches a terminal delivery state (never rejects). */
  result?: Promise<{ state: DeliveryState; attempts: number; messageId?: string; reason?: string }>;
}

export const ALERT_TRANSPORT = 'ALERT_TRANSPORT';
const SEVERITY_RANK: Record<AlertSeverity, number> = { warning: 1, error: 2, critical: 3 };
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

interface Job {
  id: string; event: AlertEvent; occurrences: number; attempts: number; notBefore: number; createdAt: number;
  resolve: (r: { state: DeliveryState; attempts: number; messageId?: string; reason?: string }) => void;
}
interface DedupeEntry { lastSentAt: number; suppressed: number }

@Injectable()
export class ErrorEmailService implements OnModuleDestroy {
  private readonly transport: nodemailer.Transporter | null;
  private readonly recipients: string[];
  private readonly from: string;
  private readonly environment: string;
  private readonly enabled: boolean;
  private readonly cooldownMs: number;
  private readonly maxPerHour: number;
  private readonly queueMax: number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly minSeverity: number;

  private readonly queue: Job[] = [];
  private readonly dedupe = new Map<string, DedupeEntry>();
  private readonly sentTimes: number[] = [];
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private closed = false;
  private lastDisabledLog = 0;
  private lastSmtpAcceptedAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastFailureReason: string | null = null;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() @Inject(ALERT_TRANSPORT) injectedTransport?: nodemailer.Transporter,
  ) {
    const num = (k: string, d: number) => { const v = Number(config.get(k)); return Number.isFinite(v) && v > 0 ? v : d; };
    this.environment = config.get<string>('NODE_ENV') ?? 'development';
    this.cooldownMs = num('ALERT_COOLDOWN_SECONDS', 300) * 1000;
    this.maxPerHour = num('ALERT_MAX_PER_HOUR', 30);
    this.queueMax = num('ALERT_QUEUE_MAX', 50);
    this.maxAttempts = Math.min(num('ALERT_MAX_ATTEMPTS', 3), 6);
    this.retryBaseMs = num('ALERT_RETRY_BASE_MS', 2000);
    this.minSeverity = SEVERITY_RANK[(config.get<string>('ALERT_MIN_SEVERITY') as AlertSeverity) in SEVERITY_RANK ? (config.get<string>('ALERT_MIN_SEVERITY') as AlertSeverity) : 'error'];

    const rawRecipients = (config.get<string>('ALERT_EMAIL_TO') ?? config.get<string>('ALERT_EMAIL') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    this.recipients = rawRecipients.filter((r) => EMAIL_RE.test(r));
    if (this.recipients.length !== rawRecipients.length) logEvent('warn', 'alert.config_invalid_recipient', { dropped: rawRecipients.length - this.recipients.length });
    this.from = config.get<string>('ALERT_EMAIL_FROM') ?? config.get<string>('EMAIL_FROM') ?? (EMAIL_RE.test(config.get<string>('SMTP_USER') ?? '') ? config.get<string>('SMTP_USER')! : 'dentalease-alerts@localhost');

    this.transport = injectedTransport ?? this.buildTransport();
    const flag = String(config.get('ALERT_ENABLED') ?? 'true').toLowerCase();
    this.enabled = flag !== 'false' && flag !== '0' && !!this.transport && this.recipients.length > 0;
    logEvent(this.enabled ? 'info' : 'warn', this.enabled ? 'alert.ready' : 'alert.disabled', {
      reason: this.enabled ? undefined : !this.transport ? 'no SMTP transport configured (SMTP_HOST/SMTP_PORT or legacy GMAIL_*)' : !this.recipients.length ? 'no valid ALERT_EMAIL_TO recipient configured' : 'ALERT_ENABLED=false',
      recipients: this.recipients.length, cooldownSeconds: this.cooldownMs / 1000,
    });
    this.metrics?.setGauge('alerts_enabled', this.enabled ? 1 : 0);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  get isEnabled(): boolean { return this.enabled; }

  /** Enqueue an alert. Synchronous, never throws, never blocks on SMTP. */
  report(event: AlertEvent): AlertTicket {
    try {
      const kind = event.kind ?? 'error';
      this.metrics?.inc('alerts_requested_total', { severity: event.severity });
      if (!this.enabled || this.closed) {
        this.metrics?.inc('alerts_disabled_total');
        if (Date.now() - this.lastDisabledLog > 60_000) { this.lastDisabledLog = Date.now(); logEvent('warn', 'alert.not_sent', { reason: 'alerting disabled or not configured', code: event.code }); }
        return { outcome: 'disabled', reason: 'alerting is not configured' };
      }
      if (kind !== 'test' && SEVERITY_RANK[event.severity] < this.minSeverity) return { outcome: 'suppressed', reason: 'below ALERT_MIN_SEVERITY' };

      const now = Date.now();
      let occurrences = 1;
      if (kind === 'error') {
        // Infrastructure incidents (database, cache, upstream) are ONE incident regardless of which route noticed first;
        // application errors are per route + exception type.
        const infra = event.subsystem === 'database' || event.subsystem === 'cache' || event.subsystem === 'upstream';
        const fp = infra ? `${event.code}|${event.subsystem}` : `${event.code}|${event.subsystem}|${event.route ?? ''}|${event.discriminator ?? ''}`;
        const entry = this.dedupe.get(fp);
        if (entry && now - entry.lastSentAt < this.cooldownMs) {
          entry.suppressed++;
          this.metrics?.inc('alerts_suppressed_total', { reason: 'duplicate' });
          return { outcome: 'suppressed', reason: 'duplicate within cooldown' };
        }
        occurrences = (entry?.suppressed ?? 0) + 1;
        this.sweepDedupe(now);
        this.dedupe.set(fp, { lastSentAt: now, suppressed: 0 });

        while (this.sentTimes.length && now - this.sentTimes[0] > 3_600_000) this.sentTimes.shift();
        if (this.sentTimes.length >= this.maxPerHour) {
          const e = this.dedupe.get(fp)!; e.suppressed += occurrences; e.lastSentAt = 0;      // keep the count; allow the next window to report it
          this.metrics?.inc('alerts_suppressed_total', { reason: 'hourly_cap' });
          return { outcome: 'suppressed', reason: 'hourly alert cap reached' };
        }
      }
      if (this.queue.length >= this.queueMax) {
        this.metrics?.inc('alerts_dropped_total', { reason: 'queue_full' });
        logEvent('warn', 'alert.dropped', { reason: 'queue full', code: event.code, queueMax: this.queueMax });
        return { outcome: 'dropped', reason: 'alert queue is full' };
      }
      this.sentTimes.push(now);

      const id = randomUUID();
      let resolve!: Job['resolve'];
      const result = new Promise<Awaited<NonNullable<AlertTicket['result']>>>((r) => { resolve = r; });
      this.queue.push({ id, event: { ...event, requestId: event.requestId ?? getRequestId() }, occurrences, attempts: 0, notBefore: now, createdAt: now, resolve });
      this.metrics?.inc('alerts_queued_total', { severity: event.severity });
      logEvent('info', 'alert.queued', { alertId: id, code: event.code, subsystem: event.subsystem, severity: event.severity, occurrences, remark: 'queued only; SMTP delivery not yet attempted' });
      this.metrics?.setGauge('alerts_queue_depth', this.queue.length);
      this.schedule(0);
      return { id, outcome: 'queued', result };
    } catch (err) {
      logEvent('error', 'alert.report_failed', { error: summariseError(err) });   // never recurse into report()
      return { outcome: 'dropped', reason: 'internal alert error' };
    }
  }

  /**
   * Back-compat entry used by older call sites (client-error endpoint). Converts to a sanitised AlertEvent; the raw
   * error/stack/request details passed in are NOT forwarded to the e-mail.
   */
  async sendAlert(opts: {
    subject: string; error: Error | string | { message: string; stack?: string; name?: string };
    context?: string; request?: { method?: string; url?: string; ip?: string; userId?: string; clinicId?: string }; extra?: Record<string, unknown>;
  }): Promise<AlertTicket> {
    const msg = typeof opts.error === 'string' ? opts.error : (opts.error as { message?: string }).message ?? String(opts.error);
    return this.report({
      severity: 'error', code: 'LEGACY_ALERT', subsystem: opts.context ?? 'app', summary: `${opts.subject}: ${msg}`,
      route: opts.request?.url ? templatePath(opts.request.url) : undefined, clinicId: opts.request?.clinicId,
      discriminator: sanitizeText(opts.subject, 80),
    });
  }

  /** Operational view for the protected status endpoint. Never contains addresses, credentials or message bodies. */
  getStatus() {
    return {
      enabled: this.enabled, transport: this.transport ? 'smtp' : 'none', recipientsConfigured: this.recipients.length,
      environment: this.environment, queueDepth: this.queue.length, cooldownSeconds: this.cooldownMs / 1000,
      maxPerHour: this.maxPerHour, lastSmtpAcceptedAt: this.lastSmtpAcceptedAt ? new Date(this.lastSmtpAcceptedAt).toISOString() : null,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null, lastFailureReason: this.lastFailureReason,
      note: 'smtp_accepted means the SMTP server accepted the message; it does not prove inbox delivery.',
    };
  }

  /** Verify the SMTP connection/auth without sending anything. */
  async verifyConnection(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.transport) return { ok: false, reason: 'no transport configured' };
    try { await this.transport.verify(); return { ok: true }; } catch (err) { return { ok: false, reason: sanitizeText(summariseError(err).message, 160) }; }
  }

  onModuleDestroy() { this.closed = true; if (this.timer) clearTimeout(this.timer); this.timer = null; this.transport?.close?.(); }

  /** Best-effort drain used by the process crash handler (bounded). */
  async flush(timeoutMs = 3000): Promise<void> {
    const end = Date.now() + timeoutMs;
    while ((this.queue.length || this.inFlight) && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  }

  // ── Queue worker ─────────────────────────────────────────────────────────────

  private schedule(delayMs: number) {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.pump(); }, Math.max(0, delayMs));
    this.timer.unref?.();
  }

  private async pump(): Promise<void> {
    if (this.inFlight || this.closed) return;
    const now = Date.now();
    const job = this.queue.find((j) => j.notBefore <= now);
    if (!job) {
      const next = this.queue.reduce((m, j) => Math.min(m, j.notBefore), Infinity);
      if (Number.isFinite(next)) this.schedule(next - now);
      return;
    }
    this.inFlight = true;
    job.attempts++;
    try {
      const msg = buildAlertEmail(job.event, { environment: this.environment, occurrences: job.occurrences, alertId: job.id });
      const info = await this.transport!.sendMail({ from: this.from, to: this.recipients, subject: msg.subject, text: msg.text, html: msg.html });
      const accepted = (info?.accepted as unknown[] | undefined)?.length ?? 0;
      if (!accepted && (info?.rejected as unknown[] | undefined)?.length) throw Object.assign(new Error('all recipients rejected by SMTP server'), { code: 'EREJECTED' });
      this.finish(job, 'smtp_accepted', { messageId: typeof info?.messageId === 'string' ? info.messageId : undefined });
    } catch (err) {
      const reason = sanitizeText(summariseError(err).message, 160);
      this.lastFailureAt = Date.now(); this.lastFailureReason = reason;
      this.metrics?.inc('alerts_delivery_failures_total');
      if (job.attempts < this.maxAttempts && !this.closed) {
        job.notBefore = Date.now() + Math.round(Math.random() * Math.min(60_000, this.retryBaseMs * 2 ** (job.attempts - 1)) + this.retryBaseMs / 2);
        logEvent('warn', 'alert.delivery_retry', { alertId: job.id, attempt: job.attempts, maxAttempts: this.maxAttempts, reason });
      } else {
        this.finish(job, 'failed', { reason });
      }
    } finally {
      this.inFlight = false;
      this.metrics?.setGauge('alerts_queue_depth', this.queue.length);
      if (this.queue.length) this.schedule(0);
    }
  }

  private finish(job: Job, state: DeliveryState, extra: { messageId?: string; reason?: string }) {
    const i = this.queue.indexOf(job); if (i >= 0) this.queue.splice(i, 1);
    if (state === 'smtp_accepted') {
      this.lastSmtpAcceptedAt = Date.now();
      this.metrics?.inc('alerts_smtp_accepted_total');
      logEvent('info', 'alert.smtp_accepted', { alertId: job.id, code: job.event.code, attempts: job.attempts, messageId: extra.messageId, remark: 'SMTP server accepted the message; inbox delivery is not confirmed' });
    } else {
      logEvent('error', 'alert.delivery_failed', { alertId: job.id, code: job.event.code, attempts: job.attempts, reason: extra.reason, remark: 'giving up; no further alerts are generated for this failure' });
    }
    job.resolve({ state, attempts: job.attempts, ...extra });
  }

  private sweepDedupe(now: number) {
    if (this.dedupe.size < 500) return;
    for (const [k, v] of this.dedupe) if (now - v.lastSentAt > this.cooldownMs * 4) this.dedupe.delete(k);
    while (this.dedupe.size >= 1000) this.dedupe.delete(this.dedupe.keys().next().value as string);
  }

  private buildTransport(): nodemailer.Transporter | null {
    const t = Number(this.config.get('ALERT_SMTP_TIMEOUT_MS')) || 15000;
    const timeouts = { connectionTimeout: t, greetingTimeout: t, socketTimeout: t };
    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get('SMTP_PORT'));
    if (!host || !port) {
      // Legacy fallback, used ONLY when no explicit SMTP_HOST/SMTP_PORT is configured: an explicit SMTP target must never be
      // overridden by stored Gmail credentials (that would send test/staging alerts through a personal mailbox).
      const gmailUser = this.config.get<string>('GMAIL_USER');
      const gmailPass = this.config.get<string>('GMAIL_APP_PASSWORD');
      if (gmailUser && gmailPass && !gmailPass.startsWith('your_')) {
        return nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: gmailUser, pass: gmailPass }, ...timeouts });
      }
      return null;
    }
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const secureFlag = this.config.get<string>('SMTP_SECURE');
    return nodemailer.createTransport({
      host, port, secure: secureFlag !== undefined ? secureFlag === 'true' : port === 465,
      ...(user && pass ? { auth: { user, pass } } : {}), ...timeouts,
    });
  }
}

// ── Message construction (pure; exported for tests) ──────────────────────────────

export function buildAlertEmail(event: AlertEvent, ctx: { environment: string; occurrences: number; alertId: string; now?: Date }) {
  const clean = (s: string | undefined, max = 120) => sanitizeText(s ?? '', max);
  const severity = event.severity.toUpperCase();
  const tag = event.kind === 'test' ? 'TEST ' : event.kind === 'recovery' ? 'RECOVERED ' : '';
  const subject = `[DentalEase ${ctx.environment.toUpperCase()}][${tag}${severity}] ${clean(event.code, 60)} - ${clean(event.subsystem, 40)}`.replace(/[\r\n]+/g, ' ');
  const rows: Array<[string, string]> = [
    ['Time (UTC)', (ctx.now ?? new Date()).toISOString()],
    ['Environment', clean(ctx.environment, 40)],
    ['Service', SERVICE_NAME],
    ['Severity', severity + (event.kind && event.kind !== 'error' ? ` (${event.kind})` : '')],
    ['Error code', clean(event.code, 60)],
    ['Subsystem', clean(event.subsystem, 40)],
    ['Request / trace id', clean(event.requestId, 64) || '–'],
    ['Route', clean(templatePath(event.route), 120) || '–'],
    ['Clinic', event.clinicId ? clean(event.clinicId, 8) + '…' : '–'],
    ['Occurrences since last alert', String(ctx.occurrences)],
    ['Alert id', ctx.alertId],
    ['Summary', clean(event.summary, 300)],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    '\n\nThis alert contains no request bodies, credentials or patient data. Find the matching log line with the request id: event "http.error" / "alert.queued".\nRunbook: docs/runbooks/INCIDENT_RESPONSE.md\n';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const html = `<h2 style="font-family:sans-serif">DentalEase alert - ${esc(severity)}</h2><table style="border-collapse:collapse;font-family:monospace;font-size:13px">` +
    rows.map(([k, v]) => `<tr><td style="padding:4px 8px;font-weight:bold;background:#f5f5f5">${esc(k)}</td><td style="padding:4px 8px">${esc(v)}</td></tr>`).join('') +
    `</table><p style="font-family:sans-serif;color:#666;font-size:12px">No request bodies, credentials or patient data are included. Runbook: docs/runbooks/INCIDENT_RESPONSE.md</p>`;
  return { subject, text, html };
}
