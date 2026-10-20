/**
 * HTTP-level contract tests for the flows the web client uses: patient update, patient stats, appointment reschedule and
 * notification read-status. Real controllers, guards and the production ValidationPipe settings; services are stubbed and
 * authentication is simulated with an `x-test-user` header. Each test pins the method, path, payload, response shape and
 * error handling the client relies on.
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { CanActivate, ExecutionContext, Injectable, INestApplication, UnauthorizedException, ValidationPipe, VersioningType } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { NotificationsController } from '../notifications/notifications.controller';
import { NotificationsService } from '../notifications/notifications.service';
import { AppointmentsController } from '../appointments/appointments.controller';
import { AppointmentsService } from '../appointments/appointments.service';
import { SlotsService } from '../appointments/slots.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PAT = '44444444-4444-4444-8444-444444444444';
const APPT = '33333333-3333-4333-8333-333333333333';
const N1 = '55555555-5555-4555-8555-555555555555';
const N2 = '66666666-6666-4666-8666-666666666666';

@Injectable()
class FakeAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const raw = req.headers['x-test-user'];
    if (!raw) throw new UnauthorizedException();
    const user = JSON.parse(String(raw));
    req.user = user; req.clinicId = user.clinicId;
    return true;
  }
}

const patients = { getStats: jest.fn(), update: jest.fn(), create: jest.fn(), findOne: jest.fn(), findAll: jest.fn() };
const notifications = { markRead: jest.fn(), markAllRead: jest.fn(), findAll: jest.fn() };
const appts = { reschedule: jest.fn(), book: jest.fn(), updateStatus: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), todaySchedule: jest.fn() };

let app: INestApplication; let base: string;
beforeAll(async () => {
  const mod = await Test.createTestingModule({
    controllers: [PatientsController, NotificationsController, AppointmentsController],
    providers: [
      { provide: PatientsService, useValue: patients },
      { provide: NotificationsService, useValue: notifications },
      { provide: AppointmentsService, useValue: appts },
      { provide: SlotsService, useValue: {} },
      { provide: APP_GUARD, useClass: FakeAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_GUARD, useClass: PermissionsGuard },
    ],
  }).compile();
  app = mod.createNestApplication({ logger: ['error'] });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true, transformOptions: { enableImplicitConversion: true } }));
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api/v1`;
});
afterAll(async () => { await app.close(); });

const who = (role: string, clinicId = A) => JSON.stringify({ id: `u-${role}`, email: `${role}@x.test`, role, clinicId });
async function call(method: string, path: string, opts: { role?: string; clinic?: string; body?: unknown } = {}) {
  const r = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(opts.role ? { 'x-test-user': who(opts.role, opts.clinic) } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let json: any = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}
beforeEach(() => jest.clearAllMocks());

describe('patient update: PATCH /patients/:id (the web client no longer uses PUT)', () => {
  const row = { id: PAT, fullName: 'New Name', outstandingBalance: 777, patientCode: 'PT-1' };
  it('PATCH with the profile payload → 200, service gets only whitelisted fields, clinic from the token', async () => {
    patients.update.mockResolvedValue(row);
    const r = await call('PATCH', `/patients/${PAT}`, { role: 'receptionist', clinic: A, body: { fullName: 'New Name', city: 'Pune', waOptIn: true } });
    expect(r.status).toBe(200);
    expect(patients.update).toHaveBeenCalledWith(A, PAT, expect.objectContaining({ fullName: 'New Name', city: 'Pune', waOptIn: true }));
  });
  it('PUT is not an API route → 404 (so a client still using PUT fails loudly, not silently)', async () => {
    expect((await call('PUT', `/patients/${PAT}`, { role: 'receptionist', body: { fullName: 'x' } })).status).toBe(404);
    expect(patients.update).not.toHaveBeenCalled();
  });
  it('MASS ASSIGNMENT: protected columns in the body never reach the service', async () => {
    patients.update.mockResolvedValue(row);
    await call('PATCH', `/patients/${PAT}`, { role: 'receptionist', body: {
      fullName: 'x', clinicId: B, outstandingBalance: 0, patientCode: 'HACK', totalVisits: 99, isActive: false, id: B, createdAt: '2000-01-01',
    } });
    const dto = patients.update.mock.calls[0][2];
    for (const k of ['clinicId', 'outstandingBalance', 'patientCode', 'totalVisits', 'isActive', 'id', 'createdAt']) expect(dto).not.toHaveProperty(k);
    expect(patients.update.mock.calls[0][0]).toBe(A);
  });
  it.each([
    ['non-UUID id', '/patients/not-a-uuid', { fullName: 'x' }],
    ['bad email', `/patients/${PAT}`, { email: 'nope' }],
    ['non-boolean waOptIn string', `/patients/${PAT}`, { waOptIn: 'true' }],
    ['bad gender', `/patients/${PAT}`, { gender: 'robot' }],
  ])('invalid input (%s) → 400, no service call', async (_n, path, body) => {
    expect((await call('PATCH', path, { role: 'receptionist', body })).status).toBe(400);
    expect(patients.update).not.toHaveBeenCalled();
  });
  it('unauthenticated → 401', async () => { expect((await call('PATCH', `/patients/${PAT}`, { body: { fullName: 'x' } })).status).toBe(401); });
  it('the update response hides outstandingBalance from roles without billing:read, keeps it for billing roles', async () => {
    patients.update.mockResolvedValue(row);
    const asst = await call('PATCH', `/patients/${PAT}`, { role: 'assistant', body: { fullName: 'x' } });
    expect(asst.status).toBe(200);
    expect(JSON.stringify(asst.json)).not.toContain('outstandingBalance');
    expect(JSON.stringify(asst.json)).toContain('"financialsRestricted":true');
    const rec = await call('PATCH', `/patients/${PAT}`, { role: 'receptionist', body: { fullName: 'x' } });
    expect(JSON.stringify(rec.json)).toContain('"outstandingBalance":777');
  });
  it('create also hides outstandingBalance from roles without billing:read', async () => {
    patients.create.mockResolvedValue(row);
    const r = await call('POST', '/patients', { role: 'assistant', body: { fullName: 'A', phone: '+919876543210' } });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.json)).not.toContain('outstandingBalance');
  });
});

describe('patient statistics: GET /patients/stats', () => {
  const stats = { total: 10, newThisMonth: 2, active: 4, totalOutstanding: 12345 };
  it('is routed to the stats handler (not parsed as a patient id → no 400)', async () => {
    patients.getStats.mockResolvedValue(stats);
    const r = await call('GET', '/patients/stats', { role: 'receptionist', clinic: A });
    expect(r.status).toBe(200);
    expect(patients.getStats).toHaveBeenCalledWith(A);
    expect(patients.findOne).not.toHaveBeenCalled();
  });
  it('billing roles get counts + outstanding total', async () => {
    patients.getStats.mockResolvedValue(stats);
    for (const role of ['receptionist', 'dentist', 'clinic_admin']) {
      const r = await call('GET', '/patients/stats', { role });
      expect(r.json.data ?? r.json).toMatchObject({ total: 10, newThisMonth: 2, active: 4, totalOutstanding: 12345 });
    }
  });
  it('assistant gets the counts but NO money, with the restricted flag (key removed, not zeroed)', async () => {
    patients.getStats.mockResolvedValue(stats);
    const r = await call('GET', '/patients/stats', { role: 'assistant' });
    const body = r.json.data ?? r.json;
    expect(body).toMatchObject({ total: 10, newThisMonth: 2, active: 4, financialsRestricted: true });
    expect(body).not.toHaveProperty('totalOutstanding');
  });
  it('unauthenticated → 401', async () => { expect((await call('GET', '/patients/stats')).status).toBe(401); });
  it('GET /patients/<uuid> still reaches the detail handler', async () => {
    patients.findOne.mockResolvedValue({ id: PAT });
    expect((await call('GET', `/patients/${PAT}`, { role: 'receptionist' })).status).toBe(200);
    expect(patients.findOne).toHaveBeenCalledWith(A, PAT);
  });
});

describe('appointment reschedule: POST /appointments/:id/reschedule (the web client no longer uses PATCH)', () => {
  const payload = { date: '2031-06-16', startTime: '11:00', reason: 'patient request' };
  it('POST with the client payload → 2xx; clinic from the token, actor recorded', async () => {
    appts.reschedule.mockResolvedValue({ rescheduled: { id: APPT } });
    const r = await call('POST', `/appointments/${APPT}/reschedule`, { role: 'receptionist', clinic: A, body: payload });
    expect([200, 201]).toContain(r.status);
    expect(appts.reschedule).toHaveBeenCalledWith(A, APPT, expect.objectContaining(payload), 'u-receptionist');
  });
  it('PATCH …/reschedule → 404 (cannot silently succeed)', async () => {
    expect((await call('PATCH', `/appointments/${APPT}/reschedule`, { role: 'receptionist', body: payload })).status).toBe(404);
    expect(appts.reschedule).not.toHaveBeenCalled();
  });
  it('service errors (slot unavailable / not found) reach the client as 4xx with the message', async () => {
    const { BadRequestException, NotFoundException } = await import('@nestjs/common');
    appts.reschedule.mockRejectedValueOnce(new BadRequestException('Requested slot is not available'));
    const bad = await call('POST', `/appointments/${APPT}/reschedule`, { role: 'receptionist', body: payload });
    expect(bad.status).toBe(400);
    expect(bad.json.message).toMatch(/not available/);
    appts.reschedule.mockRejectedValueOnce(new NotFoundException('Appointment not found'));
    expect((await call('POST', `/appointments/${APPT}/reschedule`, { role: 'receptionist', clinic: B, body: payload })).status).toBe(404);
  });
});

describe('notification read-status: PATCH /notifications/read { ids } (per-id route does not exist)', () => {
  it('marks the given ids for the caller in the caller\'s clinic', async () => {
    notifications.markRead.mockResolvedValue({ count: 2 });
    const r = await call('PATCH', '/notifications/read', { role: 'dentist', clinic: A, body: { ids: [N1, N2] } });
    expect(r.status).toBe(200);
    expect(notifications.markRead).toHaveBeenCalledWith(A, 'u-dentist', [N1, N2]);
  });
  it('the old per-id route PATCH /notifications/:id/read → 404', async () => {
    expect((await call('PATCH', `/notifications/${N1}/read`, { role: 'dentist' })).status).toBe(404);
    expect(notifications.markRead).not.toHaveBeenCalled();
  });
  it.each([
    ['missing ids', {}], ['ids not an array', { ids: N1 }], ['non-UUID id', { ids: ['abc'] }], ['mixed', { ids: [N1, 'abc'] }],
  ])('invalid payload (%s) → 400, nothing marked', async (_n, body) => {
    expect((await call('PATCH', '/notifications/read', { role: 'dentist', body })).status).toBe(400);
    expect(notifications.markRead).not.toHaveBeenCalled();
  });
  it('read-all marks everything for the caller only', async () => {
    notifications.markAllRead.mockResolvedValue({ count: 5 });
    expect((await call('PATCH', '/notifications/read-all', { role: 'receptionist', clinic: A })).status).toBe(200);
    expect(notifications.markAllRead).toHaveBeenCalledWith(A, 'u-receptionist');
  });
  it('unauthenticated → 401', async () => { expect((await call('PATCH', '/notifications/read', { body: { ids: [N1] } })).status).toBe(401); });
});
