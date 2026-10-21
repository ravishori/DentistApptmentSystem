/**
 * HTTP-level tests for the routes behind the appointment-management UI: block / unblock a slot, list every slot of a day
 * (`includeAll`), reschedule and cancel. Real controller, guards and the production ValidationPipe settings; services are
 * stubbed and authentication is simulated with an `x-test-user` header. They pin who may call what, what is validated, and
 * that the clinic always comes from the token (never from the request).
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });
jest.setTimeout(30_000);

import { CanActivate, ConflictException, ExecutionContext, Injectable, INestApplication, NotFoundException, UnauthorizedException, ValidationPipe, VersioningType, BadRequestException } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { SlotsService } from './slots.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SLOT = '77777777-7777-4777-8777-777777777777';
const DENT = '88888888-8888-4888-8888-888888888888';
const APPT = '33333333-3333-4333-8333-333333333333';

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

const slots = { block: jest.fn(), unblock: jest.fn(), listForDay: jest.fn(), getAvailable: jest.fn(), generate: jest.fn() };
const appts = { reschedule: jest.fn(), updateStatus: jest.fn(), book: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), todaySchedule: jest.fn() };

let app: INestApplication; let base: string;
beforeAll(async () => {
  const mod = await Test.createTestingModule({
    controllers: [AppointmentsController],
    providers: [
      { provide: AppointmentsService, useValue: appts },
      { provide: SlotsService, useValue: slots },
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
beforeEach(() => jest.clearAllMocks());

const who = (role: string, clinicId = A) => JSON.stringify({ id: `u-${role}`, email: `${role}@x.test`, role, clinicId });
async function call(method: string, path: string, opts: { role?: string; clinic?: string; body?: unknown } = {}) {
  const r = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(opts.role ? { 'x-test-user': who(opts.role, opts.clinic) } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let json: any = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}

describe('PATCH /appointments/slots/:id/block', () => {
  it.each(['receptionist', 'clinic_admin', 'super_admin'])('%s may block; clinic and slot come from token and path, only the reason from the body', async (role) => {
    slots.block.mockResolvedValue({ id: SLOT, isBlocked: true });
    const r = await call('PATCH', `/appointments/slots/${SLOT}/block`, { role, clinic: A, body: { reason: 'Dentist on leave', clinicId: B, slotId: 'x', isBooked: false } });
    expect(r.status).toBe(200);
    expect(slots.block).toHaveBeenCalledTimes(1);
    expect(slots.block).toHaveBeenCalledWith(A, { slotId: SLOT, reason: 'Dentist on leave' });   // injected clinicId/isBooked never reach the service
  });

  it.each(['dentist', 'assistant'])('%s is refused (403) and nothing is blocked', async (role) => {
    const r = await call('PATCH', `/appointments/slots/${SLOT}/block`, { role, body: { reason: 'x y z' } });
    expect(r.status).toBe(403);
    expect(slots.block).not.toHaveBeenCalled();
  });

  it('anonymous → 401', async () => {
    expect((await call('PATCH', `/appointments/slots/${SLOT}/block`, { body: { reason: 'abc' } })).status).toBe(401);
    expect(slots.block).not.toHaveBeenCalled();
  });

  it('invalid input: reason longer than 200 characters, non-string reason, non-UUID slot id → 400, service not called', async () => {
    for (const body of [{ reason: 'x'.repeat(201) }, { reason: 12345 }, { reason: { a: 1 } }]) {
      const r = await call('PATCH', `/appointments/slots/${SLOT}/block`, { role: 'receptionist', body });
      expect([JSON.stringify(body).slice(0, 30), r.status]).toEqual([JSON.stringify(body).slice(0, 30), 400]);
    }
    expect((await call('PATCH', '/appointments/slots/not-a-uuid/block', { role: 'receptionist', body: { reason: 'abc' } })).status).toBe(400);
    expect(slots.block).not.toHaveBeenCalled();
  });

  it('an already-booked slot is a 409 conflict; another clinic\'s slot is a 404', async () => {
    slots.block.mockRejectedValueOnce(new ConflictException('Cannot block an already-booked slot'));
    expect((await call('PATCH', `/appointments/slots/${SLOT}/block`, { role: 'receptionist', body: { reason: 'abc' } })).status).toBe(409);
    slots.block.mockRejectedValueOnce(new NotFoundException('Slot not found'));
    expect((await call('PATCH', `/appointments/slots/${SLOT}/block`, { role: 'receptionist', clinic: B, body: { reason: 'abc' } })).status).toBe(404);
  });
});

describe('PATCH /appointments/slots/:id/unblock', () => {
  it.each(['receptionist', 'clinic_admin'])('%s may unblock', async (role) => {
    slots.unblock.mockResolvedValue({ id: SLOT, isBlocked: false });
    expect((await call('PATCH', `/appointments/slots/${SLOT}/unblock`, { role })).status).toBe(200);
    expect(slots.unblock).toHaveBeenCalledWith(A, SLOT);
  });
  it.each(['dentist', 'assistant'])('%s → 403', async (role) => {
    expect((await call('PATCH', `/appointments/slots/${SLOT}/unblock`, { role })).status).toBe(403);
    expect(slots.unblock).not.toHaveBeenCalled();
  });
  it('anonymous → 401; another clinic\'s slot → 404; non-UUID → 400', async () => {
    expect((await call('PATCH', `/appointments/slots/${SLOT}/unblock`)).status).toBe(401);
    slots.unblock.mockRejectedValueOnce(new NotFoundException('Slot not found'));
    expect((await call('PATCH', `/appointments/slots/${SLOT}/unblock`, { role: 'receptionist', clinic: B })).status).toBe(404);
    expect((await call('PATCH', '/appointments/slots/nope/unblock', { role: 'receptionist' })).status).toBe(400);
  });
});

describe('GET /appointments/slots (free slots, and every slot with includeAll)', () => {
  const q = `?dentistId=${DENT}&date=2031-03-03`;
  it('free-slot lookup stays open to staff and is scoped to the token clinic', async () => {
    slots.getAvailable.mockResolvedValue([]);
    for (const role of ['dentist', 'assistant', 'receptionist']) expect((await call('GET', `/appointments/slots${q}`, { role })).status).toBe(200);
    expect(slots.getAvailable).toHaveBeenCalledWith(A, DENT, '2031-03-03');
    expect(slots.listForDay).not.toHaveBeenCalled();
  });
  it.each(['receptionist', 'clinic_admin', 'super_admin'])('includeAll=true for %s returns the full-day list for the token clinic', async (role) => {
    slots.listForDay.mockResolvedValue([{ id: SLOT, isBlocked: true, blockReason: 'Leave' }]);
    const r = await call('GET', `/appointments/slots${q}&includeAll=true`, { role });
    expect(r.status).toBe(200);
    expect(slots.listForDay).toHaveBeenCalledWith(A, DENT, '2031-03-03');
    expect(slots.getAvailable).not.toHaveBeenCalled();
  });
  it.each(['dentist', 'assistant'])('includeAll=true for %s → 403 (block reasons stay private) and nothing is read', async (role) => {
    expect((await call('GET', `/appointments/slots${q}&includeAll=true`, { role })).status).toBe(403);
    expect(slots.listForDay).not.toHaveBeenCalled();
    expect(slots.getAvailable).not.toHaveBeenCalled();
  });
  it('includeAll with any other value is the normal free-slot lookup (no escalation by guessing values)', async () => {
    slots.getAvailable.mockResolvedValue([]);
    expect((await call('GET', `/appointments/slots${q}&includeAll=1`, { role: 'assistant' })).status).toBe(200);
    expect(slots.listForDay).not.toHaveBeenCalled();
  });
  it('anonymous → 401; missing or non-UUID dentistId → 400; a bad date from the service → 400', async () => {
    expect((await call('GET', `/appointments/slots${q}`)).status).toBe(401);
    expect((await call('GET', '/appointments/slots?date=2031-03-03', { role: 'receptionist' })).status).toBe(400);
    expect((await call('GET', `/appointments/slots?dentistId=bad&date=2031-03-03`, { role: 'receptionist' })).status).toBe(400);
    slots.getAvailable.mockRejectedValueOnce(new BadRequestException('date must be a valid YYYY-MM-DD date'));
    expect((await call('GET', `/appointments/slots?dentistId=${DENT}&date=nonsense`, { role: 'receptionist' })).status).toBe(400);
  });
});

describe('POST /appointments/:id/reschedule (what the reschedule dialog sends)', () => {
  const ok = { date: '2031-03-04', startTime: '10:30', reason: 'Patient asked' };
  it('receptionist, dentist and admin may reschedule; clinic and actor come from the token', async () => {
    appts.reschedule.mockResolvedValue({ id: APPT, status: 'scheduled' });
    for (const role of ['receptionist', 'dentist', 'clinic_admin']) expect((await call('POST', `/appointments/${APPT}/reschedule`, { role, body: ok })).status).toBe(201);
    expect(appts.reschedule).toHaveBeenLastCalledWith(A, APPT, expect.objectContaining(ok), 'u-clinic_admin');
  });
  it('assistant → 403, anonymous → 401, nothing moved', async () => {
    expect((await call('POST', `/appointments/${APPT}/reschedule`, { role: 'assistant', body: ok })).status).toBe(403);
    expect((await call('POST', `/appointments/${APPT}/reschedule`, { body: ok })).status).toBe(401);
    expect(appts.reschedule).not.toHaveBeenCalled();
  });
  it('invalid input is a 400 and never reaches the service', async () => {
    const bad = [
      {}, { date: '2031-03-04' }, { startTime: '10:30' },
      { date: 'not-a-date', startTime: '10:30' }, { date: '2031-03-04', startTime: '9:5' }, { date: '2031-03-04', startTime: '25:00' },
      { ...ok, reason: 'x'.repeat(501) }, { ...ok, reason: { a: 1 } }, { ...ok, reason: 12345 },
    ];
    for (const body of bad) expect([JSON.stringify(body), (await call('POST', `/appointments/${APPT}/reschedule`, { role: 'receptionist', body })).status]).toEqual([JSON.stringify(body), 400]);
    expect((await call('POST', '/appointments/nope/reschedule', { role: 'receptionist', body: ok })).status).toBe(400);
    expect(appts.reschedule).not.toHaveBeenCalled();
  });
  it('conflicts and ineligible states surface as the API\'s own status codes (the dialog shows the message)', async () => {
    appts.reschedule.mockRejectedValueOnce(new ConflictException('Requested slot is no longer available'));
    expect((await call('POST', `/appointments/${APPT}/reschedule`, { role: 'receptionist', body: ok })).status).toBe(409);
    appts.reschedule.mockRejectedValueOnce(new BadRequestException('Requested slot is not available'));
    expect((await call('POST', `/appointments/${APPT}/reschedule`, { role: 'receptionist', body: ok })).status).toBe(400);
    appts.reschedule.mockRejectedValueOnce(new BadRequestException('Only scheduled or confirmed appointments can be rescheduled'));
    expect((await call('POST', `/appointments/${APPT}/reschedule`, { role: 'receptionist', body: ok })).status).toBe(400);
    appts.reschedule.mockRejectedValueOnce(new NotFoundException('Appointment not found'));
    expect((await call('POST', `/appointments/${APPT}/reschedule`, { role: 'receptionist', clinic: B, body: ok })).status).toBe(404);
  });
});

describe('PATCH /appointments/:id/status (cancellation with a reason)', () => {
  it('cancel with a reason: the reason reaches the service together with the token\'s clinic and actor', async () => {
    appts.updateStatus.mockResolvedValue({ id: APPT, status: 'cancelled' });
    const r = await call('PATCH', `/appointments/${APPT}/status`, { role: 'receptionist', body: { status: 'cancelled', reason: 'Patient called' } });
    expect(r.status).toBe(200);
    expect(appts.updateStatus).toHaveBeenCalledWith(A, APPT, expect.objectContaining({ status: 'cancelled', reason: 'Patient called' }), 'u-receptionist');
  });
  it('assistant → 403, anonymous → 401', async () => {
    expect((await call('PATCH', `/appointments/${APPT}/status`, { role: 'assistant', body: { status: 'cancelled', reason: 'abc' } })).status).toBe(403);
    expect((await call('PATCH', `/appointments/${APPT}/status`, { body: { status: 'cancelled' } })).status).toBe(401);
    expect(appts.updateStatus).not.toHaveBeenCalled();
  });
  it('unknown status, over-long reason or non-UUID id → 400', async () => {
    for (const body of [{ status: 'deleted' }, { status: 'cancelled', reason: 'x'.repeat(501) }, { status: 'cancelled', reason: { a: 1 } }, {}]) {
      expect((await call('PATCH', `/appointments/${APPT}/status`, { role: 'receptionist', body })).status).toBe(400);
    }
    expect((await call('PATCH', '/appointments/nope/status', { role: 'receptionist', body: { status: 'cancelled' } })).status).toBe(400);
    expect(appts.updateStatus).not.toHaveBeenCalled();
  });
  it('an invalid transition (e.g. cancelling a completed visit) surfaces as 400 from the API', async () => {
    appts.updateStatus.mockRejectedValueOnce(new BadRequestException('Invalid transition: completed → cancelled'));
    expect((await call('PATCH', `/appointments/${APPT}/status`, { role: 'receptionist', body: { status: 'cancelled', reason: 'abc' } })).status).toBe(400);
  });
});
