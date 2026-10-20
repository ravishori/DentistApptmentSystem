import * as fs from 'fs';
import * as path from 'path';
import { ErrorEmailService, buildAlertEmail, AlertEvent } from './error-email.service';
import { MetricsService } from '../observability/metrics.service';
import { setLogSink } from '../observability/structured-logger';
import { SmtpSink } from '../observability/testing/smtp-sink';

const ev = (over: Partial<AlertEvent> = {}): AlertEvent => ({ severity: 'error', code: 'INTERNAL_ERROR', subsystem: 'internal', summary: 'GET /api/v1/patients -> 500', route: '/api/v1/patients', requestId: 'req-12345678', ...over });
const cfg = (over: Record<string, string> = {}) => ({ get: (k: string) => ({ NODE_ENV: 'production', ALERT_EMAIL_TO: 'ops@example.com', ALERT_EMAIL_FROM: 'alerts@example.com', ALERT_RETRY_BASE_MS: '5', ...over })[k] }) as any;
const okInfo = { accepted: ['ops@example.com'], rejected: [], messageId: '<id@test>' };
const stub = () => ({ sendMail: jest.fn(async (_m: any) => okInfo), close: jest.fn(), verify: jest.fn(async () => true) });

let logs: any[]; let restore: () => void;
beforeEach(() => { logs = []; restore = setLogSink((l) => logs.push(JSON.parse(l))); });
afterEach(() => restore());
const events = () => logs.map((l) => l.event);
const make = (over: Record<string, string> = {}, t: any = stub()) => { const metrics = new MetricsService(); return { svc: new ErrorEmailService(cfg(over), metrics, t), t, metrics }; };

