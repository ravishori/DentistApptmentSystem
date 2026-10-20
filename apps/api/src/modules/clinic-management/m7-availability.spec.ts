jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { DoctorAvailabilityService } from './doctor-availability.service';

const rule = (o: any = {}) => ({
  id: 'r1', clinicId: 'c1', dentistId: 'd1', dayOfWeek: 'monday',
  startTime: '09:00', endTime: '12:00', slotMins: 30, isActive: true,
  validFrom: null, validUntil: null, ...o,
});

function mk(rules: any[] = [], overrides: any[] = []) {
  const created: any[] = [];
  const prisma: any = {
    user: { findFirst: async ({ where }: any) => (where.clinicId === 'c1' ? { id: where.id } : null) },
    chair: { findFirst: async ({ where }: any) => (where.clinicId === 'c1' ? { id: where.id } : null) },
    doctorAvailability: {
      findMany: async ({ where }: any = {}) => rules.filter(r => !where?.id?.not || r.id !== where.id.not),
      findFirst: async ({ where }: any) => rules.find(r => r.id === where.id && where.clinicId === 'c1') ?? null,
      create: async ({ data }: any) => data,
      update: async ({ data }: any) => data,
    },
    doctorSchedule: { findMany: async () => overrides, upsert: async (a: any) => a.create },
    appointmentSlot: {
      findUnique: async () => null,
      create: async ({ data }: any) => { created.push(data); },
    },
  };
  return { svc: new DoctorAvailabilityService(prisma, {} as any), created };
}
const create = (o: any = {}) =>
  ({ dentistId: 'd1', dayOfWeek: 'monday', startTime: '09:00', endTime: '12:00', slotMins: 30, ...o } as any);

describe('availability rules', () => {
  it('creates a valid rule', async () => {
    await expect(mk().svc.createAvailability('c1', create())).resolves.toBeDefined();
  });

  it('rejects end<=start, bad time, window shorter than a slot, bad slotMins', async () => {
    const { svc } = mk();
    await expect(svc.createAvailability('c1', create({ endTime: '09:00' }))).rejects.toThrow();
    await expect(svc.createAvailability('c1', create({ startTime: '25:00' }))).rejects.toThrow();
    await expect(svc.createAvailability('c1', create({ endTime: '09:20' }))).rejects.toThrow(/shorter/);
    await expect(svc.createAvailability('c1', create({ slotMins: 5 }))).rejects.toThrow();
  });

  it('rejects validFrom > validUntil', async () => {
    await expect(mk().svc.createAvailability('c1', create({ validFrom: '2026-12-01', validUntil: '2026-11-01' })))
      .rejects.toThrow();
  });

  it('rejects overlap; allows adjacent times and disjoint validity', async () => {
    const { svc } = mk([rule()]);
    await expect(svc.createAvailability('c1', create({ startTime: '11:00', endTime: '14:00' }))).rejects.toThrow(/Overlaps/);
    await expect(svc.createAvailability('c1', create({ startTime: '12:00', endTime: '14:00' }))).resolves.toBeDefined();
    const s2 = mk([rule({ validUntil: new Date('2026-06-30') })]).svc;
    await expect(s2.createAvailability('c1', create({ validFrom: '2026-07-01' }))).resolves.toBeDefined();
  });

  it('tenant isolation on dentist and rule', async () => {
    const { svc } = mk([rule()]);
    await expect(svc.createAvailability('c2', create())).rejects.toThrow(/not found/i);
    await expect(svc.updateAvailability('c2', 'r1', { slotMins: 20 })).rejects.toThrow(/not found/i);
  });

  it('update validates merged values', async () => {
    const { svc } = mk([rule()]);
    await expect(svc.updateAvailability('c1', 'r1', { endTime: '08:00' })).rejects.toThrow();
    await expect(svc.updateAvailability('c1', 'r1', { slotMins: 60 })).resolves.toBeDefined();
  });
});

describe('overrides & ranges', () => {
  it('working override needs times; tenant isolated', async () => {
    const { svc } = mk();
    await expect(svc.createOverride('c1', { dentistId: 'd1', date: '2026-11-02', type: 'working' } as any)).rejects.toThrow();
    await expect(svc.createOverride('c1', { dentistId: 'd1', date: '2026-11-02', type: 'leave' } as any)).resolves.toBeDefined();
    await expect(svc.createOverride('c2', { dentistId: 'd1', date: '2026-11-02', type: 'leave' } as any)).rejects.toThrow();
  });

  it('rejects inverted and oversized date ranges', async () => {
    const { svc } = mk([rule()]);
    await expect(svc.generateSlots('c1', { dentistId: 'd1', from: '2026-11-10', to: '2026-11-01' } as any)).rejects.toThrow();
    await expect(svc.generateSlots('c1', { dentistId: 'd1', from: '2026-01-01', to: '2026-12-31' } as any)).rejects.toThrow(/exceed/);
  });
});

describe('generateSlots', () => {
  const gen = async (rules: any[], overrides: any[] = []) => {
    const { svc, created } = mk(rules, overrides);
    const r = await svc.generateSlots('c1', { dentistId: 'd1', from: '2026-11-02', to: '2026-11-02' } as any);
    return { r, created };
  };

  it('Monday window yields 6 slots ending on boundary', async () => {
    const { r, created } = await gen([rule()]);
    expect(r.created).toBe(6);
    expect(created[5].endTime).toBe('12:00');
  });

  it('leave override yields no slots', async () => {
    const { r } = await gen([rule()], [{ date: new Date('2026-11-02'), type: 'leave' }]);
    expect(r.created).toBe(0);
  });

  it('working override replaces hours without duplicating per rule', async () => {
    const { r } = await gen(
      [rule(), rule({ id: 'r2', startTime: '14:00', endTime: '17:00' })],
      [{ date: new Date('2026-11-02'), type: 'working', startTime: '10:00', endTime: '11:00' }],
    );
    expect(r.created).toBe(2);
  });
});
