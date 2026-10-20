/**
 * HTTP-level regression tests for the mounted WhatsApp + appointment mutation routes.
 * Real guards (Roles, Permissions, Throttler) and the production ValidationPipe settings; only authentication and the
 * services are stubbed. Authentication is simulated by an `x-test-user` header so no secrets are needed.
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { Injectable, CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WebhookHandler } from './webhook/webhook.handler';
import { PublicBookingService } from './public-booking.service';
import { AppointmentsController } from '../appointments/appointments.controller';
import { AppointmentsService } from '../appointments/appointments.service';
import { SlotsService } from '../appointments/slots.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const APPT = '33333333-3333-4333-8333-333333333333';
const PAT = '44444444-4444-4444-8444-444444444444';
const DOC = '55555555-5555-4555-8555-555555555555';

/** Stand-in for JwtAuthGuard + TenantMiddleware: honours @Public, otherwise needs the x-test-user header. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const raw = req.headers['x-test-user'];
    if (!raw) throw new UnauthorizedException();
    const user = JSON.parse(String(raw));
    req.user = user;
    req.clinicId = user.clinicId;
    return true;
  }
}

const whatsapp = { assertRecipientConsented: jest.fn(), sendText: jest.fn(), sendTemplate: jest.fn(), getConversations: jest.fn(), getMessages: jest.fn() };
const publicBooking = { start: jest.fn() };
const appts = { book: jest.fn(), updateStatus: jest.fn(), reschedule: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), todaySchedule: jest.fn() };

async function boot(limit = 1000): Promise<{ app: INestApplication; url: string }> {
  const mod = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit }])],
    controllers: [WhatsappController, AppointmentsController],
    providers: [
      { provide: WhatsappService, useValue: whatsapp },
      { provide: PublicBookingService, useValue: publicBooking },
      { provide: WebhookHandler, useValue: { handle: jest.fn() } },
      { provide: ConfigService, useValue: { get: jest.fn() } },
      { provide: AppointmentsService, useValue: appts },
      { provide: SlotsService, useValue: {} },
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: APP_GUARD, useClass: FakeAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_GUARD, useClass: PermissionsGuard },
    ],
  }).compile();
  const app = mod.createNestApplication({ logger: ['error'] });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true, transformOptions: { enableImplicitConversion: true } }));
  await app.listen(0, '127.0.0.1');
  return { app, url: `${await app.getUrl()}/api/v1` };
}

const who = (role: string, clinicId = A) => JSON.stringify({ id: `u-${role}`, email: `${role}@x.test`, role, clinicId });
async function call(base: string, method: string, path: string, opts: { role?: string; clinic?: string; body?: unknown } = {}) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.role ? { 'x-test-user': who(opts.role, opts.clinic) } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let json: any = null; try { json = await r.json(); } catch { /* empty body */ }
  return { status: r.status, json };
}

const goodText = { to: '+919876543210', message: 'Hello' };
const goodTemplate = { to: '+919876543210', templateName: 'appointment_followup', params: { patientName: 'A', dentistName: 'B', clinicName: 'C' } };
const goodBook = { patientId: PAT, dentistId: DOC, date: '2031-06-15', startTime: '10:00', type: 'consultation' };
const goodStatus = { status: 'confirmed' };
const goodResched = { date: '2031-06-16', startTime: '11:00' };

beforeEach(() => {
  jest.clearAllMocks();
  whatsapp.assertRecipientConsented.mockResolvedValue(undefined);
  whatsapp.sendText.mockResolvedValue({ id: 'm1' });
  whatsapp.sendTemplate.mockResolvedValue({ id: 'm2' });
  publicBooking.start.mockResolvedValue({ accepted: true });
  appts.book.mockResolvedValue({ id: APPT }); appts.updateStatus.mockResolvedValue({ id: APPT }); appts.reschedule.mockResolvedValue({ rescheduled: { id: APPT } });
});