describe('configuration', () => {
  it('has NO hard-coded recipient or personal address anywhere in the service source', () => {
    const src = fs.readFileSync(path.join(__dirname, 'error-email.service.ts'), 'utf8');
    expect(src).not.toMatch(/ravishori|@gmail\.com['"]/i);
  });
  it('stays disabled (and says why) without recipients or without a transport; never throws', () => {
    const noRcpt = make({ ALERT_EMAIL_TO: '' });
    expect(noRcpt.svc.isEnabled).toBe(false);
    expect(noRcpt.svc.report(ev())).toMatchObject({ outcome: 'disabled' });
    expect(noRcpt.t.sendMail).not.toHaveBeenCalled();
    const noTransport = new ErrorEmailService(cfg(), new MetricsService());
    expect(noTransport.isEnabled).toBe(false);
    expect(events()).toContain('alert.disabled');
    expect(JSON.stringify(logs)).not.toContain('example.com');
  });
  it('reads a comma list, drops invalid addresses, accepts the legacy ALERT_EMAIL name', async () => {
    const a = make({ ALERT_EMAIL_TO: 'a@example.com, not-an-address, b@example.com' });
    await a.svc.report(ev()).result;
    expect(a.t.sendMail.mock.calls[0][0].to).toEqual(['a@example.com', 'b@example.com']);
    expect(events()).toContain('alert.config_invalid_recipient');
    const legacy = make({ ALERT_EMAIL_TO: undefined as any, ALERT_EMAIL: 'legacy@example.com' });
    await legacy.svc.report(ev()).result;
    expect(legacy.t.sendMail.mock.calls[0][0].to).toEqual(['legacy@example.com']);
  });
  it('an explicit SMTP target is never overridden by stored legacy Gmail credentials', async () => {
    const created: any[] = [];
    const nm = require('nodemailer'); const spy = jest.spyOn(nm, 'createTransport').mockImplementation(((o: any) => { created.push(o); return { sendMail: jest.fn(), close: jest.fn(), verify: jest.fn() }; }) as any);
    new ErrorEmailService(cfg({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', GMAIL_USER: 'x@example.com', GMAIL_APP_PASSWORD: 'app-pass-1234' }), new MetricsService());
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ host: '127.0.0.1', port: 2525 });
    expect(JSON.stringify(created[0])).not.toMatch(/gmail|app-pass/);
    created.length = 0;
    new ErrorEmailService(cfg({ GMAIL_USER: 'x@example.com', GMAIL_APP_PASSWORD: 'app-pass-1234' }), new MetricsService());
    expect(created[0]).toMatchObject({ host: 'smtp.gmail.com' });          // legacy fallback only when nothing explicit is set
    spy.mockRestore();
  });
  it('can be switched off', () => { expect(make({ ALERT_ENABLED: 'false' }).svc.isEnabled).toBe(false); });
  it('builds an SMTP transport from SMTP_* (and the legacy GMAIL_* pair) without connecting', () => {
    expect(new ErrorEmailService(cfg({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525' }), new MetricsService()).getStatus()).toMatchObject({ enabled: true, transport: 'smtp' });
    expect(new ErrorEmailService(cfg({ GMAIL_USER: 'x@example.com', GMAIL_APP_PASSWORD: 'app-pass-1234' }), new MetricsService()).getStatus().transport).toBe('smtp');
    expect(new ErrorEmailService(cfg({ GMAIL_USER: 'x@example.com', GMAIL_APP_PASSWORD: 'your_app_password' }), new MetricsService()).getStatus().transport).toBe('none');
  });
});

describe('non-blocking, bounded and honest delivery states', () => {
  it('report() is synchronous and returns immediately even when SMTP hangs forever', () => {
    const hang = { sendMail: jest.fn(() => new Promise(() => undefined)), close: jest.fn() };
    const { svc } = make({}, hang);
    const t0 = Date.now();
    const ticket = svc.report(ev());
    expect(ticket).not.toBeInstanceOf(Promise);
    expect(ticket.outcome).toBe('queued');
    expect(Date.now() - t0).toBeLessThan(50);
  });
  it('distinguishes queued (logged attempt) from smtp_accepted (server accepted) in logs, metrics and status', async () => {
    const { svc, t, metrics } = make();
    const ticket = svc.report(ev());
    expect(events()).toContain('alert.queued');
    expect(events()).not.toContain('alert.smtp_accepted');          // queued is not delivered
    expect(svc.getStatus().lastSmtpAcceptedAt).toBeNull();
    const r = await ticket.result;
    expect(r).toMatchObject({ state: 'smtp_accepted', attempts: 1, messageId: '<id@test>' });
    expect(events()).toContain('alert.smtp_accepted');
    expect(JSON.stringify(logs.find((l) => l.event === 'alert.smtp_accepted'))).toMatch(/inbox delivery is not confirmed/);
    expect(metrics.getCounter('alerts_queued_total', { severity: 'error' })).toBe(1);
    expect(metrics.getCounter('alerts_smtp_accepted_total')).toBe(1);
    expect(svc.getStatus().lastSmtpAcceptedAt).not.toBeNull();
    expect(t.sendMail).toHaveBeenCalledTimes(1);
  });
  it('queue is bounded: overflow is dropped, counted and logged, never grows unbounded', () => {
    const hang = { sendMail: jest.fn(() => new Promise(() => undefined)), close: jest.fn() };
    const { svc, metrics } = make({ ALERT_QUEUE_MAX: '2' }, hang);
    const out = [1, 2, 3, 4].map((i) => svc.report(ev({ code: `C${i}` })).outcome);
    expect(out).toEqual(['queued', 'queued', 'dropped', 'dropped']);
    expect(metrics.getCounter('alerts_dropped_total', { reason: 'queue_full' })).toBe(2);
    expect(svc.getStatus().queueDepth).toBe(2);
  });
  it('never throws on garbage input', () => {
    const { svc } = make();
    for (const bad of [null, undefined, {}, { severity: 'error' }, { summary: { toString() { throw new Error('x'); } } }, 'str', 42]) expect(() => svc.report(bad as any)).not.toThrow();
  });
});

describe('de-duplication, aggregation and caps', () => {
  it('sends the first occurrence, suppresses identical ones inside the cooldown, then reports how many were suppressed', async () => {
    const { svc, t, metrics } = make({ ALERT_COOLDOWN_SECONDS: '60' });
    const now = jest.spyOn(Date, 'now');
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    const first = svc.report(ev());
    expect(first.outcome).toBe('queued');
    await first.result;
    now.mockReturnValue(t0 + 1000);
    expect([svc.report(ev()).outcome, svc.report(ev()).outcome]).toEqual(['suppressed', 'suppressed']);
    expect(metrics.getCounter('alerts_suppressed_total', { reason: 'duplicate' })).toBe(2);
    now.mockReturnValue(t0 + 61_000);
    const again = svc.report(ev());
    expect(again.outcome).toBe('queued');
    await again.result;
    now.mockRestore();
    expect(t.sendMail).toHaveBeenCalledTimes(2);
    expect(t.sendMail.mock.calls[1][0].text).toContain('Occurrences since last alert: 3');
  });
  it('different code, route or discriminator are different incidents', async () => {
    const { svc } = make();
    const outcomes = [ev(), ev({ code: 'DB_UNAVAILABLE' }), ev({ route: '/api/v1/billing' }), ev({ discriminator: 'TypeError' })].map((e) => svc.report(e).outcome);
    expect(outcomes).toEqual(['queued', 'queued', 'queued', 'queued']);
  });
  it('a global hourly cap stops an alert storm; suppressed counts are kept for later', () => {
    const { svc, metrics } = make({ ALERT_MAX_PER_HOUR: '3' });
    const out = Array.from({ length: 6 }, (_, i) => svc.report(ev({ code: `E${i}` })).outcome);
    expect(out).toEqual(['queued', 'queued', 'queued', 'suppressed', 'suppressed', 'suppressed']);
    expect(metrics.getCounter('alerts_suppressed_total', { reason: 'hourly_cap' })).toBe(3);
  });
  it('min severity filters warnings; test and recovery notices are never deduplicated away', async () => {
    const { svc, t } = make();
    expect(svc.report(ev({ severity: 'warning' })).outcome).toBe('suppressed');
    const a = svc.report(ev({ kind: 'test', severity: 'warning', code: 'TEST_ALERT' })); const b = svc.report(ev({ kind: 'test', severity: 'warning', code: 'TEST_ALERT' }));
    const c = svc.report(ev({ kind: 'recovery', code: 'DB_UNAVAILABLE_RECOVERED' }));
    expect([a.outcome, b.outcome, c.outcome]).toEqual(['queued', 'queued', 'queued']);
    await Promise.all([a.result, b.result, c.result]);
    expect(t.sendMail.mock.calls.map((m: any) => m[0].subject).join('|')).toMatch(/TEST.*\|.*TEST.*\|.*RECOVERED/);
  });
  it('the de-duplication table is bounded', () => {
    const { svc } = make({ ALERT_MAX_PER_HOUR: '100000', ALERT_QUEUE_MAX: '100000' }, { sendMail: () => new Promise(() => undefined), close: jest.fn() });
    for (let i = 0; i < 2500; i++) svc.report(ev({ code: `E${i}` }));
    expect((svc as any).dedupe.size).toBeLessThan(1200);
  });
});

describe('retry with backoff, and no recursive alerts', () => {
  it('retries transient failures with backoff and succeeds', async () => {
    const t = stub();
    t.sendMail.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:25')).mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(okInfo);
    const { svc, metrics } = make({}, t);
    const r = await svc.report(ev()).result!;
    expect(r).toMatchObject({ state: 'smtp_accepted', attempts: 3 });
    expect(t.sendMail).toHaveBeenCalledTimes(3);
    expect(events().filter((e) => e === 'alert.delivery_retry')).toHaveLength(2);
    expect(metrics.getCounter('alerts_delivery_failures_total')).toBe(2);
  });
  it('gives up after ALERT_MAX_ATTEMPTS, reports the failure, and does not alert about its own failure', async () => {
    const t = stub();
    t.sendMail.mockRejectedValue(new Error('535 5.7.8 auth failed for ops@example.com password=hunter2hunter2hunter2hunter2'));
    const { svc } = make({ ALERT_MAX_ATTEMPTS: '3' }, t);
    const reportSpy = jest.spyOn(svc, 'report');
    const r = await svc.report(ev()).result!;
    expect(r.state).toBe('failed');
    expect(t.sendMail).toHaveBeenCalledTimes(3);
    expect(reportSpy).toHaveBeenCalledTimes(1);                         // only the original call: no recursion
    expect(events()).toContain('alert.delivery_failed');
    expect(svc.getStatus().queueDepth).toBe(0);
    expect(svc.getStatus().lastFailureReason).not.toMatch(/hunter2|ops@example/);
    expect(JSON.stringify(logs)).not.toMatch(/hunter2/);
    await new Promise((r2) => setTimeout(r2, 60));
    expect(t.sendMail).toHaveBeenCalledTimes(3);                        // and no infinite retry afterwards
  });
  it('treats "all recipients rejected" as a failure, not a success', async () => {
    const t = stub(); t.sendMail.mockResolvedValue({ accepted: [], rejected: ['ops@example.com'], messageId: 'x' } as any);
    const r = await make({ ALERT_MAX_ATTEMPTS: '1' }, t).svc.report(ev()).result!;
    expect(r.state).toBe('failed');
  });
  it('one failing alert does not block the next one in the queue', async () => {
    const t = stub();
    t.sendMail.mockImplementation(async (m: any) => { if (/A_BROKEN/.test(m.subject)) throw new Error('rejected'); return okInfo; });
    const { svc } = make({ ALERT_MAX_ATTEMPTS: '2' }, t);
    const a = svc.report(ev({ code: 'A_BROKEN', subsystem: 'a_broken' })); const b = svc.report(ev({ code: 'B_FINE', subsystem: 'b_fine' }));
    const [ra, rb] = await Promise.all([a.result!, b.result!]);
    expect([ra.state, rb.state]).toEqual(['failed', 'smtp_accepted']);
  });
  it('after shutdown nothing more is sent', async () => {
    const { svc, t } = make();
    svc.onModuleDestroy();
    expect(svc.report(ev()).outcome).toBe('disabled');
    expect(t.close).toHaveBeenCalled();
    await svc.flush(50);
  });
});

describe('message contents are sanitised', () => {
  const secrets = ['password=hunter2hunter2', 'Bearer abcdef1234567890zz', 'postgresql://u:SuperSecretPw@db/x', 'asha.rao@example.com', '+919876543210', 'rzp_live_AbCdEf123456'];
  it('contains the operational fields and no stack, body, IP, user or secrets', async () => {
    const { svc, t } = make({ NODE_ENV: 'production' });
    await svc.report(ev({ severity: 'critical', code: 'DB_UNAVAILABLE', subsystem: 'database', clinicId: 'abcdef12-aaaa-bbbb-cccc-ddddeeeeffff', summary: `GET /x -> 503 ${secrets.join(' ')} \r\nBcc: evil@evil.test` })).result;
    const m = t.sendMail.mock.calls[0][0];
    for (const s of secrets) { expect(m.text).not.toContain(s); expect(m.html).not.toContain(s); expect(m.subject).not.toContain(s); }
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toBe('[DentalEase PRODUCTION][CRITICAL] DB_UNAVAILABLE - database');
    for (const field of ['Time (UTC):', 'Environment: production', 'Service: dentalease-api', 'Severity: CRITICAL', 'Error code: DB_UNAVAILABLE', 'Subsystem: database', 'Request / trace id: req-12345678', 'Route: /api/v1/patients', 'Occurrences since last alert: 1']) expect(m.text).toContain(field);
    expect(m.text).toContain('Clinic: abcdef12…');
    expect(m.text).not.toContain('ddddeeeeffff');
    expect(m.text).not.toMatch(/at .*\(.*:\d+:\d+\)|stack trace/i);
  });
  it('html-escapes everything', () => {
    const msg = buildAlertEmail(ev({ summary: '<script>alert(1)</script>', code: '"><img src=x>' }), { environment: 'test', occurrences: 1, alertId: 'a' });
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).not.toContain('<img');
    expect(msg.html).toContain('&lt;script&gt;');
  });
  it('legacy sendAlert() forwards only a sanitised summary, never the stack, IP, user id or extra data', async () => {
    const { svc, t } = make();
    const ticket = await svc.sendAlert({ subject: '500 POST /patients', error: { message: 'boom asha@example.com', stack: 'Error: boom\n    at secretFn (C:\\Users\\dev\\x.ts:1:1)', name: 'ClientError' } as any, request: { method: 'POST', url: '/patients/3f2a4b10-1111-4222-8333-444455556666?token=abc', ip: '203.0.113.9', userId: 'user-7' }, extra: { componentStack: 'ssn 123' } });
    await ticket.result;
    const m = t.sendMail.mock.calls[0][0];
    for (const leak of ['asha@example.com', 'secretFn', 'C:\\Users', '203.0.113.9', 'user-7', 'ssn 123', 'token=abc']) expect(m.text + m.html).not.toContain(leak);
    expect(m.text).toContain('/patients/:id');
  });
  it('status output has counts and timestamps only: no addresses, hosts or credentials', () => {
    const s = JSON.stringify(make({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'user@example.com', SMTP_PASS: 'pw-1234567890' }).svc.getStatus());
    expect(s).not.toMatch(/ops@example|smtp\.example|user@example|pw-1234567890/);
    expect(JSON.parse(s)).toMatchObject({ enabled: true, recipientsConfigured: 1 });
  });
  it('verifyConnection reports ok/failed without throwing', async () => {
    const t = stub();
    expect(await make({}, t).svc.verifyConnection()).toEqual({ ok: true });
    t.verify.mockRejectedValue(new Error('ECONNREFUSED postgresql://u:pw@h/d'));
    const bad = await make({}, t).svc.verifyConnection();
    expect(bad.ok).toBe(false); expect(bad.reason).not.toContain('pw@h');
  });
});

describe('real SMTP wire protocol (local test sink; nodemailer is NOT mocked)', () => {
  const sink = new SmtpSink();
  beforeAll(async () => { await sink.start(); });
  afterAll(async () => { await sink.stop(); });
  beforeEach(() => { sink.mode = 'accept'; sink.failNext = 0; sink.clear(); });
  const real = (over: Record<string, string> = {}) => { const m = new MetricsService(); return { svc: new ErrorEmailService(cfg({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.port), ALERT_SMTP_TIMEOUT_MS: '400', ...over }), m), metrics: m }; };

  it('delivers over SMTP to the sink: smtp_accepted, correct envelope and subject, body sanitised', async () => {
    const { svc } = real();
    const r = await svc.report(ev({ summary: 'GET /x -> 500 asha@example.com' })).result!;
    expect(r.state).toBe('smtp_accepted');
    expect(sink.messages).toHaveLength(1);
    expect(sink.messages[0].to).toEqual(['ops@example.com']);
    expect(sink.messages[0].from).toBe('alerts@example.com');
    expect(sink.messages[0].subject).toContain('[DentalEase PRODUCTION][ERROR] INTERNAL_ERROR');
    expect(sink.messages[0].raw).not.toContain('asha@example.com');
    expect(await svc.verifyConnection()).toEqual({ ok: true });
    svc.onModuleDestroy();
  });
  it('a transient 451 from the server is retried and then accepted', async () => {
    sink.failNext = 1;
    const { svc } = real();
    const r = await svc.report(ev()).result!;
    expect(r).toMatchObject({ state: 'smtp_accepted', attempts: 2 });
    expect(sink.messages).toHaveLength(1);
    svc.onModuleDestroy();
  });
  it('permanent recipient rejection (550) ends as failed after the attempt limit, with no recursion', async () => {
    sink.mode = 'reject-rcpt';
    const { svc } = real({ ALERT_MAX_ATTEMPTS: '2' });
    const r = await svc.report(ev()).result!;
    expect(r.state).toBe('failed'); expect(r.attempts).toBe(2);
    expect(sink.messages).toHaveLength(0);
    svc.onModuleDestroy();
  });
  it('connection dropped by the server → failed, request path unaffected', async () => {
    sink.mode = 'drop';
    const { svc } = real({ ALERT_MAX_ATTEMPTS: '2' });
    expect((await svc.report(ev()).result!).state).toBe('failed');
    svc.onModuleDestroy();
  });
  it('server that never answers → bounded by the SMTP timeout, then failed', async () => {
    sink.mode = 'hang';
    const { svc } = real({ ALERT_MAX_ATTEMPTS: '1' });
    const t0 = Date.now();
    expect((await svc.report(ev()).result!).state).toBe('failed');
    expect(Date.now() - t0).toBeLessThan(5000);
    svc.onModuleDestroy();
  }, 15000);
  it('nothing listening on the port (SMTP server down) → failed', async () => {
    const { svc } = real({ SMTP_PORT: '1', ALERT_MAX_ATTEMPTS: '1' });
    expect((await svc.report(ev()).result!).state).toBe('failed');
    expect(svc.getStatus().lastFailureReason).toBeTruthy();
    svc.onModuleDestroy();
  });
});
