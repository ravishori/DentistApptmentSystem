/**
 * Real-PostgreSQL tests for the slot manager and cancellation/reschedule from the appointment UI. Skipped unless
 * TEST_DATABASE_URL is set. Use a DISPOSABLE database whose schema was created with:
 *   DATABASE_URL=$TEST_DATABASE_URL npx prisma db push --schema=../../database/schema.prisma
 * Run: TEST_DATABASE_URL=postgresql://... npx jest slots-manage.int
 */
jest.mock('../../cache/cache.service', () => ({
  CacheService: { keys: { slots: (...a: string[]) => a.join(':') } },
}), { virtual: true });
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { PrismaClient } from '@prisma/client';
import { AppointmentsService } from './appointments.service';
import { SlotsService } from './slots.service';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Slot manager and appointment UI actions on PostgreSQL', () => {
  const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  const cache: any = { del: async () => undefined, wrap: (_k: string, fn: () => unknown) => fn() };
  const slotsSvc = new SlotsService(prisma as any, cache);
  const apptSvc = new AppointmentsService(prisma as any, cache, { emit: () => true } as any);
  const day = '2031-04-07';
  let c1: string, c2: string, dentist: string, dentist2: string, patient: string, actor: string;
  let free: string, booked: string, blocked: string, spare: string;

  beforeAll(async () => {
    const mkClinic = (n: string) => prisma.clinic.create({ data: { name: n, slug: n + Date.now(), email: n + Date.now() + '@slotmgr.test' } as any });
    c1 = (await mkClinic('sma')).id;
    c2 = (await mkClinic('smb')).id;
    const mkUser = (clinicId: string, n: string) => prisma.user.create({ data: { clinicId, email: `${n}-${Date.now()}@slotmgr.test`, passwordHash: 'x', fullName: `Dr ${n}`, role: 'dentist' } as any });
    dentist = actor = (await mkUser(c1, 'one')).id;
    dentist2 = (await mkUser(c2, 'two')).id;
    patient = (await prisma.patient.create({ data: { clinicId: c1, patientCode: 'SM-' + Date.now(), fullName: 'P One', phone: '+910000000099' } as any })).id;
  });

  beforeEach(async () => {
    await prisma.appointment.deleteMany({ where: { clinicId: { in: [c1, c2] } } });
    await prisma.appointmentSlot.deleteMany({ where: { clinicId: { in: [c1, c2] } } });
    const mk = (clinicId: string, dentistId: string, s: string, e: string, extra: object = {}) =>
      prisma.appointmentSlot.create({ data: { clinicId, dentistId, slotDate: new Date(day), startTime: s, endTime: e, ...extra } as any }).then((x) => x.id);
    free = await mk(c1, dentist, '09:00:00', '09:30:00');
    booked = await mk(c1, dentist, '09:30:00', '10:00:00');
    blocked = await mk(c1, dentist, '10:00:00', '10:30:00', { isBlocked: true, blockReason: 'Leave' });
    spare = await mk(c1, dentist, '10:30:00', '11:00:00');
    await mk(c2, dentist2, '09:00:00', '09:30:00');           // another clinic's slot on the same day
    await apptSvc.book(c1, actor, { patientId: patient, dentistId: dentist, date: day, startTime: '09:30', type: 'consultation' } as any);
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { clinicId: { in: [c1, c2] } } });
    await prisma.appointmentSlot.deleteMany({ where: { clinicId: { in: [c1, c2] } } });
    await prisma.patient.deleteMany({ where: { clinicId: c1 } });
    await prisma.user.deleteMany({ where: { clinicId: { in: [c1, c2] } } });
    await prisma.clinic.deleteMany({ where: { id: { in: [c1, c2] } } });
    await prisma.$disconnect();
  });

  it('listForDay returns free, booked and blocked slots in time order, with reasons', async () => {
    const rows = await slotsSvc.listForDay(c1, dentist, day);
    expect(rows.map((r) => [r.startTime.slice(0, 5), r.isBooked, r.isBlocked, r.blockReason])).toEqual([
      ['09:00', false, false, null], ['09:30', true, false, null], ['10:00', false, true, 'Leave'], ['10:30', false, false, null],
    ]);
  });

  it('listForDay is clinic-scoped: clinic B cannot read clinic A\'s slots, even by dentist id', async () => {
    expect(await slotsSvc.listForDay(c2, dentist, day)).toEqual([]);
    expect((await slotsSvc.listForDay(c2, dentist2, day))).toHaveLength(1);
  });

  it('block → the slot disappears from free slots and shows as blocked; unblock restores it', async () => {
    await slotsSvc.block(c1, { slotId: free, reason: 'Training' });
    expect((await slotsSvc.getAvailable(c1, dentist, day)).map((s: any) => s.id)).not.toContain(free);
    expect((await slotsSvc.listForDay(c1, dentist, day)).find((s) => s.id === free)).toMatchObject({ isBlocked: true, blockReason: 'Training' });
    await slotsSvc.unblock(c1, free);
    expect((await slotsSvc.getAvailable(c1, dentist, day)).map((s: any) => s.id)).toContain(free);
    expect((await slotsSvc.listForDay(c1, dentist, day)).find((s) => s.id === free)).toMatchObject({ isBlocked: false, blockReason: null });
  });

  it('a booked slot cannot be blocked and stays booked', async () => {
    await expect(slotsSvc.block(c1, { slotId: booked, reason: 'x' })).rejects.toThrow(/already-booked/i);
    expect((await prisma.appointmentSlot.findUnique({ where: { id: booked } }))!.isBlocked).toBe(false);
  });

  it('clinic B cannot block or unblock clinic A\'s slots; the data is unchanged', async () => {
    await expect(slotsSvc.block(c2, { slotId: free, reason: 'x' })).rejects.toThrow(/not found/i);
    await expect(slotsSvc.unblock(c2, blocked)).rejects.toThrow(/not found/i);
    expect(await prisma.appointmentSlot.findUnique({ where: { id: free } })).toMatchObject({ isBlocked: false });
    expect(await prisma.appointmentSlot.findUnique({ where: { id: blocked } })).toMatchObject({ isBlocked: true, blockReason: 'Leave' });
  });

  it('cancelling with a reason releases the slot (it shows as free again) and records who and why', async () => {
    const appt = await prisma.appointment.findFirstOrThrow({ where: { clinicId: c1, slotId: booked } });
    await apptSvc.updateStatus(c1, appt.id, { status: 'cancelled', reason: 'Patient called' } as any, actor);
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(after).toMatchObject({ status: 'cancelled', cancelReason: 'Patient called', cancelledById: actor, slotId: null });
    expect((await slotsSvc.listForDay(c1, dentist, day)).find((s) => s.id === booked)).toMatchObject({ isBooked: false, isBlocked: false });
  });

  it('reschedule into a blocked slot is refused and leaves both slots as they were', async () => {
    const appt = await prisma.appointment.findFirstOrThrow({ where: { clinicId: c1, slotId: booked } });
    await expect(apptSvc.reschedule(c1, appt.id, { date: day, startTime: '10:00' } as any, actor)).rejects.toThrow(/not available/i);
    expect((await prisma.appointmentSlot.findUnique({ where: { id: booked } }))!.isBooked).toBe(true);
    expect((await prisma.appointmentSlot.findUnique({ where: { id: blocked } }))!.isBooked).toBe(false);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe('scheduled');
  });

  it('reschedule to a free slot moves the booking: old slot freed, new slot claimed, new row linked to the old one', async () => {
    const appt = await prisma.appointment.findFirstOrThrow({ where: { clinicId: c1, slotId: booked } });
    const moved = await apptSvc.reschedule(c1, appt.id, { date: day, startTime: '10:30', reason: 'Patient asked' } as any, actor);
    expect((moved as any).rescheduledFromId).toBe(appt.id);
    expect((await prisma.appointmentSlot.findUnique({ where: { id: booked } }))!.isBooked).toBe(false);
    expect((await prisma.appointmentSlot.findUnique({ where: { id: spare } }))!.isBooked).toBe(true);
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).toMatchObject({ status: 'rescheduled', cancelReason: 'Patient asked', cancelledById: actor });
  });

  it('clinic B cannot cancel or reschedule clinic A\'s appointment', async () => {
    const appt = await prisma.appointment.findFirstOrThrow({ where: { clinicId: c1, slotId: booked } });
    await expect(apptSvc.updateStatus(c2, appt.id, { status: 'cancelled', reason: 'x' } as any, actor)).rejects.toThrow(/not found/i);
    await expect(apptSvc.reschedule(c2, appt.id, { date: day, startTime: '10:30' } as any, actor)).rejects.toThrow(/not found/i);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe('scheduled');
  });

  it('a completed or already-cancelled appointment cannot be cancelled or rescheduled', async () => {
    const appt = await prisma.appointment.findFirstOrThrow({ where: { clinicId: c1, slotId: booked } });
    await apptSvc.updateStatus(c1, appt.id, { status: 'cancelled', reason: 'first' } as any, actor);
    await expect(apptSvc.updateStatus(c1, appt.id, { status: 'cancelled', reason: 'again' } as any, actor)).rejects.toThrow();
    await expect(apptSvc.reschedule(c1, appt.id, { date: day, startTime: '10:30' } as any, actor)).rejects.toThrow(/Only scheduled or confirmed/i);
  });
});
