/**
 * The PUBLIC browser error-report endpoint: abuse resistance (rate limit, field caps, whitelist), sanitisation, and
 * the guarantee that e-mail delivery never delays or fails the request.
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { INestApplication, MiddlewareConsumer, Module, NestModule, ValidationPipe, VersioningType } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ErrorsController } from './errors.controller';
import { ErrorEmailService } from '../../common/logger/error-email.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { RequestContextMiddleware } from '../../common/observability/request-context';
import { setLogSink } from '../../common/observability/structured-logger';

async function boot(transport: any) {
  const metrics = new MetricsService();
  const alerts = new ErrorEmailService({ get: (k: string) => ({ NODE_ENV: 'production', ALERT_EMAIL_TO: 'ops@example.com', ALERT_EMAIL_FROM: 'a@example.com' } as any)[k] } as any, metrics, transport);
  @Module({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }])],
    controllers: [ErrorsController],
    providers: [{ provide: MetricsService, useValue: metrics }, { provide: ErrorEmailService, useValue: alerts }, { provide: APP_FILTER, useClass: HttpExceptionFilter }, { provide: APP_GUARD, useClass: ThrottlerGuard }],
  })
  class App implements NestModule { configure(c: MiddlewareConsumer) { c.apply(RequestContextMiddleware).forRoutes('*'); } }
  const mod = await Test.createTestingModule({ imports: [App] }).compile();
  const app: INestApplication = mod.createNestApplication({ logger: false });
  app.setGlobalPrefix('api'); app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  await app.listen(0, '127.0.0.1');
  return { app, base: `${await app.getUrl()}/api/v1`, metrics, alerts };
}
const okTransport = () => ({ sendMail: jest.fn(async () => ({ accepted: ['ops@example.com'], rejected: [], messageId: '<m>' })), close: jest.fn(), verify: jest.fn() });
const post = (base: string, body: unknown) => fetch(`${base}/errors/client`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let logs: any[]; let restore: () => void;
beforeEach(() => { logs = []; restore = setLogSink((l) => logs.push(JSON.parse(l))); });
afterEach(() => restore());

describe('POST /errors/client', () => {
  it('accepts a render error, returns an event id + request id, logs it sanitised', async () => {
    const t = okTransport(); const { app, base, alerts } = await boot(t);
    const r = await post(base, { message: 'Cannot read properties of undefined for asha@example.com', stack: 'Error\n at x (C:\\Users\\dev\\app.tsx:1:1)', level: 'error', context: 'ErrorBoundary', url: 'https://clinic.example.com/patients/3f2a4b10-1111-4222-8333-444455556666?token=abc#frag' });
    const j: any = await r.json();
    expect(r.status).toBe(200);
    const d = j.data ?? j; expect(d.eventId).toMatch(/^[0-9a-f-]{36}$/); expect(d.requestId).toBeTruthy();
    const rec = logs.find((l) => l.event === 'client.error');
    expect(rec).toMatchObject({ level: 'error', context: 'ErrorBoundary', page: '/patients/:id' });
    const text = JSON.stringify(rec);
    for (const leak of ['asha@example.com', 'C:\\\\Users', 'token=abc', '3f2a4b10']) expect([leak, text.includes(leak)]).toEqual([leak, false]);
    alerts.onModuleDestroy(); await app.close();
  });
  it('only FATAL reports can become alerts; error/warning never e-mail; fatal is de-duplicated', async () => {
    const t = okTransport(); const { app, base, alerts } = await boot(t);
    await post(base, { message: 'minor', level: 'error' }); await post(base, { message: 'meh', level: 'warning' });
    for (let i = 0; i < 4; i++) await post(base, { message: 'render crashed', level: 'fatal', context: 'ErrorBoundary' });
    await new Promise((r) => setTimeout(r, 80));
    expect(t.sendMail).toHaveBeenCalledTimes(1);
    const mail = (t.sendMail.mock.calls[0] as any[])[0];
    expect(mail.subject).toContain('CLIENT_FATAL_ERROR - frontend');
    alerts.onModuleDestroy(); await app.close();
  });
  it('unknown fields are stripped (no free-form extra / response bodies are stored or mailed)', async () => {
    const t = okTransport(); const { app, base, alerts } = await boot(t);
    await post(base, { message: 'x', level: 'fatal', extra: { responseBody: { patient: 'Asha Rao' } }, responseBody: 'secret', userAgent: 'evil' });
    await new Promise((r) => setTimeout(r, 80));
    expect(JSON.stringify(logs)).not.toMatch(/Asha Rao|responseBody|evil/);
    expect(JSON.stringify(t.sendMail.mock.calls)).not.toMatch(/Asha Rao|responseBody/);
    alerts.onModuleDestroy(); await app.close();
  });
  it.each([
    ['missing message', {}], ['message too long', { message: 'x'.repeat(501) }], ['stack too long', { message: 'x', stack: 'y'.repeat(4001) }],
    ['bad level', { message: 'x', level: 'catastrophic' }], ['object message', { message: { a: 1 } }], ['context too long', { message: 'x', context: 'c'.repeat(101) }],
  ])('rejects %s with 400 and does not log or alert', async (_n, body) => {
    const t = okTransport(); const { app, base, alerts } = await boot(t);
    expect((await post(base, body)).status).toBe(400);
    expect(logs.some((l) => l.event === 'client.error')).toBe(false); expect(t.sendMail).not.toHaveBeenCalled();
    alerts.onModuleDestroy(); await app.close();
  });
  it('is rate limited per client: the 11th report in a minute is 429 with the standard contract', async () => {
    const { app, base, alerts } = await boot(okTransport());
    const codes: number[] = []; let last: any;
    for (let i = 0; i < 12; i++) { const r = await post(base, { message: `m${i}`, level: 'warning' }); codes.push(r.status); last = await r.json(); }
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(200)); expect(codes.slice(10)).toEqual([429, 429]);
    expect(last.error.code).toBe('RATE_LIMITED');
    alerts.onModuleDestroy(); await app.close();
  });
  it('a hanging or failing SMTP server neither slows nor fails the response', async () => {
    const hang = { sendMail: jest.fn(() => new Promise(() => undefined)), close: jest.fn(), verify: jest.fn() };
    const { app, base, alerts } = await boot(hang);
    const t0 = Date.now(); const r = await post(base, { message: 'fatal', level: 'fatal' });
    expect(r.status).toBe(200); expect(Date.now() - t0).toBeLessThan(1000);
    alerts.onModuleDestroy(); await app.close();
    const bad = { sendMail: jest.fn(async () => { throw new Error('smtp down'); }), close: jest.fn(), verify: jest.fn() };
    const b = await boot(bad);
    expect((await post(b.base, { message: 'fatal2', level: 'fatal' })).status).toBe(200);
    b.alerts.onModuleDestroy(); await b.app.close();
  });
});
