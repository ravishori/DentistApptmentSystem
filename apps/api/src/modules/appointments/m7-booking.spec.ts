jest.mock('../../cache/cache.service', () => ({
  CacheService: { keys: { slots: (...a: string[]) => a.join(':') } },
}), { virtual: true });
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { AppointmentsService } from './appointments.service';
import { SlotsService } from './slots.service';

// Minimal in-memory Prisma fake with atomic updateMany semantics.
function makeDb() {
  const mkSlot = (id: string, st: string, en: string) => ({
    id, clinicId: 'c1', dentistId: 'd1', slotDate: new Date('2026-11-02'),
    startTime: st, endTime: en, isBooked: false, isBlocked: false,
  });
  const slots: any[] = [mkSlot('s1', '09:00:00', '09:30:00'), mkSlot('s2', '09:30:00', '10:00:00')];
  const appts: any[] = [];
  const match = (o: any, w: any) => Object.entries(w).every(([k, v]) =>
    v === undefined || (v instanceof Date ? +o[k] === +v : typeof v === 'object' && v !== null ? true : o[k] === v));
  const api: any = {
    patient: {
      findFirst: async ({ where }: any) => (where.clinicId === 'c1' ? { id: where.id } : null),
      update: async () => ({}),
    },
    user: { findFirst: async ({ where }: any) => (where.clinicId === 'c1' ? { id: where.id } : null) },
    appointmentSlot: {
      findFirst: async ({ where }: any) => slots.find(s => match(s, where)) ?? null,
      updateMany: async ({ where, data }: any) => {
        const hit = slots.filter(s => match(s, where));
        hit.forEach(s => Object.assign(s, data));
        return { count: hit.length };
      },
      update: async ({ where, data }: any) => Object.assign(slots.find(s => s.id === where.id), data),
    },
    appointment: {
      findFirst: async ({ where }: any) => appts.find(a => a.id === where.id && a.clinicId === where.clinicId)
        ?? (where.id ? null : null),
      create: async ({ data }: any) => {
        const a = { id: 'a' + (appts.length + 1), status: 'scheduled', ...data };
        appts.push(a);
        return a;
      },
      update: async ({ where, data }: any) => Object.assign(appts.find(a => a.id === where.id), data),
    },
    $transaction: async (fn: any) => fn(api),
  };
  return { api, slots, appts };
}
const cache: any = { del: jest.fn(), wrap: jest.fn() };
const emitter: any = { emit: jest.fn() };
const dto = (t = '09:00') =>
  ({ patientId: 'p1', dentistId: 'd1', date: '2026-11-02', startTime: t, type: 'checkup' } as any);

describe('M7 booking consistency', () => {
  it('concurrent bookings of the same slot: exactly one wins', async () => {
    const { api } = makeDb();
    const svc = new AppointmentsService(api, cache, emitter);
    const r = await Promise.allSettled([svc.book('c1', 'u1', dto()), svc.book('c1', 'u2', dto())]);
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.filter(x => x.status === 'rejected')).toHaveLength(1);
  });

  it('rejects other-tenant booking', async () => {
    const { api } = makeDb();
    await expect(new AppointmentsService(api, cache, emitter).book('c2', 'u', dto())).rejects.toThrow(/not found/i);
  });

  it('cancel releases slot; slot can be rebooked', async () => {
    const { api, slots } = makeDb();
    const svc = new AppointmentsService(api, cache, emitter);
    const a = await svc.book('c1', 'u1', dto());
    expect(slots[0].isBooked).toBe(true);
    await svc.updateStatus('c1', a.id, { status: 'cancelled', reason: 'x' } as any, 'u1');
    expect(slots[0].isBooked).toBe(false);
    await expect(svc.book('c1', 'u1', dto())).resolves.toBeDefined();
  });

  it('reschedule moves booking: old released, new claimed', async () => {
    const { api, slots } = makeDb();
    const svc = new AppointmentsService(api, cache, emitter);
    const a = await svc.book('c1', 'u1', dto());
    await svc.reschedule('c1', a.id, { date: '2026-11-02', startTime: '09:30' } as any, 'u1');
    expect(slots.map(s => s.isBooked)).toEqual([false, true]);
  });

  it('reschedule into a blocked slot fails and leaves state intact', async () => {
    const { api, slots } = makeDb();
    const svc = new AppointmentsService(api, cache, emitter);
    const a = await svc.book('c1', 'u1', dto());
    slots[1].isBlocked = true;
    await expect(svc.reschedule('c1', a.id, { date: '2026-11-02', startTime: '09:30' } as any, 'u1')).rejects.toThrow();
    expect(slots[0].isBooked).toBe(true);
  });

  it('reschedule to same slot rejected', async () => {
    const { api } = makeDb();
    const svc = new AppointmentsService(api, cache, emitter);
    const a = await svc.book('c1', 'u1', dto());
    await expect(svc.reschedule('c1', a.id, { date: '2026-11-02', startTime: '09:00' } as any, 'u1'))
      .rejects.toThrow();
  });

  it('other tenant cannot cancel/reschedule', async () => {
    const { api } = makeDb();
    const svc = new AppointmentsService(api, cache, emitter);
    const a = await svc.book('c1', 'u1', dto());
    await expect(svc.updateStatus('c2', a.id, { status: 'cancelled' } as any, 'u')).rejects.toThrow(/not found/i);
    await expect(svc.reschedule('c2', a.id, { date: '2026-11-02', startTime: '09:30' } as any, 'u')).rejects.toThrow(/not found/i);
  });
});

describe('SlotsService.generate', () => {
  const mk = () => {
    const created: any[] = [];
    const prisma: any = {
      user: { findFirst: async () => ({ id: 'd1' }) },
      appointmentSlot: { deleteMany: jest.fn(), createMany: async ({ data }: any) => { created.push(...data); } },
    };
    return { svc: new SlotsService(prisma, cache), created };
  };
  const base = { dentistId: 'd1', date: '2026-11-02', workStart: '09:00', workEnd: '12:00', slotDuration: 30 } as any;

  it('skips break and honours boundaries', async () => {
    const { svc, created } = mk();
    await svc.generate('c1', { ...base, breakStart: '10:00', breakEnd: '11:00' });
    expect(created.map(s => s.startTime)).toEqual(['09:00:00', '09:30:00', '11:00:00', '11:30:00']);
    expect(created[created.length - 1].endTime).toBe('12:00:00');
  });

  it('rejects end<=start, inverted and half-specified breaks', async () => {
    const { svc } = mk();
    await expect(svc.generate('c1', { ...base, workEnd: '09:00' })).rejects.toThrow();
    await expect(svc.generate('c1', { ...base, breakStart: '11:00', breakEnd: '10:00' })).rejects.toThrow();
    await expect(svc.generate('c1', { ...base, breakStart: '11:00' })).rejects.toThrow();
  });
});
