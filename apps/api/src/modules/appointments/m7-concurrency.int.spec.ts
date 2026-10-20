/**
 * Real-PostgreSQL concurrency tests. Skipped unless TEST_DATABASE_URL is set.
 * Use a DISPOSABLE database whose schema was created with:
 *   DATABASE_URL=$TEST_DATABASE_URL npx prisma db push --schema=../../database/schema.prisma
 * Run: TEST_DATABASE_URL=postgresql://... npx jest m7-concurrency
 */
jest.mock('../../cache/cache.service', () => ({
  CacheService: { keys: { slots: (...a: string[]) => a.join(':') } },
}), { virtual: true });
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { PrismaClient } from '@prisma/client';
import { AppointmentsService } from './appointments.service';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('M7 concurrency on PostgreSQL', () => {
  const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  const cache: any = { del: async () => undefined };
  const svc = new AppointmentsService(prisma as any, cache, { emit: () => true } as any);
  const day = '2031-03-03';
  let c1: string, c2: string, dentist: string, patient: string, user: string, patient2: string;
  const slotIds: string[] = [];

  beforeAll(async () => {
    const mkClinic = (n: string) => prisma.clinic.create({ data: { name: n, slug: n + Date.now(), email: n + Date.now() + '@m7.test' } as any });
    c1 = (await mkClinic('m7a')).id;
    c2 = (await mkClinic('m7b')).id;
    const u = await prisma.user.create({ data: {
      clinicId: c1, email: `m7-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Dr T', role: 'dentist',
    } as any });
    dentist = user = u.id;
    patient = (await prisma.patient.create({ data: { clinicId: c1, patientCode: 'M7-1-' + Date.now(), fullName: 'P One', phone: '+910000000001' } as any })).id;
    patient2 = (await prisma.patient.create({ data: { clinicId: c1, patientCode: 'M7-2-' + Date.now(), fullName: 'P Two', phone: '+910000000002' } as any })).id;
  });

  beforeEach(async () => {
    await prisma.appointment.deleteMany({ where: { clinicId: c1 } });
    await prisma.appointmentSlot.deleteMany({ where: { clinicId: c1 } });
    slotIds.length = 0;
    for (const [s, e] of [['09:00:00', '09:30:00'], ['09:30:00', '10:00:00'], ['10:00:00', '10:30:00']]) {
      slotIds.push((await prisma.appointmentSlot.create({ data: {
        clinicId: c1, dentistId: dentist, slotDate: new Date(day), startTime: s, endTime: e,
      } })).id);
    }
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { clinicId: { in: [c1, c2] } } });
    await prisma.appointmentSlot.deleteMany({ where: { clinicId: { in: [c1, c2] } } });
    await prisma.patient.deleteMany({ where: { clinicId: c1 } });
    await prisma.user.deleteMany({ where: { clinicId: c1 } });
    await prisma.clinic.deleteMany({ where: { id: { in: [c1, c2] } } });
    await prisma.$disconnect();
  });

  const book = (p: string, t = '09:00') => svc.book(c1, user, {
    patientId: p, dentistId: dentist, date: day, startTime: t, type: 'consultation',
  } as any);

  it('10 concurrent bookings of one slot: exactly one succeeds, state consistent', async () => {
    const r = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => book(i % 2 ? patient : patient2)));
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const appts = await prisma.appointment.findMany({ where: { clinicId: c1, status: { notIn: ['cancelled'] } } });
    expect(appts).toHaveLength(1);
    const slot = await prisma.appointmentSlot.findUnique({ where: { id: slotIds[0] } });
    expect(slot!.isBooked).toBe(true);
    expect(appts[0].slotId).toBe(slotIds[0]);
  });

  it('concurrent reschedules of two appointments into one slot: one wins, loser keeps original', async () => {
    const a = await book(patient, '09:00');
    const b = await book(patient2, '09:30');
    const r = await Promise.allSettled([
      svc.reschedule(c1, a.id, { date: day, startTime: '10:00' } as any, user),
      svc.reschedule(c1, b.id, { date: day, startTime: '10:00' } as any, user),
    ]);
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const live = await prisma.appointment.findMany({ where: { clinicId: c1, status: { notIn: ['cancelled', 'rescheduled'] } } });
    expect(live).toHaveLength(2);
    expect(new Set(live.map(x => x.slotId)).size).toBe(2);
    const booked = await prisma.appointmentSlot.count({ where: { clinicId: c1, isBooked: true } });
    expect(booked).toBe(2);
  });

  it('cancel releases slot and allows rebooking; double cancel is rejected', async () => {
    const a = await book(patient);
    await svc.updateStatus(c1, a.id, { status: 'cancelled', reason: 't' } as any, user);
    expect((await prisma.appointmentSlot.findUnique({ where: { id: slotIds[0] } }))!.isBooked).toBe(false);
    await expect(svc.updateStatus(c1, a.id, { status: 'cancelled' } as any, user)).rejects.toThrow();
    await expect(book(patient2)).resolves.toBeDefined();
  });

  it('blocked slot cannot be booked and stays blocked', async () => {
    await prisma.appointmentSlot.update({ where: { id: slotIds[0] }, data: { isBlocked: true } });
    await expect(book(patient)).rejects.toThrow();
    expect((await prisma.appointmentSlot.findUnique({ where: { id: slotIds[0] } }))!.isBlocked).toBe(true);
  });

  it('tenant isolation: other clinic cannot book, cancel or reschedule', async () => {
    const a = await book(patient);
    await expect(svc.book(c2, user, { patientId: patient, dentistId: dentist, date: day, startTime: '09:30', type: 'consultation' } as any))
      .rejects.toThrow();
    await expect(svc.updateStatus(c2, a.id, { status: 'cancelled' } as any, user)).rejects.toThrow();
    await expect(svc.reschedule(c2, a.id, { date: day, startTime: '09:30' } as any, user)).rejects.toThrow();
  });
});
