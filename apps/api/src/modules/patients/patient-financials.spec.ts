jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });
jest.mock('../../cache/cache.service', () => ({ CacheService: { keys: {} } }), { virtual: true });

import { UserRole } from '@prisma/client';
import { PatientsController } from './patients.controller';
import {
  redactPatientDetail, redactPatientList, redactPatientTimeline, FINANCIALS_RESTRICTED,
} from './patient-financials';

const detail = {
  id: 'p1', fullName: 'Asha Rao', phone: '+919999999999', outstandingBalance: 4400,
  appointments: [{ id: 'a1', estimatedCost: 1800, startTime: '10:00:00', dentist: { fullName: 'Dr R' } }],
  invoices: [{ id: 'i1', invoiceNumber: 'INV-1', totalAmount: 2500, status: 'sent' }],
  familyMemberships: [],
};
const list = { items: [{ id: 'p1', fullName: 'Asha', outstandingBalance: 4400, totalVisits: 3 }, { id: 'p2', fullName: 'Ravi', outstandingBalance: 0, totalVisits: 1 }], total: 2, page: 1, limit: 20, pages: 1 };
const timeline = {
  appointments: [{ id: 'a1', estimatedCost: 1800, treatments: [{ id: 't1', toothNumber: 11, unitPrice: 900, discountPct: 10, procedure: { name: 'Filling' } }] }],
  invoices: [{ id: 'i1', invoiceNumber: 'INV-1', totalAmount: 2500, paidAmount: 100, status: 'partially_paid' }],
};
const text = (v: unknown) => JSON.stringify(v);

describe('redactors remove money (never zero it) and keep clinical/operational data', () => {
  it('detail: balance, invoices and prices gone; everything else kept; flagged', () => {
    const out: any = redactPatientDetail(detail);
    expect(text(out)).not.toMatch(/4400|2500|1800|outstandingBalance|invoices|estimatedCost/);
    expect(out).toMatchObject({ id: 'p1', fullName: 'Asha Rao', phone: '+919999999999' });
    expect(out.appointments[0]).toMatchObject({ id: 'a1', startTime: '10:00:00' });
    expect(out[FINANCIALS_RESTRICTED]).toBe(true);
    expect(detail.outstandingBalance).toBe(4400);                       // input not mutated
  });
  it('list: every patient loses outstandingBalance (including the genuine 0)', () => {
    const out: any = redactPatientList(list);
    expect(out.items.every((p: any) => !('outstandingBalance' in p))).toBe(true);
    expect(out.items.map((p: any) => p.fullName)).toEqual(['Asha', 'Ravi']);
    expect(out).toMatchObject({ total: 2, page: 1, pages: 1 });
  });
  it('timeline: invoice history emptied, treatment prices and estimated costs removed, clinical fields kept', () => {
    const out: any = redactPatientTimeline(timeline);
    expect(out.invoices).toEqual([]);
    expect(text(out)).not.toMatch(/2500|1800|900|unitPrice|discountPct|estimatedCost/);
    expect(out.appointments[0].treatments[0]).toMatchObject({ toothNumber: 11, procedure: { name: 'Filling' } });
  });
});

describe('PatientsController: who sees patient-level money', () => {
  const ctrl = new PatientsController({
    findAll: async () => list, findOne: async () => detail, getTimeline: async () => timeline,
  } as any);
  const req = (role: UserRole) => ({ user: { id: 'u', role, clinicId: 'c1' } } as any);

  it.each([UserRole.clinic_admin, UserRole.super_admin, UserRole.receptionist, UserRole.dentist])('%s (holds billing:read) sees balances, invoices and prices', async (role) => {
    expect(((await ctrl.findAll('c1', req(role), {} as any)) as any).items[0].outstandingBalance).toBe(4400);
    expect(((await ctrl.findOne('c1', req(role), 'p1')) as any).invoices).toHaveLength(1);
    expect(((await ctrl.getTimeline('c1', req(role), 'p1')) as any).invoices).toHaveLength(1);
  });

  it('assistant (no billing permission) gets the patient record with NO financial data anywhere', async () => {
    const r = req(UserRole.assistant);
    const l: any = await ctrl.findAll('c1', r, {} as any);
    const d: any = await ctrl.findOne('c1', r, 'p1');
    const t: any = await ctrl.getTimeline('c1', r, 'p1');
    for (const payload of [l, d, t]) {
      expect(text(payload)).not.toMatch(/4400|2500|1800|900|outstandingBalance|unitPrice|estimatedCost/);
      expect(payload[FINANCIALS_RESTRICTED]).toBe(true);
    }
    expect(d.fullName).toBe('Asha Rao');
  });

  it('a request with no user at all is treated as having no financial access (fails closed)', async () => {
    const out: any = await ctrl.findOne('c1', {} as any, 'p1');
    expect(out).not.toHaveProperty('outstandingBalance');
    expect(out).not.toHaveProperty('invoices');
  });
});
