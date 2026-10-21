/**
 * HTTP-level tests of the central error contract: the real global exception filter, request-context middleware, access
 * log + metrics, ValidationPipe, throttling, health endpoints and the e-mail alert path (stub transport), exercised
 * through real sockets. Only the failure sources (a throwing controller / stubbed database probe) are fake.
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });
jest.setTimeout(30_000);          // booting a Nest app per test can exceed 5 s while the whole suite runs in parallel

import {
  Body, Controller, Get, INestApplication, Injectable, Logger, MiddlewareConsumer, Module, NestModule, NotFoundException,
  Post, ValidationPipe, VersioningType, Global, ForbiddenException, UnauthorizedException,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { ErrorEmailService, ALERT_TRANSPORT } from '../logger/error-email.service';
import { MetricsService } from './metrics.service';
import { RequestContextMiddleware } from './request-context';
import { StructuredLogger, setLogSink } from './structured-logger';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { SkipTransform } from '../decorators/skip-transform.decorator';

class SignupDto { @IsEmail() email!: string; @IsString() @MinLength(8) password!: string }

const NAME = 'Asha Rao Kulkarni';
const LEAKS = [NAME, 'postgresql://app:SuperSecret1@db.internal:5432/dentalease_db', 'C:\\Users\\dev\\apps\\api\\src\\secret.ts', '/home/app/dist/main.js', 'asha.rao@example.com', 'rzp_live_AbCdEf123456', 'SELECT * FROM patients'];

@Injectable()
class Worker {
  private readonly log = new Logger('Worker');
  async deep(): Promise<never> {
    await new Promise((r) => setTimeout(r, 5));
    this.log.warn('about to fail inside a nested service call');
    throw new Error(`pg: ${LEAKS.join(' ')}`);
  }
}

@Controller({ path: 'boom', version: '1' })
class BoomController {
  constructor(private readonly worker: Worker) {}
  @Get('ok') ok() { return { fine: true }; }
  @Get('missing') missing() { throw new NotFoundException('Patient not found'); }
  @Get('forbidden') forbidden() { throw new ForbiddenException('nope'); }
  @Get('unauth') unauth() { throw new UnauthorizedException(); }
  @Get('unique') unique() { throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`phone`) +919876543210', { code: 'P2002', clientVersion: '5', meta: { target: ['phone'] } }); }
  @Get('dbdown') dbdown() { throw new Prisma.PrismaClientInitializationError(`Can't reach database server at ${LEAKS[0]}`, '5', 'P1001'); }
  @Get('unknown') unknown() { throw new Error(`boom ${LEAKS.join(' ')}`); }
  @Get('async') async asyncFail() { return this.worker.deep(); }
  @Get('thrown-string') thrownString() { throw `raw ${LEAKS[3]}`; }
  @Post('signup') signup(@Body() dto: SignupDto) { return dto; }
  @Get('patients/3f2a4b10-1111-4222-8333-444455556666/documents') templated() { throw new Error('x'); }
}

@Global()
@Module({ providers: [{ provide: ALERT_TRANSPORT, useValue: null }], exports: [ALERT_TRANSPORT] })
class NoopModule {}

async function boot(opts: { throttle?: number; transport?: any; healthDb?: () => Promise<{ ok: boolean; latencyMs: number }> } = {}) {
  const metrics = new MetricsService();
  const transport = opts.transport ?? { sendMail: jest.fn(async () => ({ accepted: ['ops@example.com'], rejected: [], messageId: '<m>' })), close: jest.fn(), verify: jest.fn() };
  const alerts = new ErrorEmailService({ get: (k: string) => ({ NODE_ENV: 'production', ALERT_EMAIL_TO: 'ops@example.com', ALERT_EMAIL_FROM: 'a@example.com', ALERT_RETRY_BASE_MS: '5' } as any)[k] } as any, metrics, transport);
  const health = { readiness: opts.healthDb ? async () => { const db = await opts.healthDb!(); return { status: db.ok ? 'ok' : 'unavailable', checks: { database: db.ok ? 'up' : 'down', cache: 'up' } }; } : async () => ({ status: 'ok', checks: { database: 'up', cache: 'up' } }) };

  @Module({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: opts.throttle ?? 1000 }])],
    controllers: [BoomController, HealthController],
    providers: [
      Worker,
      { provide: MetricsService, useValue: metrics }, { provide: ErrorEmailService, useValue: alerts }, { provide: HealthService, useValue: health },
      { provide: APP_FILTER, useClass: HttpExceptionFilter }, { provide: APP_GUARD, useClass: ThrottlerGuard },
    ],
  })
  class TestApp implements NestModule { configure(c: MiddlewareConsumer) { c.apply(RequestContextMiddleware).forRoutes('*'); } }
  void SkipTransform;
  const mod = await Test.createTestingModule({ imports: [TestApp] }).compile();
  const app = mod.createNestApplication({ logger: false });
  app.useLogger(new StructuredLogger());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return { app, base: `${await app.getUrl()}/api/v1`, metrics, alerts, transport };
}

let logs: any[]; let restore: () => void;
beforeEach(() => { logs = []; restore = setLogSink((l) => { try { logs.push(JSON.parse(l)); } catch { logs.push({ raw: l }); } }); });
afterEach(() => restore());
const get = async (base: string, p: string, headers: Record<string, string> = {}) => {
  const r = await fetch(`${base}${p}`, { headers });
  const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, json, text, headers: r.headers };
};
const settle = () => new Promise((r) => setTimeout(r, 40));

describe('response contract', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => { ctx = await boot(); });
  afterAll(async () => { ctx.alerts.onModuleDestroy(); await ctx.app.close(); });

  it('4xx: stable code, safe message, request id in header AND body, legacy fields kept', async () => {
    const r = await get(ctx.base, '/boom/missing');
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ success: false, statusCode: 404, message: 'Patient not found', error: { code: 'NOT_FOUND', message: 'Patient not found', retryable: false }, path: '/api/v1/boom/missing' });
    expect(r.json.requestId).toBe(r.headers.get('x-request-id'));
    expect(r.json.error.requestId).toBe(r.json.requestId);
    expect(new Date(r.json.timestamp).getTime()).toBeGreaterThan(0);
  });
  it.each([['/boom/forbidden', 403, 'FORBIDDEN'], ['/boom/unauth', 401, 'UNAUTHENTICATED'], ['/boom/unique', 409, 'UNIQUE_VIOLATION'], ['/boom/dbdown', 503, 'DB_UNAVAILABLE'], ['/boom/unknown', 500, 'INTERNAL_ERROR'], ['/boom/async', 500, 'INTERNAL_ERROR'], ['/boom/thrown-string', 500, 'INTERNAL_ERROR']])(
    '%s → %i %s', async (path, status, code) => {
      const r = await get(ctx.base, path);
      expect([r.status, r.json.error.code]).toEqual([status, code]);
    });
  it('NOTHING sensitive reaches the client for any failure: no stack, SQL, connection string, path, e-mail, key', async () => {
    for (const p of ['/boom/unique', '/boom/dbdown', '/boom/unknown', '/boom/async', '/boom/thrown-string']) {
      const r = await get(ctx.base, p);
      for (const leak of [...LEAKS, '    at ', 'node_modules', 'PrismaClient', 'invocation', '+919876543210', 'phone']) expect([p, r.text.includes(leak)]).toEqual([p, false]);
      expect(r.json.error.message).toBeTruthy();
    }
  });
  it('5xx responses use generic messages; unavailable ones carry retry guidance + Retry-After', async () => {
    const r = await get(ctx.base, '/boom/dbdown');
    expect(r.json.error).toMatchObject({ retryable: true, retryAfterSeconds: 5 });
    expect(r.headers.get('retry-after')).toBe('5');
    expect(r.json.error.message).toMatch(/temporarily unavailable/);
    expect((await get(ctx.base, '/boom/unknown')).json.error).toMatchObject({ retryable: false });
  });
  it('validation errors list the offending fields; the legacy message array is preserved', async () => {
    const r = await fetch(`${ctx.base}/boom/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nope', password: 'x' }) });
    const j: any = await r.json();
    expect(r.status).toBe(400);
    expect(j.error.code).toBe('VALIDATION_FAILED');
    expect(j.error.details.map((d: any) => d.field).sort()).toEqual(['email', 'password']);
    expect(Array.isArray(j.message)).toBe(true);
    expect(JSON.stringify(j)).not.toContain('nope');                 // submitted values are not echoed
  });
  it('malformed JSON → 400 MALFORMED_JSON (not an HTML page, no parser internals)', async () => {
    const r = await fetch(`${ctx.base}/boom/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email": "a@b.co", ' });
    const text = await r.text();
    expect(r.status).toBe(400);
    const j = JSON.parse(text);
    expect(j.error.code).toBe('MALFORMED_JSON');
    expect(text).not.toMatch(/Unexpected|position|SyntaxError|body-parser/i);
    expect(j.error.requestId).toBeTruthy();
  });
  it('unknown routes → JSON 404 with a request id', async () => {
    const r = await get(ctx.base, '/does/not/exist');
    expect(r.status).toBe(404); expect(r.json.error.code).toBe('NOT_FOUND'); expect(r.json.requestId).toBeTruthy();
  });
  it('success responses also carry the request id header', async () => {
    const r = await get(ctx.base, '/boom/ok');
    expect(r.status).toBe(200); expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('correlation ids', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => { ctx = await boot(); });
  afterAll(async () => { ctx.alerts.onModuleDestroy(); await ctx.app.close(); });

  it('a caller-supplied id is honoured and flows to the response, the error log, the nested service log, the access log and the alert', async () => {
    const id = 'web-req-9f8e7d6c';
    const r = await get(ctx.base, '/boom/async', { 'X-Request-Id': id });
    expect(r.headers.get('x-request-id')).toBe(id);
    expect(r.json.requestId).toBe(id);
    await settle();
    const mine = logs.filter((l) => l.requestId === id);
    const evs = mine.map((l) => l.event + (l.context ? `:${l.context}` : ''));
    expect(evs).toEqual(expect.arrayContaining(['app.log:Worker', 'http.error', 'alert.queued', 'http.request']));   // service log survived an await
    expect(ctx.transport.sendMail.mock.calls.at(-1)![0].text).toContain(`Request / trace id: ${id}`);
  });
  it('hostile ids are replaced, never reflected', async () => {
    for (const bad of ['x', 'evil\r\nSet-Cookie: a=b', '<script>alert(1)</script>', 'a'.repeat(200)]) {
      const r = await fetch(`${ctx.base}/boom/ok`, { headers: { 'X-Request-Id': bad.replace(/[\r\n]/g, ' ') } });
      const echoed = r.headers.get('x-request-id')!;
      expect(echoed).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
  it('concurrent requests never share or lose their ids', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `concurrent-${i}-abcdef`);
    const res = await Promise.all(ids.map((id) => get(ctx.base, '/boom/async', { 'x-request-id': id })));
    expect(res.map((r) => r.json.requestId)).toEqual(ids);
    await settle();
    for (const id of ids) expect(logs.filter((l) => l.requestId === id && l.event === 'http.error')).toHaveLength(1);
  });
  it('a W3C traceparent supplies the trace id', async () => {
    await get(ctx.base, '/boom/ok', { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' });
    await settle();
    expect(logs.find((l) => l.event === 'http.request' && l.traceId === '0af7651916cd43dd8448eb211c80319c')).toBeTruthy();
  });
});

describe('logging', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => { ctx = await boot(); });
  afterAll(async () => { ctx.alerts.onModuleDestroy(); await ctx.app.close(); });

  it('a failed request produces exactly ONE error record (no repeated logging per layer) plus one access line', async () => {
    const r = await get(ctx.base, '/boom/unknown', { 'x-request-id': 'one-error-record-1' });
    await settle();
    const mine = logs.filter((l) => l.requestId === 'one-error-record-1');
    expect(mine.filter((l) => l.event === 'http.error')).toHaveLength(1);
    expect(mine.filter((l) => l.event === 'http.request')).toHaveLength(1);
    expect(r.status).toBe(500);
    expect(mine.find((l) => l.event === 'http.error')).toMatchObject({ level: 'error', status: 500, errorCode: 'INTERNAL_ERROR', subsystem: 'internal', method: 'GET', route: '/api/v1/boom/unknown' });
  });
  it('the access log carries route TEMPLATE, status, duration and never the raw id', async () => {
    await get(ctx.base, '/boom/patients/3f2a4b10-1111-4222-8333-444455556666/documents?token=abc', { 'x-request-id': 'access-log-check-1' });
    await settle();
    const a = logs.find((l) => l.requestId === 'access-log-check-1' && l.event === 'http.request');
    expect(a).toMatchObject({ status: 500, method: 'GET' });
    expect(typeof a.durationMs).toBe('number');
    expect(JSON.stringify(logs)).not.toContain('3f2a4b10-1111-4222-8333-444455556666');
    expect(JSON.stringify(logs)).not.toContain('token=abc');
  });
  it('no log line anywhere contains secrets, SQL, e-mails or connection strings from the thrown errors', async () => {
    await get(ctx.base, '/boom/unknown'); await get(ctx.base, '/boom/dbdown'); await get(ctx.base, '/boom/async'); await get(ctx.base, '/boom/unique');
    await settle();
    const all = logs.map((l) => JSON.stringify(l)).join('\n');
    for (const leak of ['SuperSecret1', 'asha.rao@example.com', 'rzp_live_AbCdEf123456', 'C:\\\\Users\\\\dev', '/home/app/dist', '9198765', 'dentalease_db']) expect([leak, all.includes(leak)]).toEqual([leak, false]);
  });
  it('4xx are logged at a lower level without stacks; auth failures as warnings', async () => {
    await get(ctx.base, '/boom/missing', { 'x-request-id': 'lvl-404-check-aa' }); await get(ctx.base, '/boom/forbidden', { 'x-request-id': 'lvl-403-check-aa' });
    await settle();
    const e404 = logs.find((l) => l.requestId === 'lvl-404-check-aa' && l.event === 'http.error');
    const e403 = logs.find((l) => l.requestId === 'lvl-403-check-aa' && l.event === 'http.error');
    expect(e404).toMatchObject({ level: 'info' }); expect(e404.stack).toBeUndefined(); expect(e404.cause).toBeUndefined();
    expect(e403).toMatchObject({ level: 'warn' });
  });
  it('metrics: error counters by code and class, http totals and latency', async () => {
    const before = ctx.metrics.getCounter('errors_total', { code: 'NOT_FOUND', status_class: '4xx' });
    await get(ctx.base, '/boom/missing'); await get(ctx.base, '/boom/unknown');
    await settle();
    expect(ctx.metrics.getCounter('errors_total', { code: 'NOT_FOUND', status_class: '4xx' })).toBe(before + 1);
    expect(ctx.metrics.getCounter('http_server_errors_total')).toBeGreaterThan(0);
    expect(Object.keys(ctx.metrics.snapshot().latency).some((k) => k.includes('/api/v1/boom/missing'))).toBe(true);
  });
});

describe('administrator alerts through the real request path', () => {
  it('a 5xx produces ONE sanitised alert; repeats are deduplicated; 4xx never alert', async () => {
    const ctx = await boot();
    for (let i = 0; i < 5; i++) await get(ctx.base, '/boom/unknown');
    await get(ctx.base, '/boom/missing'); await get(ctx.base, '/boom/forbidden'); await get(ctx.base, '/boom/unique');
    await settle(); await settle();
    expect(ctx.transport.sendMail).toHaveBeenCalledTimes(1);
    const m = ctx.transport.sendMail.mock.calls[0][0];
    expect(m.subject).toBe('[DentalEase PRODUCTION][ERROR] INTERNAL_ERROR - internal');
    for (const leak of [...LEAKS, 'pg: ']) expect([leak, (m.text + m.html).includes(leak)]).toEqual([leak, false]);
    expect(m.text).toMatch(/Route: \/api\/v1\/boom\/unknown/);
    expect(ctx.metrics.getCounter('alerts_suppressed_total', { reason: 'duplicate' })).toBe(4);
    ctx.alerts.onModuleDestroy(); await ctx.app.close();
  });
  it('a database outage is a CRITICAL alert for the database subsystem', async () => {
    const ctx = await boot();
    await get(ctx.base, '/boom/dbdown'); await settle();
    expect(ctx.transport.sendMail.mock.calls[0][0].subject).toBe('[DentalEase PRODUCTION][CRITICAL] DB_UNAVAILABLE - database');
    ctx.alerts.onModuleDestroy(); await ctx.app.close();
  });
  it('SMTP failure NEVER changes the user response and never loops: bounded attempts, no extra alerts', async () => {
    const transport = { sendMail: jest.fn(async () => { throw new Error('ECONNREFUSED smtp'); }), close: jest.fn(), verify: jest.fn() };
    const ctx = await boot({ transport });
    const r = await get(ctx.base, '/boom/unknown');
    expect(r.status).toBe(500); expect(r.json.error.code).toBe('INTERNAL_ERROR');
    await new Promise((res) => setTimeout(res, 300));
    expect(transport.sendMail).toHaveBeenCalledTimes(3);                 // ALERT_MAX_ATTEMPTS default
    expect(ctx.metrics.getCounter('alerts_requested_total', { severity: 'error' })).toBe(1);   // the failure itself raised nothing
    expect(logs.some((l) => l.event === 'alert.delivery_failed')).toBe(true);
    await new Promise((res) => setTimeout(res, 100));
    expect(transport.sendMail).toHaveBeenCalledTimes(3);
    ctx.alerts.onModuleDestroy(); await ctx.app.close();
  });
  it('a hanging SMTP server does not slow the failing request down', async () => {
    const transport = { sendMail: jest.fn(() => new Promise(() => undefined)), close: jest.fn(), verify: jest.fn() };
    const ctx = await boot({ transport });
    const t0 = Date.now();
    const r = await get(ctx.base, '/boom/unknown');
    expect(r.status).toBe(500); expect(Date.now() - t0).toBeLessThan(1000);
    ctx.alerts.onModuleDestroy(); await ctx.app.close();
  });
});

describe('rate limiting and health', () => {
  it('429 uses the standard contract with retry guidance', async () => {
    const ctx = await boot({ throttle: 3 });
    const codes: number[] = []; let last: any;
    for (let i = 0; i < 5; i++) { last = await get(ctx.base, '/boom/ok'); codes.push(last.status); }
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect(last.json.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true, retryAfterSeconds: 60 });
    expect(last.headers.get('retry-after')).toBe('60');
    expect(last.text).not.toMatch(/Throttler/);
    ctx.alerts.onModuleDestroy(); await ctx.app.close();
  });
  it('health/live is unconditional and un-enveloped', async () => {
    const ctx = await boot();
    const r = await get(ctx.base, '/health/live');
    expect(r.status).toBe(200); expect(r.json.status).toBe('ok'); expect(r.json.success).toBeUndefined();
    ctx.alerts.onModuleDestroy(); await ctx.app.close();
  });
  it('health/ready: 200 when the database answers, 503 (with no internals) when it does not, and recovers', async () => {
    let up = true;
    const ctx = await boot({ healthDb: async () => ({ ok: up, latencyMs: 1 }) });
    const ok = await get(ctx.base, '/health/ready');
    expect(ok.status).toBe(200); expect(ok.json).toMatchObject({ status: 'ok', checks: { database: 'up', cache: 'up' } });
    up = false;
    const down = await get(ctx.base, '/health/ready');
    expect(down.status).toBe(503); expect(down.json).toMatchObject({ status: 'unavailable', checks: { database: 'down' } });
    expect(down.headers.get('retry-after')).toBe('5');
    expect(down.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(down.json).sort()).toEqual(['checks', 'status', 'timestamp']);
    up = true;
    expect((await get(ctx.base, '/health/ready')).status).toBe(200);
    ctx.alerts.onModuleDestroy(); await ctx.app.close();
  });
});
