import { logEvent, setLogSink, StructuredLogger } from './structured-logger';
import { runWithRequestContext, setContextActor } from './context-store';
import { resolveRequestId, resolveTraceId } from './request-context';
import { MetricsService } from './metrics.service';
import { backoffDelay, retryBounded, withTimeout } from './retry';
import { installProcessHandlers } from './process-handlers';
import { EventEmitter } from 'events';

let lines: Array<{ line: string; level: string }>;
let restore: () => void;
beforeEach(() => { lines = []; restore = setLogSink((line, level) => lines.push({ line, level })); });
afterEach(() => { restore(); delete process.env.LOG_LEVEL; delete process.env.LOG_FORMAT; });
const last = () => JSON.parse(lines[lines.length - 1].line);

describe('structured logging', () => {
  it('emits one JSON line with the standard envelope', () => {
    logEvent('info', 'patients.created', { durationMs: 12 });
    expect(lines).toHaveLength(1);
    const r = last();
    expect(r).toMatchObject({ level: 'info', service: 'dentalease-api', event: 'patients.created', durationMs: 12 });
    expect(typeof r.timestamp).toBe('string');
    expect(new Date(r.timestamp).toISOString()).toBe(r.timestamp);
    expect(r.environment).toBeTruthy();
  });
  it('adds request/trace/user/clinic ids from the active request context, including across awaits', async () => {
    await runWithRequestContext({ requestId: 'req-abc12345', traceId: 'trace-1' }, async () => {
      setContextActor('user-1', 'clinic-1');
      await new Promise((r) => setTimeout(r, 5));
      logEvent('warn', 'x.y');
    });
    expect(last()).toMatchObject({ requestId: 'req-abc12345', traceId: 'trace-1', userId: 'user-1', clinicId: 'clinic-1' });
  });
  it('outside a request there are simply no ids', () => { logEvent('info', 'boot'); expect(last().requestId).toBeUndefined(); });
  it('redacts secrets and patient data in context', () => {
    logEvent('error', 'x', { password: 'p', fullName: 'Asha Rao', note: 'mail asha@example.com token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk', nested: { authorization: 'Bearer abc' } });
    const text = lines[0].line;
    for (const leak of ['Asha Rao', 'asha@example.com', 'eyJhbGci', 'Bearer abc', '"p"']) expect(text).not.toContain(leak);
    expect(last().password).toBe('[REDACTED]');
  });
  it('caller data cannot overwrite envelope fields', () => {
    logEvent('info', 'real.event', { event: 'spoofed', level: 'debug', requestId: 'spoof', service: 'other' });
    expect(last()).toMatchObject({ event: 'real.event', level: 'info', service: 'dentalease-api' });
    expect(last().ctx_event).toBe('spoofed');
  });
  it('honours LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'warn';
    logEvent('info', 'quiet'); logEvent('debug', 'quiet'); logEvent('warn', 'loud'); logEvent('error', 'loud');
    expect(lines.map((l) => JSON.parse(l.line).event)).toEqual(['loud', 'loud']);
  });
  it('writes warnings and errors to the error channel', () => { logEvent('error', 'e'); logEvent('info', 'i'); expect(lines.map((l) => l.level)).toEqual(['error', 'info']); });
  it('never throws, even for circular, bigint or throwing getters', () => {
    const circ: any = {}; circ.me = circ;
    const getter = { get boom() { throw new Error('nope'); } };
    expect(() => logEvent('info', 'x', { circ, big: 10n, getter })).not.toThrow();
    const failing = setLogSink(() => { throw new Error('disk full'); });
    expect(() => logEvent('info', 'x')).not.toThrow();
    failing();
  });
  it('pretty format is available for local development', () => {
    process.env.LOG_FORMAT = 'pretty'; logEvent('info', 'dev.event', { a: 1 });
    expect(lines[0].line).toMatch(/INFO\s+dev\.event a=1/);
  });
});

describe('StructuredLogger (NestJS LoggerService)', () => {
  it('maps log/warn/error/debug with context, scrubs messages, keeps stacks short', () => {
    const l = new StructuredLogger();
    l.log('Prisma connected to postgresql://u:pw@h/db', 'PrismaService');
    expect(last()).toMatchObject({ level: 'info', event: 'app.log', context: 'PrismaService' });
    expect(lines[0].line).not.toContain('pw@h');
    l.error('boom', 'Error: boom\n' + Array.from({ length: 30 }, (_, i) => `    at f${i} (/home/app/x.js:1:1)`).join('\n'), 'Ctx');
    const e = last();
    expect(e.level).toBe('error'); expect(e.context).toBe('Ctx'); expect(e.stack.split('\n').length).toBeLessThanOrEqual(9);
    l.warn('w'); expect(last().level).toBe('warn');
  });
});