describe('route security (no rate-limit pressure)', () => {
  let ctx: { app: INestApplication; url: string };
  beforeAll(async () => { ctx = await boot(); });
  afterAll(async () => { await ctx.app.close(); });

  const protectedRoutes: Array<[string, string, string, () => unknown, jest.Mock[]]> = [
    ['POST', '/whatsapp/send', 'whatsapp:send', () => goodText, [whatsapp.sendText]],
    ['POST', '/whatsapp/send-template', 'whatsapp:send', () => goodTemplate, [whatsapp.sendTemplate]],
    ['POST', '/appointments', 'appointments:write', () => goodBook, [appts.book]],
    ['PATCH', `/appointments/${APPT}/status`, 'appointments:write', () => goodStatus, [appts.updateStatus]],
    ['POST', `/appointments/${APPT}/reschedule`, 'appointments:write', () => goodResched, [appts.reschedule]],
  ];

  describe.each(protectedRoutes)('%s %s', (method, path, _perm, body, services) => {
    it('rejects an unauthenticated caller with 401 and never reaches the service', async () => {
      const r = await call(ctx.url, method, path, { body: body() });
      expect(r.status).toBe(401);
      services.forEach((s) => expect(s).not.toHaveBeenCalled());
      expect(whatsapp.assertRecipientConsented).not.toHaveBeenCalled();
    });
    it('rejects the assistant role (no permission in the matrix) with 403', async () => {
      const r = await call(ctx.url, method, path, { role: 'assistant', body: body() });
      expect(r.status).toBe(403);
      expect(JSON.stringify(r.json)).toContain('lacks permission');
      services.forEach((s) => expect(s).not.toHaveBeenCalled());
    });
    it.each(['dentist', 'receptionist', 'clinic_admin', 'super_admin'])('allows %s', async (role) => {
      const r = await call(ctx.url, method, path, { role, body: body() });
      expect([200, 201]).toContain(r.status);
      services.forEach((s) => expect(s).toHaveBeenCalledTimes(1));
    });
    it('uses the clinic from the token, never one supplied by the caller', async () => {
      await call(ctx.url, method, path, { role: 'receptionist', clinic: A, body: { ...(body() as object), clinicId: B, clinic_id: B } });
      const firstArgs = services.map((s) => s.mock.calls[0]?.[0]);
      expect(firstArgs.every((a) => a === A)).toBe(true);
    });
  });

  describe('consent is enforced on manual sends', () => {
    it('an opted-out / unknown recipient (service refuses) → 403 and NOTHING is sent', async () => {
      const { ForbiddenException } = await import('@nestjs/common');
      whatsapp.assertRecipientConsented.mockRejectedValue(new ForbiddenException('Recipient has not opted in to WhatsApp messages'));
      for (const [path, body] of [['/whatsapp/send', goodText], ['/whatsapp/send-template', goodTemplate]] as const) {
        const r = await call(ctx.url, 'POST', path, { role: 'receptionist', body });
        expect(r.status).toBe(403);
        expect(r.json.message).toMatch(/opted in/);
      }
      expect(whatsapp.sendText).not.toHaveBeenCalled();
      expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    });
    it('the consent check runs against the CALLER\'s clinic and the requested number', async () => {
      await call(ctx.url, 'POST', '/whatsapp/send', { role: 'dentist', clinic: B, body: goodText });
      expect(whatsapp.assertRecipientConsented).toHaveBeenCalledWith(B, '+919876543210');
    });
  });

  describe('invalid input is rejected with 400 before any service call', () => {
    it.each([
      ['not E.164', { ...goodText, to: '98765 43210' }],
      ['no plus', { ...goodText, to: '919876543210' }],
      ['too short', { ...goodText, to: '+12345' }],
      ['letters', { ...goodText, to: '+91abcdefghij' }],
      ['missing to', { message: 'x' }],
      ['empty message', { ...goodText, message: '   ' }],
      ['message > 1000 chars', { ...goodText, message: 'x'.repeat(1001) }],
      ['message not a string', { ...goodText, message: { a: 1 } }],
      ['empty body', {}],
    ])('POST /whatsapp/send — %s', async (_n, body) => {
      const r = await call(ctx.url, 'POST', '/whatsapp/send', { role: 'receptionist', body });
      expect(r.status).toBe(400);
      expect(whatsapp.assertRecipientConsented).not.toHaveBeenCalled();
      expect(whatsapp.sendText).not.toHaveBeenCalled();
    });
    it.each([
      ['unknown template', { ...goodTemplate, templateName: 'free_money' }],
      ['bad number', { ...goodTemplate, to: 'abc' }],
      ['params missing', { to: goodTemplate.to, templateName: goodTemplate.templateName }],
      ['params an array', { ...goodTemplate, params: ['x'] }],
      ['params non-string value', { ...goodTemplate, params: { a: { nested: true } } }],
      ['params value too long', { ...goodTemplate, params: { a: 'x'.repeat(301) } }],
      ['11 params', { ...goodTemplate, params: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v'])) }],
    ])('POST /whatsapp/send-template — %s', async (_n, body) => {
      const r = await call(ctx.url, 'POST', '/whatsapp/send-template', { role: 'receptionist', body });
      expect(r.status).toBe(400);
      expect(whatsapp.assertRecipientConsented).not.toHaveBeenCalled();
      expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    });
    it.each([
      ['non-UUID patient', { ...goodBook, patientId: '1 OR 1=1' }],
      ['bad time', { ...goodBook, startTime: '25:99' }],
      ['bad type', { ...goodBook, type: 'nope' }],
      ['bad bookedVia', { ...goodBook, bookedVia: 'carrier-pigeon' }],
      ['negative cost', { ...goodBook, estimatedCost: -1 }],
      ['complaint > 500', { ...goodBook, chiefComplaint: 'x'.repeat(501) }],
    ])('POST /appointments — %s', async (_n, body) => {
      const r = await call(ctx.url, 'POST', '/appointments', { role: 'receptionist', body });
      expect(r.status).toBe(400);
      expect(appts.book).not.toHaveBeenCalled();
    });
    it('PATCH status / POST reschedule: bad id, status, date, time, oversize text', async () => {
      const bad = [
        call(ctx.url, 'PATCH', '/appointments/not-a-uuid/status', { role: 'receptionist', body: goodStatus }),
        call(ctx.url, 'PATCH', `/appointments/${APPT}/status`, { role: 'receptionist', body: { status: 'exploded' } }),
        call(ctx.url, 'PATCH', `/appointments/${APPT}/status`, { role: 'receptionist', body: { status: 'confirmed', clinicalNotes: 'x'.repeat(5001) } }),
        call(ctx.url, 'PATCH', `/appointments/${APPT}/status`, { role: 'receptionist', body: { status: 'cancelled', reason: 'x'.repeat(501) } }),
        call(ctx.url, 'POST', '/appointments/not-a-uuid/reschedule', { role: 'receptionist', body: goodResched }),
        call(ctx.url, 'POST', `/appointments/${APPT}/reschedule`, { role: 'receptionist', body: { date: 'tomorrow', startTime: '11:00' } }),
        call(ctx.url, 'POST', `/appointments/${APPT}/reschedule`, { role: 'receptionist', body: { date: '2031-06-16', startTime: '9am' } }),
      ];
      expect((await Promise.all(bad)).map((r) => r.status)).toEqual(Array(7).fill(400));
      expect(appts.updateStatus).not.toHaveBeenCalled();
      expect(appts.reschedule).not.toHaveBeenCalled();
    });
  });

  describe('POST /whatsapp/start-booking (public)', () => {
    let sb: { app: INestApplication; url: string };
    beforeEach(async () => { sb = await boot(); });
    afterEach(async () => { await sb.app.close(); });
    const good = { clinicId: A, phone: '+919876543210' };
    it('needs no token, answers 202 {accepted:true}', async () => {
      const r = await call(sb.url, 'POST', '/whatsapp/start-booking', { body: good });
      expect(r.status).toBe(202);
      expect(r.json).toEqual({ accepted: true });
      expect(publicBooking.start).toHaveBeenCalledWith(A, '+919876543210');
    });
    it.each([
      ['missing clinicId', { phone: good.phone }],
      ['clinicId not a UUID', { ...good, clinicId: 'clinic-1' }],
      ['clinicId UUID v1', { ...good, clinicId: 'c232ab00-9414-11ec-b3c8-9f6bdeced846' }],
      ['missing phone', { clinicId: A }],
      ['phone not E.164', { ...good, phone: '9876543210' }],
      ['phone with injection', { ...good, phone: '+91987654321; DROP TABLE' }],
      ['phone as number', { ...good, phone: 919876543210 }],
      ['empty body', {}],
    ])('rejects %s with 400 and does not call the service', async (_n, body) => {
      const r = await call(sb.url, 'POST', '/whatsapp/start-booking', { body });
      expect(r.status).toBe(400);
      expect(publicBooking.start).not.toHaveBeenCalled();
    });
    it('trims whitespace around the phone', async () => {
      await call(sb.url, 'POST', '/whatsapp/start-booking', { body: { ...good, phone: '  +919876543210 ' } });
      expect(publicBooking.start).toHaveBeenCalledWith(A, '+919876543210');
    });
  });
});

describe('rate limiting', () => {
  let ctx: { app: INestApplication; url: string };
  beforeEach(async () => { ctx = await boot(1000); });
  afterEach(async () => { await ctx.app.close(); });

  it('start-booking: 5 per minute per client, the 6th is 429 and never reaches the service', async () => {
    const body = { clinicId: A, phone: '+919876543210' };
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await call(ctx.url, 'POST', '/whatsapp/start-booking', { body })).status);
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429, 429]);
    expect(publicBooking.start).toHaveBeenCalledTimes(5);
  });
  it('start-booking: invalid requests count against the limit too (cannot be used to probe for free)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await call(ctx.url, 'POST', '/whatsapp/start-booking', { body: { phone: 'x' } })).status);
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill(400));
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
  it('manual send: 20 per minute, the 21st is 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await call(ctx.url, 'POST', '/whatsapp/send', { role: 'receptionist', body: goodText })).status);
    expect(statuses.filter((s) => s === 201 || s === 200)).toHaveLength(20);
    expect(statuses.slice(20)).toEqual([429, 429]);
    expect(whatsapp.sendText).toHaveBeenCalledTimes(20);
  });
  it('manual send-template shares the same 20/min protection', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await call(ctx.url, 'POST', '/whatsapp/send-template', { role: 'receptionist', body: goodTemplate })).status);
    expect(statuses[20]).toBe(429);
  });
});
