/**
 * Real-PostgreSQL tests for: manual-send consent, the public start-booking gate and cross-clinic access on
 * appointment mutations. Skipped unless TEST_DATABASE_URL is set. Use ONLY a disposable database, never dentalease_db.
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WhatsappService } from './whatsapp.service';
import { PublicBookingService } from './public-booking.service';
import { AppointmentsService } from '../appointments/appointments.service';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('route security on PostgreSQL', () => {
  const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  const stamp = Date.now();
  let A: string, B: string, docA: string, docB: string, patA: string, patB: string;
  const phones = { optedIn: '+910000007001', optedOut: '+910000007002', family: '+910000007003', other: '+910000007004', stranger: '+910000007005', noPlus: '910000007006' };
  const day = '2031-07-01';

  const wa = new WhatsappService(prisma as any, { get: () => undefined } as any);
  const mkPatient = (clinicId: string, tag: string, phone: string, waOptIn: boolean) =>
    prisma.patient.create({ data: { clinicId, patientCode: `${tag}-${stamp}`, fullName: tag, phone, waOptIn } as any });

  beforeAll(async () => {
    A = (await prisma.clinic.create({ data: { name: 'rsA', slug: `rsa${stamp}`, email: `rsa${stamp}@r.test` } as any })).id;
    B = (await prisma.clinic.create({ data: { name: 'rsB', slug: `rsb${stamp}`, email: `rsb${stamp}@r.test` } as any })).id;
    docA = (await prisma.user.create({ data: { clinicId: A, email: `da${stamp}@r.test`, passwordHash: 'x', fullName: 'Dr A', role: 'dentist' } as any })).id;
    docB = (await prisma.user.create({ data: { clinicId: B, email: `db${stamp}@r.test`, passwordHash: 'x', fullName: 'Dr B', role: 'dentist' } as any })).id;
    patA = (await mkPatient(A, 'in', phones.optedIn, true)).id;
    await mkPatient(A, 'out', phones.optedOut, false);
    await mkPatient(A, 'fam1', phones.family, true);
    await mkPatient(A, 'fam2', phones.family, false);               // family number: one member opted out
    await mkPatient(A, 'nop', phones.noPlus, true);                  // stored without '+'
    patB = (await mkPatient(B, 'other', phones.other, true)).id;     // opted in — but at ANOTHER clinic
  });

  afterAll(async () => {
    for (const c of [A, B]) {
      await prisma.whatsappMessage.deleteMany({ where: { clinicId: c } });
      await prisma.whatsappConversation.deleteMany({ where: { clinicId: c } });
      await prisma.appointment.deleteMany({ where: { clinicId: c } });
      await prisma.appointmentSlot.deleteMany({ where: { clinicId: c } });
      await prisma.patient.deleteMany({ where: { clinicId: c } });
      await prisma.user.deleteMany({ where: { clinicId: c } });
    }
    await prisma.clinic.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.$disconnect();
  });

  describe('assertRecipientConsented (manual send)', () => {
    it('opted-in patient of the caller\'s clinic → allowed', async () => { await expect(wa.assertRecipientConsented(A, phones.optedIn)).resolves.toBeUndefined(); });
    it('works for a phone stored without the leading +', async () => { await expect(wa.assertRecipientConsented(A, '+' + phones.noPlus)).resolves.toBeUndefined(); });
    it('opted-out patient → 403', async () => { await expect(wa.assertRecipientConsented(A, phones.optedOut)).rejects.toThrow(/not opted in/); });
    it('shared family number where ONE record opted out → 403 (opt-out wins)', async () => { await expect(wa.assertRecipientConsented(A, phones.family)).rejects.toThrow(/not opted in/); });
    it('number that is not a patient at all → 403', async () => { await expect(wa.assertRecipientConsented(A, phones.stranger)).rejects.toThrow(/not a registered patient/); });
    it('CROSS-CLINIC: an opted-in patient of clinic B is NOT reachable from clinic A', async () => {
      await expect(wa.assertRecipientConsented(A, phones.other)).rejects.toThrow(/not a registered patient/);
      await expect(wa.assertRecipientConsented(B, phones.other)).resolves.toBeUndefined();
    });
  });

  describe('PublicBookingService (start-booking gate)', () => {
    const store = new Map<string, unknown>();
    const cache = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: unknown) => { store.set(k, v); } };
    const flow = { start: jest.fn(async () => undefined) };
    const svc = new PublicBookingService(prisma as any, cache as any, flow as any);
    beforeEach(() => { store.clear(); flow.start.mockClear(); });

    const inbound = async (clinicId: string, phone: string, ageMs: number) => {
      const conv = await prisma.whatsappConversation.create({ data: { clinicId, patientPhone: phone } as any });
      const m = await prisma.whatsappMessage.create({ data: { clinicId, conversationId: conv.id, direction: 'inbound', type: 'text', content: 'BOOK', status: 'read' } as any });
      await prisma.$executeRawUnsafe(`UPDATE whatsapp_messages SET created_at = (now() at time zone 'utc') - ($1 || ' milliseconds')::interval WHERE id = $2::uuid`, String(ageMs), m.id);
    };

    it('opted-in patient → flow starts, answer is {accepted:true}', async () => {
      expect(await svc.start(A, phones.optedIn)).toEqual({ accepted: true });
      expect(flow.start).toHaveBeenCalledWith(phones.optedIn, A);
    });
    it('opted-out patient → NO message, identical answer', async () => {
      expect(await svc.start(A, phones.optedOut)).toEqual({ accepted: true });
      expect(flow.start).not.toHaveBeenCalled();
    });
    it('family number with one opt-out → NO message', async () => {
      await svc.start(A, phones.family);
      expect(flow.start).not.toHaveBeenCalled();
    });
    it('unknown number that never contacted the clinic → NO message (cannot be used to spam strangers)', async () => {
      expect(await svc.start(A, phones.stranger)).toEqual({ accepted: true });
      expect(flow.start).not.toHaveBeenCalled();
    });
    it('unknown number that messaged the clinic within 24 h (click-to-chat) → flow starts', async () => {
      await inbound(A, phones.stranger, 60_000);
      await svc.start(A, phones.stranger);
      expect(flow.start).toHaveBeenCalledTimes(1);
    });
    it('unknown number whose last inbound message was 25 h ago → NO message', async () => {
      store.clear();
      const ph = '+910000007099';
      await inbound(A, ph, 25 * 3600_000);
      await svc.start(A, ph);
      expect(flow.start).not.toHaveBeenCalled();
    });
    it('CROSS-CLINIC: a patient opted in at clinic B gives no permission at clinic A, and inbound at B does not count at A', async () => {
      await svc.start(A, phones.other);
      expect(flow.start).not.toHaveBeenCalled();
      await inbound(B, '+910000007098', 1000);
      await svc.start(A, '+910000007098');
      expect(flow.start).not.toHaveBeenCalled();
    });
    it('unknown, inactive or cancelled clinic → NO message', async () => {
      await svc.start('99999999-9999-4999-8999-999999999999', phones.optedIn);
      await prisma.clinic.update({ where: { id: A }, data: { isActive: false } });
      await svc.start(A, phones.optedIn);
      await prisma.clinic.update({ where: { id: A }, data: { isActive: true, subStatus: 'cancelled' } as any });
      await svc.start(A, phones.optedIn);
      await prisma.clinic.update({ where: { id: A }, data: { subStatus: 'active' } as any });
      expect(flow.start).not.toHaveBeenCalled();
    });
    it('per-phone cooldown: a second start within 10 minutes is silently ignored', async () => {
      await svc.start(A, phones.optedIn);
      await svc.start(A, phones.optedIn);
      expect(flow.start).toHaveBeenCalledTimes(1);
    });
    it('a flow/DB failure never leaks to the anonymous caller', async () => {
      flow.start.mockRejectedValueOnce(new Error('redis exploded: password=hunter2'));
      await expect(svc.start(A, phones.optedIn)).resolves.toEqual({ accepted: true });
    });
  });

  describe('appointment mutations are tenant-scoped (service level, real DB)', () => {
    const cacheStub = { del: jest.fn(async () => undefined) };
    const svc = new AppointmentsService(prisma as any, cacheStub as any, new EventEmitter2());
    let apptB: string;
    const slot = (clinicId: string, dentistId: string, startTime: string) =>
      prisma.appointmentSlot.create({ data: { clinicId, dentistId, slotDate: new Date(day), startTime, endTime: startTime.replace(':00:00', ':30:00') } as any });

    beforeAll(async () => {
      const s = await slot(B, docB, '09:00:00');
      await slot(B, docB, '10:00:00');
      await slot(A, docA, '09:00:00');
      apptB = (await prisma.appointment.create({ data: {
        clinicId: B, patientId: patB, dentistId: docB, slotId: s.id, appointmentDate: new Date(day), startTime: '09:00:00', endTime: '09:30:00', status: 'scheduled',
      } as any })).id;
    });

    it('clinic A cannot change the status of clinic B\'s appointment (404, row untouched)', async () => {
      await expect(svc.updateStatus(A, apptB, { status: 'confirmed' } as any, docA)).rejects.toThrow(/not found/i);
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: apptB } })).status).toBe('scheduled');
    });
    it('clinic A cannot cancel clinic B\'s appointment', async () => {
      await expect(svc.updateStatus(A, apptB, { status: 'cancelled', reason: 'x' } as any, docA)).rejects.toThrow(/not found/i);
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: apptB } })).status).toBe('scheduled');
    });
    it('clinic A cannot reschedule clinic B\'s appointment', async () => {
      await expect(svc.reschedule(A, apptB, { date: day, startTime: '10:00' } as any, docA)).rejects.toThrow(/not found/i);
    });
    it('clinic A cannot read clinic B\'s appointment', async () => {
      await expect(svc.findOne(A, apptB)).rejects.toThrow(/not found/i);
    });
    it('clinic A cannot book clinic B\'s patient or clinic B\'s dentist', async () => {
      const base = { date: day, startTime: '09:00', type: 'consultation' } as any;
      await expect(svc.book(A, docA, { ...base, patientId: patB, dentistId: docA })).rejects.toThrow(/Patient not found/);
      await expect(svc.book(A, docA, { ...base, patientId: patA, dentistId: docB })).rejects.toThrow(/Dentist not found/);
    });
    it('clinic A cannot take clinic B\'s slot even with its own patient (slot lookup is clinic-scoped)', async () => {
      await expect(svc.book(A, docA, { date: day, startTime: '10:00', type: 'consultation', patientId: patA, dentistId: docA } as any)).rejects.toThrow(/No available slot/);
    });
    it('the owner clinic can still operate on its own appointment', async () => {
      const r = await svc.updateStatus(B, apptB, { status: 'confirmed' } as any, docB);
      expect(r.status).toBe('confirmed');
    });
  });
});