describe('request ids', () => {
  it('accepts a safe caller-supplied id, rejects injection and oversize values', () => {
    expect(resolveRequestId('web-1a2b3c4d')).toBe('web-1a2b3c4d');
    for (const bad of ['short', 'x'.repeat(65), 'has space in it', 'evil\nheader: 1', '<script>alert(1)</script>', '../../etc/passwd', undefined, 42, ['a'.repeat(3)]]) {
      const id = resolveRequestId(bad as any);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
  it('parses a W3C traceparent, otherwise falls back to the request id', () => {
    expect(resolveTraceId('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', 'r')).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(resolveTraceId('garbage', 'req-1')).toBe('req-1');
    expect(resolveTraceId(undefined, 'req-2')).toBe('req-2');
  });
});

describe('MetricsService', () => {
  it('counts requests by class, server vs client errors, and latency per route', () => {
    const m = new MetricsService();
    m.recordHttp('GET', '/api/v1/patients', 200, 40); m.recordHttp('GET', '/api/v1/patients', 200, 300); m.recordHttp('POST', '/api/v1/patients', 409, 10); m.recordHttp('GET', '/api/v1/x', 503, 3000);
    expect(m.getCounter('http_requests_total', { method: 'GET', status_class: '2xx' })).toBe(2);
    expect(m.getCounter('http_server_errors_total')).toBe(1);
    expect(m.getCounter('http_client_errors_total', { status: 409 })).toBe(1);
    const snap = m.snapshot();
    expect(snap.latency['http_request_duration_ms{route="/api/v1/patients"}']).toEqual({ count: 3, avgMs: 117 });
  });
  it('gauges, counters with labels and Prometheus text', () => {
    const m = new MetricsService();
    m.inc('alerts_queued_total', { severity: 'critical' }); m.setGauge('db_up', 0); m.recordHttp('GET', '/r', 200, 30);
    const text = m.toPrometheus();
    expect(text).toContain('alerts_queued_total{severity="critical"} 1');
    expect(text).toContain('db_up 0');
    expect(text).toMatch(/http_request_duration_ms_bucket\{le="50",route="\/r"\} 1/);
    expect(text).toContain('http_request_duration_ms_count{route="/r"} 1');
  });
  it('bounds route cardinality', () => {
    const m = new MetricsService();
    for (let i = 0; i < 300; i++) m.recordHttp('GET', `/r${i}`, 200, 1);
    expect(Object.keys(m.snapshot().latency).length).toBeLessThanOrEqual(201);
  });
});

describe('retryBounded / withTimeout', () => {
  const noSleep = async () => undefined;
  it('retries retryable failures up to the attempt limit then rethrows the last error', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('transient'));
    await expect(retryBounded(fn, { attempts: 3, baseDelayMs: 1, isRetryable: () => true, sleep: noSleep })).rejects.toThrow('transient');
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('succeeds as soon as an attempt succeeds', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('ok');
    await expect(retryBounded(fn, { attempts: 5, baseDelayMs: 1, isRetryable: () => true, sleep: noSleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('does NOT retry unless the caller declares the error retryable (safe default for writes)', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('constraint'));
    await expect(retryBounded(fn, { attempts: 5, baseDelayMs: 1, sleep: noSleep })).rejects.toThrow('constraint');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('caps attempts at 10 and applies exponential, jittered, capped backoff', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('x'));
    await expect(retryBounded(fn, { attempts: 1000, baseDelayMs: 1, isRetryable: () => true, sleep: noSleep })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(10);
    expect(backoffDelay(1, 100, 30000, () => 1)).toBe(100);
    expect(backoffDelay(4, 100, 30000, () => 1)).toBe(800);
    expect(backoffDelay(20, 100, 30000, () => 1)).toBe(30000);
    expect(backoffDelay(3, 100, 30000, () => 0)).toBe(0);
  });
  it('reports each retry and withTimeout rejects slow work', async () => {
    const seen: number[] = [];
    await retryBounded(jest.fn().mockRejectedValueOnce(new Error('a')).mockResolvedValue(1), { attempts: 3, baseDelayMs: 1, isRetryable: () => true, sleep: noSleep, onRetry: (_e, n) => seen.push(n) });
    expect(seen).toEqual([1]);
    await expect(withTimeout(new Promise(() => undefined), 20, 'probe')).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
    // a late rejection after the timeout must not become an unhandledRejection
    const late: unknown[] = []; const h = (r: unknown) => late.push(r); process.on('unhandledRejection', h);
    await expect(withTimeout(new Promise((_, rej) => setTimeout(() => rej(new Error('late')), 40)), 10)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    await new Promise((r) => setTimeout(r, 80)); process.off('unhandledRejection', h);
    expect(late).toEqual([]);
  });
});

describe('process-level handlers', () => {
  it('unhandled rejection: logged, counted and alerted; process keeps running; secrets scrubbed', () => {
    const proc = new EventEmitter(); const exit = jest.fn();
    const alerts = { report: jest.fn(), flush: jest.fn(async () => undefined) }; const metrics = { inc: jest.fn() };
    const off = installProcessHandlers({ proc, exit, alerts: alerts as any, metrics: metrics as any });
    proc.emit('unhandledRejection', new Error('db url postgresql://u:pw@h/d failed'));
    expect(exit).not.toHaveBeenCalled();
    expect(metrics.inc).toHaveBeenCalledWith('unhandled_rejections_total');
    expect(alerts.report).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNHANDLED_REJECTION', severity: 'error' }));
    expect(JSON.stringify(alerts.report.mock.calls)).not.toContain('pw@h');
    expect(lines.map((l) => JSON.parse(l.line).event)).toContain('process.unhandled_rejection');
    expect(lines.map((l) => l.line).join('')).not.toContain('pw@h');
    off();
    expect(proc.listenerCount('unhandledRejection')).toBe(0);
  });
  it('uncaught exception: critical alert, bounded flush, then exit(1) exactly once', async () => {
    const proc = new EventEmitter(); const exit = jest.fn();
    const alerts = { report: jest.fn(), flush: jest.fn(async () => undefined) };
    installProcessHandlers({ proc, exit, alerts: alerts as any, flushMs: 100 });
    proc.emit('uncaughtException', new Error('fatal'));
    proc.emit('uncaughtException', new Error('second'));
    await new Promise((r) => setTimeout(r, 10));
    expect(alerts.report).toHaveBeenCalledTimes(1);
    expect(alerts.report).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNCAUGHT_EXCEPTION', severity: 'critical' }));
    expect(alerts.flush).toHaveBeenCalledWith(100);
    expect(exit).toHaveBeenCalledTimes(1); expect(exit).toHaveBeenCalledWith(1);
  });
  it('a failing alert channel cannot break the handler or prevent the exit', async () => {
    const proc = new EventEmitter(); const exit = jest.fn();
    const alerts = { report: jest.fn(() => { throw new Error('smtp down'); }), flush: jest.fn(async () => { throw new Error('flush failed'); }) };
    installProcessHandlers({ proc, exit, alerts: alerts as any });
    expect(() => proc.emit('unhandledRejection', 'x')).not.toThrow();
    proc.emit('uncaughtException', new Error('x'));
    await new Promise((r) => setTimeout(r, 10));
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('winstonLogger / AppLogger compatibility facade', () => {
  it('routes legacy calls through the structured pipeline with scrubbing and context', async () => {
    const { winstonLogger, AppLogger } = await import('../logger/winston.logger');
    winstonLogger.error('failed for a@b.co', { context: 'Legacy', stack: 'Error: x\n    at f (/home/app/x.js:1:1)', userId: 'u1' });
    const r = last();
    expect(r).toMatchObject({ level: 'error', event: 'app.log', context: 'Legacy', userId: 'u1' });
    expect(lines[0].line).not.toContain('a@b.co');
    expect(lines[0].line).not.toContain('/home/app');
    winstonLogger.info('i'); winstonLogger.warn('w'); winstonLogger.debug('d'); winstonLogger.verbose('v');
    const lg = new AppLogger('Svc');
    lg.log('l'); lg.warn('w'); lg.error('e', 'trace'); lg.debug('d'); lg.verbose('v');
    expect(lines.map((l) => JSON.parse(l.line).level)).toEqual(expect.arrayContaining(['error', 'info', 'warn']));
  });
});
