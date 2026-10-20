jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });
jest.mock('../../cache/cache.service', () => ({ CacheService: { keys: {} } }), { virtual: true });

import { ValidationPipe } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { CreatePatientDto, UpdatePatientDto } from './dto/patient.dto';
import { WhatsappService } from '../whatsapp/whatsapp.service';

const IMPLICIT = { enableImplicitConversion: true };
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true, transformOptions: IMPLICIT });
const run = (metatype: any, body: any) => pipe.transform(body, { type: 'body', metatype } as any) as Promise<any>;
const base = { fullName: 'Asha Rao', phone: '+919999999999' };

/** Prisma fake that records exactly what the service writes. */
function fakePrisma(existing: any = null) {
  const writes: { create?: any; update?: any } = {};
  const prisma: any = {
    patient: {
      findFirst: async ({ where }: any) => (where?.phone && existing?.phone === where.phone ? existing : where?.id && existing?.id === where.id ? existing : null),
      count: async () => 0,
      create: async ({ data }: any) => { writes.create = data; return { id: 'p1', ...data }; },
      update: async ({ data }: any) => { writes.update = data; return { id: 'p1', ...data }; },
    },
  };
  return { prisma, writes };
}
const svc = (prisma: any) => new PatientsService(prisma, { del: jest.fn() } as any);

describe('WhatsApp consent is opt-IN', () => {
  describe('patient creation', () => {
    it('an OMITTED waOptIn is stored as FALSE (no consent assumed)', async () => {
      const { prisma, writes } = fakePrisma();
      await svc(prisma).create('c1', (await run(CreatePatientDto, base)) as CreatePatientDto);
      expect(writes.create.waOptIn).toBe(false);
    });
    it('explicit true is stored as true; explicit false stays false', async () => {
      for (const v of [true, false]) {
        const { prisma, writes } = fakePrisma();
        await svc(prisma).create('c1', (await run(CreatePatientDto, { ...base, waOptIn: v })) as CreatePatientDto);
        expect(writes.create.waOptIn).toBe(v);
      }
    });
    it('null / undefined in the body is also treated as "no consent"', async () => {
      for (const body of [{ ...base, waOptIn: undefined }, { ...base, waOptIn: null }]) {
        const { prisma, writes } = fakePrisma();
        await svc(prisma).create('c1', (await run(CreatePatientDto, body)) as CreatePatientDto);
        expect(writes.create.waOptIn).toBe(false);
      }
    });
    it('the string "false"/"true" is rejected, so consent can never be inverted or guessed', async () => {
      await expect(run(CreatePatientDto, { ...base, waOptIn: 'false' })).rejects.toThrow();
      await expect(run(CreatePatientDto, { ...base, waOptIn: 'true' })).rejects.toThrow();
    });
  });

  describe('patient update', () => {
    const existing = { id: 'p1', clinicId: 'c1', phone: '+919999999999', waOptIn: true };
    it('omitting waOptIn leaves consent untouched (the key is not written at all)', async () => {
      const { prisma, writes } = fakePrisma(existing);
      await svc(prisma).update('c1', 'p1', (await run(UpdatePatientDto, { city: 'Pune' })) as UpdatePatientDto);
      expect(writes.update).not.toHaveProperty('waOptIn');
    });
    it('explicit false (withdrawal) and explicit true are both persisted exactly', async () => {
      for (const v of [false, true]) {
        const { prisma, writes } = fakePrisma(existing);
        await svc(prisma).update('c1', 'p1', (await run(UpdatePatientDto, { waOptIn: v })) as UpdatePatientDto);
        expect(writes.update.waOptIn).toBe(v);
      }
    });
    it('the string "false" is rejected: a withdrawal request can never be turned into consent', async () => {
      await expect(run(UpdatePatientDto, { waOptIn: 'false' })).rejects.toThrow();
    });
  });
});

describe('event-driven WhatsApp sends require consent (360Dialog path)', () => {
  const D360 = 'd360_key_' + 'Lp7Vn2'.repeat(3);
  const mk = () => {
    const wa = new WhatsappService({} as any, { get: (k: string) => (k === 'whatsapp.apiKey' ? D360 : undefined) } as any);
    const send = jest.spyOn(wa, 'sendTemplate').mockResolvedValue({ status: 'sent' } as any);
    return { wa, send };
  };
  const appointment = (waOptIn: boolean | undefined) => ({
    id: 'a1', clinicId: 'c1', appointmentDate: new Date('2031-03-03'), startTime: '10:00:00',
    patient: { fullName: 'Asha', phone: '+919999999999', waOptIn },
    dentist: { fullName: 'Dr Rao' }, clinic: { name: 'Smile' },
  });

  it.each([[false], [undefined]])('booking confirmation / 24h / 2h / follow-up are NOT sent when waOptIn=%p', async (flag) => {
    const { wa, send } = mk();
    await wa.onAppointmentBooked({ appointment: appointment(flag), clinicId: 'c1' });
    await wa.onReminder24h({ appointment: appointment(flag) });
    await wa.onReminder2h({ appointment: appointment(flag) });
    await wa.onFollowup({ appointment: appointment(flag) });
    expect(send).not.toHaveBeenCalled();
  });
  it('positive control: with waOptIn=true the same handlers do send', async () => {
    const { wa, send } = mk();
    await wa.onAppointmentBooked({ appointment: appointment(true), clinicId: 'c1' });
    await wa.onReminder24h({ appointment: appointment(true) });
    await wa.onReminder2h({ appointment: appointment(true) });
    await wa.onFollowup({ appointment: appointment(true) });
    expect(send).toHaveBeenCalledTimes(4);
  });

  describe('payment link (invoice.sent) — previously sent with NO consent check', () => {
    const invoice = (waOptIn: boolean | undefined) => ({
      clinicId: 'c1', invoiceNumber: 'INV-1', balanceAmount: 500,
      patient: { fullName: 'Asha', phone: '+919999999999', waOptIn },
    });
    it.each([[false], [undefined]])('is NOT sent when waOptIn=%p', async (flag) => {
      const { wa, send } = mk();
      await wa.onInvoiceSent({ invoice: invoice(flag), paymentLink: 'https://rzp.io/x', clinicId: 'c1' });
      expect(send).not.toHaveBeenCalled();
    });
    it('is sent when the patient opted in', async () => {
      const { wa, send } = mk();
      await wa.onInvoiceSent({ invoice: invoice(true), paymentLink: 'https://rzp.io/x', clinicId: 'c1' });
      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
