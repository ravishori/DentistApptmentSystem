/**
 * Real-PostgreSQL tests for PatientsService: clinic statistics, tenant scoping and mass-assignment protection.
 * Skipped unless TEST_DATABASE_URL is set. Use ONLY a disposable database, never dentalease_db.
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { PrismaClient } from '@prisma/client';
import { PatientsService } from './patients.service';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('PatientsService on PostgreSQL', () => {
  const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  const svc = new PatientsService(prisma as any, {} as any);
  const stamp = Date.now();
  let A: string, B: string, victim: string;
  const day = (offset: number) => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime() + offset * 86_400_000;

  beforeAll(async () => {
    A = (await prisma.clinic.create({ data: { name: 'pa', slug: `pa${stamp}`, email: `pa${stamp}@p.test` } as any })).id;
    B = (await prisma.clinic.create({ data: { name: 'pb', slug: `pb${stamp}`, email: `pb${stamp}@p.test` } as any })).id;
    const mk = (clinicId: string, tag: string, extra: any = {}) =>
      prisma.patient.create({ data: { clinicId, patientCode: `${tag}-${stamp}`, fullName: tag, phone: `+9100000${Math.floor(Math.random() * 1e5)}${tag.length}`, ...extra } as any });
    victim = (await mk(A, 'recent', { lastVisitDate: new Date(day(-5)), outstandingBalance: 1000 })).id;
    await mk(A, 'old', { lastVisitDate: new Date(day(-90)), outstandingBalance: 250.5 });
    await mk(A, 'never', {});
    await mk(B, 'other-clinic', { lastVisitDate: new Date(day(-1)), outstandingBalance: 99999 });
  });

  afterAll(async () => {
    await prisma.patient.deleteMany({ where: { clinicId: { in: [A, B] } } });
    await prisma.clinic.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.$disconnect();
  });

  describe('getStats', () => {
    it('counts only the caller\'s clinic: total, new this month, active in 30 days, outstanding sum', async () => {
      const s = await svc.getStats(A);
      expect(s.total).toBe(3);
      expect(s.newThisMonth).toBe(3);                    // all created now
      expect(s.active).toBe(1);                          // only the one seen 5 days ago
      expect(s.totalOutstanding).toBeCloseTo(1250.5, 2);
    });
    it('another clinic gets its own numbers, never a sum across tenants', async () => {
      const s = await svc.getStats(B);
      expect(s).toMatchObject({ total: 1, newThisMonth: 1, active: 1 });
      expect(s.totalOutstanding).toBeCloseTo(99999, 2);
    });
    it('"new this month" and "active" respect the clock', async () => {
      const later = new Date(Date.now() + 70 * 86_400_000);
      const s = await svc.getStats(A, later);
      expect(s.newThisMonth).toBe(0);                    // created in an earlier month relative to the injected clock
      expect(s.active).toBe(0);                          // last visit > 30 days before the injected clock
    });
    it('an empty clinic returns zeros, not nulls', async () => {
      const empty = (await prisma.clinic.create({ data: { name: 'pe', slug: `pe${stamp}`, email: `pe${stamp}@p.test` } as any })).id;
      try { expect(await svc.getStats(empty)).toEqual({ total: 0, newThisMonth: 0, active: 0, totalOutstanding: 0 }); }
      finally { await prisma.clinic.delete({ where: { id: empty } }); }
    });
  });

  describe('update', () => {
    it('writes profile fields', async () => {
      const r = await svc.update(A, victim, { fullName: 'Renamed', city: 'Pune', waOptIn: true } as any);
      expect(r).toMatchObject({ fullName: 'Renamed', city: 'Pune', waOptIn: true });
    });
    it('MASS ASSIGNMENT: even if protected fields reach the service they are never written', async () => {
      const before = await prisma.patient.findUniqueOrThrow({ where: { id: victim } });
      await svc.update(A, victim, {
        fullName: 'Still Renamed', clinicId: B, outstandingBalance: 0, patientCode: 'HACKED', totalVisits: 500, isActive: false, id: B,
      } as any);
      const after = await prisma.patient.findUniqueOrThrow({ where: { id: victim } });
      expect(after.fullName).toBe('Still Renamed');
      expect(after.clinicId).toBe(A);
      expect(Number(after.outstandingBalance)).toBe(Number(before.outstandingBalance));
      expect(after.patientCode).toBe(before.patientCode);
      expect(after.totalVisits).toBe(before.totalVisits);
      expect(after.isActive).toBe(before.isActive);
    });
    it('CROSS-CLINIC: clinic B cannot update clinic A\'s patient (404, row untouched)', async () => {
      await expect(svc.update(B, victim, { fullName: 'Pwned' } as any)).rejects.toThrow(/not found/i);
      expect((await prisma.patient.findUniqueOrThrow({ where: { id: victim } })).fullName).toBe('Still Renamed');
    });
    it('emergencyContact is refused rather than silently dropped', async () => {
      await expect(svc.update(A, victim, { emergencyContact: 'x' } as any)).rejects.toThrow(/emergencyContact/);
    });
  });
});
