jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });
jest.mock('../../cache/cache.service', () => ({ CacheService: { keys: {} } }), { virtual: true });

import { UserRole } from '@prisma/client';
import { AppointmentsController } from './appointments.controller';
import { redactAppointment, redactAppointmentPage, redactAppointments } from './appointment-financials';
import { FINANCIALS_RESTRICTED } from '../patients/patient-financials';

const appt = {
  id: 'a1', startTime: '10:00:00', status: 'scheduled', estimatedCost: 4500,
  patient: { id: 'p1', fullName: 'Asha' }, dentist: { fullName: 'Dr R' },
  treatments: [{ id: 't1', toothNumber: '11', unitPrice: 4000, discountPct: 10, procedure: { name: 'Root canal', code: 'RCT' } }],
  invoice: { id: 'i1', invoiceNumber: 'INV-1', status: 'sent', totalAmount: 3600 },
};
const text = (v: unknown) => JSON.stringify(v);
const MONEY = /4500|4000|3600|estimatedCost|unitPrice|discountPct|totalAmount|invoiceNumber|"invoice"/;

describe('appointment redaction removes money, keeps scheduling/clinical data', () => {
  it('single appointment', () => {
    const out: any = redactAppointment(appt);
    expect(text(out)).not.toMatch(MONEY);
    expect(out).toMatchObject({ id: 'a1', startTime: '10:00:00', status: 'scheduled', patient: { fullName: 'Asha' } });
    expect(out.treatments[0]).toMatchObject({ toothNumber: '11', procedure: { name: 'Root canal' } });
    expect(out[FINANCIALS_RESTRICTED]).toBe(true);
    expect(appt.estimatedCost).toBe(4500);                          // input not mutated
  });
  it('list and page shapes', () => {
    expect(text(redactAppointments([appt, appt]))).not.toMatch(MONEY);
    const page: any = redactAppointmentPage({ items: [appt], total: 1, page: 1, limit: 20, pages: 1 });
    expect(text(page)).not.toMatch(MONEY);
    expect(page).toMatchObject({ total: 1, page: 1, pages: 1 });
  });
  it('tolerates appointments without treatments/invoice and null values', () => {
    expect(() => redactAppointment({ id: 'x', estimatedCost: null } as any)).not.toThrow();
    expect(redactAppointment(null as any)).toBeNull();
  });
});

describe('AppointmentsController: who sees appointment money', () => {
  const svc: any = {
    findAll: async () => ({ items: [appt], total: 1, page: 1, limit: 20, pages: 1 }),
    findOne: async () => appt, todaySchedule: async () => [appt],
    book: async () => appt, updateStatus: async () => appt, reschedule: async () => appt,
  };
  const ctrl = new AppointmentsController(svc, {} as any);
  const user = (role: UserRole) => ({ id: 'u', role, clinicId: 'c1' } as any);
  const calls = (role: UserRole) => ({
    list:   ctrl.findAll('c1', user(role), {} as any),
    one:    ctrl.findOne('c1', user(role), 'a1'),
    today:  ctrl.todaySchedule('c1', user(role)),
    book:   ctrl.book('c1', user(role), {} as any),
    status: ctrl.updateStatus('c1', user(role), 'a1', {} as any),
    resched: ctrl.reschedule('c1', user(role), 'a1', {} as any),
  });

  it.each([UserRole.clinic_admin, UserRole.super_admin, UserRole.receptionist, UserRole.dentist])('%s (holds billing:read) sees estimated cost, invoice and treatment prices', async (role) => {
    for (const [name, p] of Object.entries(calls(role))) {
      const v: any = await p;
      const first = v.items?.[0] ?? (Array.isArray(v) ? v[0] : v);
      expect({ name, hasMoney: MONEY.test(text(first)) }).toEqual({ name, hasMoney: true });
    }
  });

  it('assistant gets NO financial data from any appointment endpoint (list, detail, today, book, status, reschedule)', async () => {
    for (const [name, p] of Object.entries(calls(UserRole.assistant))) {
      const v: any = await p;
      expect({ name, leaked: MONEY.test(text(v)) }).toEqual({ name, leaked: false });
      expect((v.items?.[0] ?? (Array.isArray(v) ? v[0] : v))[FINANCIALS_RESTRICTED]).toBe(true);
    }
  });

  it('no user at all fails closed (treated as no financial access)', async () => {
    const v: any = await ctrl.findOne('c1', undefined as any, 'a1');
    expect(text(v)).not.toMatch(MONEY);
  });
});
