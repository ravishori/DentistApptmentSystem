/**
 * Real-PostgreSQL tests for revenue figures, clinic isolation and access storage.
 * Skipped unless TEST_DATABASE_URL is set — use ONLY a disposable database, never dentalease_db.
 */
jest.mock('../../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import { RevenueAccessService } from './revenue-access.service';
import { RevenueAnalyticsService } from './revenue-analytics.service';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Revenue analytics on PostgreSQL', () => {
  const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  const access = new RevenueAccessService(prisma as any);
  const analytics = new RevenueAnalyticsService(prisma as any);
  const stamp = Date.now();
  let A: string, B: string;
  const users: Record<string, string> = {};

  const thisMonth = (day = 10) => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), day, 12); };
  const lastMonth = (day = 10) => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth() - 1, day, 12); };

  async function seedClinic(clinicId: string, tag: string, scale: number) {
    const patient = await prisma.patient.create({ data: { clinicId, patientCode: `${tag}-${stamp}`, fullName: `P ${tag}`, phone: `+9100000${scale}000` } as any });
    const inv = (status: string, total: number, balance: number, createdAt = thisMonth()) => prisma.invoice.create({ data: {
      clinicId, patientId: patient.id, invoiceNumber: `${tag}-${status}-${Math.random().toString(36).slice(2, 8)}`,
      totalAmount: total * scale, balanceAmount: balance * scale, paidAmount: (total - balance) * scale, status, createdAt,
    } as any });
    const paid = await inv('paid', 1500, 0);
    await inv('sent', 700, 700);
    await inv('partially_paid', 500, 250);
    await inv('overdue', 100, 100);
    await inv('draft', 999, 999);          // not issued → never invoiced / outstanding
    await inv('cancelled', 888, 888);      // cancelled → never invoiced / outstanding
    await inv('sent', 400, 400, lastMonth()); // issued last month
    const pay = (status: string, amount: number, paidAt: Date | null, n: string) => prisma.payment.create({ data: {
      clinicId, invoiceId: paid.id, patientId: patient.id, amount: amount * scale, method: 'cash', status, paidAt,
      razorpayPaymentId: `${tag}_${n}_${stamp}`,
    } as any });
    await pay('success', 1000, thisMonth(), 'a');
    await pay('success', 500, thisMonth(3), 'b');
    await pay('refunded', -200, thisMonth(5), 'r');   // refunds are stored negative
    await pay('pending', 300, thisMonth(6), 'p');      // never money received
    await pay('failed', 400, thisMonth(7), 'f');       // never money received
    await pay('success', 250, lastMonth(), 'lm');      // previous month
  }

  beforeAll(async () => {
    const mk = (n: string) => prisma.clinic.create({ data: { name: n, slug: `${n}${stamp}`, email: `${n}${stamp}@rev.test` } as any });
    A = (await mk('reva')).id;
    B = (await mk('revb')).id;
    const mkUser = async (key: string, clinicId: string, role: UserRole) => {
      users[key] = (await prisma.user.create({ data: { clinicId, email: `${key}${stamp}@rev.test`, passwordHash: 'x', fullName: key, role } as any })).id;
    };
    await mkUser('ownerA', A, UserRole.clinic_admin);
    for (let i = 0; i < 8; i++) await mkUser(`staffA${i}`, A, UserRole.receptionist);
    await mkUser('staffB', B, UserRole.receptionist);
    await seedClinic(A, 'A', 1);
    await seedClinic(B, 'B', 10);   // 10× larger so any leakage is unmistakable
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { clinicId: { in: [A, B] } } });
    await prisma.invoice.deleteMany({ where: { clinicId: { in: [A, B] } } });
    await prisma.patient.deleteMany({ where: { clinicId: { in: [A, B] } } });
    await prisma.user.deleteMany({ where: { clinicId: { in: [A, B] } } });
    await prisma.clinic.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.$disconnect();
  });

  describe('financial definitions', () => {
    it('separates collected, refunded, net, invoiced and outstanding for the current month', async () => {
      const t = await analytics.getTrend(A, 3);
      const m = t.months[t.months.length - 1];
      expect(m.collected).toBe(1500);          // 1000 + 500 — pending/failed excluded
      expect(m.refunded).toBe(200);            // positive number, from the negative refund row
      expect(m.net).toBe(1300);                // collected − refunded
      expect(m.invoiced).toBe(2800);           // 1500 + 700 + 500 + 100 (draft & cancelled excluded)
    });

    it('does not mix months', async () => {
      const t = await analytics.getTrend(A, 3);
      const prev = t.months[t.months.length - 2];
      expect(prev.collected).toBe(250);
      expect(prev.refunded).toBe(0);
      expect(prev.invoiced).toBe(400);
      expect(t.months[0]).toMatchObject({ collected: 0, refunded: 0, net: 0, invoiced: 0 });   // dense, gap-free list
    });

    it('outstanding = balance of issued unpaid invoices only, with an overdue breakdown', async () => {
      const t = await analytics.getTrend(A, 3);
      // sent 700 + partially_paid 250 + overdue 100 + sent(last month) 400; draft/cancelled/paid excluded
      expect(t.outstanding).toEqual({ total: 1450, overdue: 100, openInvoices: 4 });
    });

    it('totals equal the sum of the months', async () => {
      const t = await analytics.getTrend(A, 6);
      expect(t.totals.collected).toBe(1750);
      expect(t.totals.refunded).toBe(200);
      expect(t.totals.net).toBe(1550);
      expect(t.totals.net).toBe(Math.round((t.totals.collected - t.totals.refunded) * 100) / 100);
    });

    it('clamps absurd month counts', async () => {
      expect((await analytics.getTrend(A, 100000)).months).toHaveLength(36);
      expect((await analytics.getTrend(A, -4)).months).toHaveLength(1);
    });
  });

  describe('clinic isolation', () => {
    it("clinic B's figures are 10× and never bleed into clinic A (and vice-versa)", async () => {
      const a = await analytics.getTrend(A, 3);
      const b = await analytics.getTrend(B, 3);
      expect(a.months[a.months.length - 1].collected).toBe(1500);
      expect(b.months[b.months.length - 1].collected).toBe(15000);
      expect(b.outstanding.total).toBe(14500);
      expect(a.outstanding.total).toBe(1450);
    });

    it('an unknown clinic id sees nothing', async () => {
      const t = await analytics.getTrend('00000000-0000-0000-0000-000000000000', 3);
      expect(t.totals).toEqual({ collected: 0, refunded: 0, net: 0, invoiced: 0 });
      expect(t.outstanding).toEqual({ total: 0, overdue: 0, openInvoices: 0 });
    });

    it('owner of A cannot grant access to a user of clinic B, nor list B staff', async () => {
      await expect(access.setAccess(A, users.staffB, true)).rejects.toThrow(NotFoundException);
      const listed = await access.listStaff(A);
      expect(listed.map((s) => s.id)).not.toContain(users.staffB);
      expect(listed.map((s) => s.id)).not.toContain(users.ownerA);
    });
  });

  describe('access storage (atomic, clinic-scoped)', () => {
    it('grants default to none; grant → canView; revoke → denied', async () => {
      const v = { id: users.staffA0, role: UserRole.receptionist, clinicId: A };
      expect(await access.canView(v)).toBe(false);
      await access.setAccess(A, users.staffA0, true);
      expect(await access.canView(v)).toBe(true);
      await access.setAccess(A, users.staffA0, false);
      expect(await access.canView(v)).toBe(false);
    });

    it('a grant in clinic A never authorises that user id in clinic B', async () => {
      await access.setAccess(A, users.staffA1, true);
      expect(await access.canView({ id: users.staffA1, role: UserRole.receptionist, clinicId: B })).toBe(false);
    });

    it('owners cannot be "granted" (always have access) and deactivation voids a grant', async () => {
      await expect(access.setAccess(A, users.ownerA, true)).rejects.toThrow(BadRequestException);
      await access.setAccess(A, users.staffA2, true);
      await prisma.user.update({ where: { id: users.staffA2 }, data: { isActive: false } });
      expect(await access.canView({ id: users.staffA2, role: UserRole.receptionist, clinicId: A })).toBe(false);
      await expect(access.setAccess(A, users.staffA2, true)).rejects.toThrow(NotFoundException);   // inactive targets rejected
    });

    it('6 concurrent grants all persist (no lost update) and unrelated clinic settings survive', async () => {
      await prisma.clinic.update({ where: { id: A }, data: { settings: { keepMe: { nested: 42 }, revenueAccess: {} } } });
      const ids = [3, 4, 5, 6, 7].map((i) => users[`staffA${i}`]);
      await Promise.all(ids.map((id) => access.setAccess(A, id, true)));
      const settings: any = (await prisma.clinic.findUniqueOrThrow({ where: { id: A } })).settings;
      for (const id of ids) expect(settings.revenueAccess[id]).toBe(true);
      expect(settings.keepMe).toEqual({ nested: 42 });
    });

    it('dashboard preference is per user, atomic under concurrency, and does not touch grants', async () => {
      await access.setAccess(A, users.staffA3, true);
      const owner = { id: users.ownerA, role: UserRole.clinic_admin, clinicId: A };
      const staff = { id: users.staffA3, role: UserRole.receptionist, clinicId: A };
      expect(await access.showOnDashboard(owner)).toBe(false);          // default hidden
      await Promise.all([access.setDashboardPreference(owner, true), access.setDashboardPreference(staff, true)]);
      expect(await access.showOnDashboard(owner)).toBe(true);
      expect(await access.showOnDashboard(staff)).toBe(true);
      await access.setDashboardPreference(owner, false);
      expect(await access.showOnDashboard(owner)).toBe(false);
      expect(await access.showOnDashboard(staff)).toBe(true);           // other user's pref untouched
      expect(await access.canView(staff)).toBe(true);                   // grants untouched
    });

    it('preference is ignored (false) once access is revoked', async () => {
      const staff = { id: users.staffA4, role: UserRole.receptionist, clinicId: A };
      await access.setAccess(A, users.staffA4, true);
      await access.setDashboardPreference(staff, true);
      await access.setAccess(A, users.staffA4, false);
      expect(await access.showOnDashboard(staff)).toBe(false);
    });
  });
});
