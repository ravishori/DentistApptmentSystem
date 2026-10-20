/**
 * Real-PostgreSQL webhook regression tests (concurrent delivery, replay, cross-clinic isolation).
 * Skipped unless TEST_DATABASE_URL is set — use ONLY a disposable database, never dentalease_db.
 */
jest.mock('../../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({ payments: { fetch: jest.fn() } })));

import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { RazorpayService } from './razorpay.service';
import { RazorpayWebhookService } from './razorpay-webhook.service';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const SECRET = 'whsec_int_test_value';

d('Razorpay webhook on PostgreSQL', () => {
  const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  const config: any = { get: (k: string) => (k === 'razorpay.webhookSecret' ? SECRET : undefined) };
  const razorpay = new RazorpayService(prisma as any, config, { emit: () => true } as any);
  const webhook = new RazorpayWebhookService(razorpay, prisma as any);
  const stamp = Date.now();
  let clinicA: string, clinicB: string, patientA: string, invoiceA: string;

  const deliver = (payload: any, secret = SECRET) => {
    const raw = Buffer.from(JSON.stringify(payload));
    const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    return webhook.process(raw, sig, payload);
  };
  const notes = (o: any = {}) => ({ invoiceId: invoiceA, clinicId: clinicA, patientId: patientA, ...o });
  const linkPaid = (payId: string | undefined, amountPaise = 100000, n = notes()) => ({
    event: 'payment_link.paid',
    payload: {
      payment_link: { entity: { id: 'plink_int', amount_paid: amountPaise, notes: n } },
      ...(payId === undefined ? {} : { payment: { entity: { id: payId, amount: amountPaise, status: 'captured', method: 'upi' } } }),
    },
  });
  const captured = (payId: string, amountPaise = 100000) => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id: payId, order_id: 'plink_int', amount: amountPaise, status: 'captured', method: 'upi', notes: notes() } } },
  });

  beforeAll(async () => {
    const mk = (n: string) => prisma.clinic.create({ data: { name: n, slug: `${n}${stamp}`, email: `${n}${stamp}@wh.test` } as any });
    clinicA = (await mk('wha')).id;
    clinicB = (await mk('whb')).id;
    patientA = (await prisma.patient.create({ data: { clinicId: clinicA, patientCode: `WH-${stamp}`, fullName: 'Hook Patient', phone: '+910000000010' } as any })).id;
  });

  beforeEach(async () => {
    await prisma.payment.deleteMany({ where: { clinicId: { in: [clinicA, clinicB] } } });
    await prisma.invoice.deleteMany({ where: { clinicId: { in: [clinicA, clinicB] } } });
    invoiceA = (await prisma.invoice.create({ data: {
      clinicId: clinicA, patientId: patientA, invoiceNumber: `INV-WH-${Date.now()}`,
      totalAmount: 1000, balanceAmount: 1000, paidAmount: 0, status: 'sent',
    } as any })).id;
    await prisma.patient.update({ where: { id: patientA }, data: { outstandingBalance: 1000 } });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { clinicId: { in: [clinicA, clinicB] } } });
    await prisma.invoice.deleteMany({ where: { clinicId: { in: [clinicA, clinicB] } } });
    await prisma.patient.deleteMany({ where: { clinicId: clinicA } });
    await prisma.clinic.deleteMany({ where: { id: { in: [clinicA, clinicB] } } });
    await prisma.$disconnect();
  });

  const paymentCount = () => prisma.payment.count({ where: { clinicId: { in: [clinicA, clinicB] } } });
  const invoice = () => prisma.invoice.findUniqueOrThrow({ where: { id: invoiceA } });

  it('20 concurrent deliveries of one payment_link.paid event book exactly once', async () => {
    await Promise.allSettled(Array.from({ length: 20 }, () => deliver(linkPaid('pay_dup20'))));
    expect(await paymentCount()).toBe(1);
    const inv = await invoice();
    expect(Number(inv.paidAmount)).toBe(1000);
    expect(inv.status).toBe('paid');
  });

  it('the same payment arriving as BOTH payment.captured and payment_link.paid books once', async () => {
    await Promise.allSettled([
      ...Array.from({ length: 5 }, () => deliver(captured('pay_both'))),
      ...Array.from({ length: 5 }, () => deliver(linkPaid('pay_both'))),
    ]);
    expect(await paymentCount()).toBe(1);
    expect(Number((await invoice()).paidAmount)).toBe(1000);
  });

  it('replaying an already-processed event later is a no-op', async () => {
    await deliver(linkPaid('pay_replay'));
    await deliver(linkPaid('pay_replay'));
    expect(await paymentCount()).toBe(1);
    expect(Number((await invoice()).paidAmount)).toBe(1000);
  });

  it('payment_link.paid WITHOUT a payment id books nothing and leaves the invoice untouched', async () => {
    await deliver(linkPaid(undefined));
    expect(await paymentCount()).toBe(0);
    const inv = await invoice();
    expect(inv.status).toBe('sent');
    expect(Number(inv.paidAmount)).toBe(0);
    expect(await prisma.payment.count({ where: { razorpayPaymentId: { startsWith: 'pl_' } } })).toBe(0);
  });

  it('an invalid signature books nothing, even with a perfectly valid payload', async () => {
    await deliver(linkPaid('pay_badsig'), 'attacker-secret');
    expect(await paymentCount()).toBe(0);
    expect((await invoice()).status).toBe('sent');
  });

  it('cross-clinic: an event whose notes name another clinic cannot credit this clinic\'s invoice', async () => {
    await deliver(linkPaid('pay_xclinic', 100000, notes({ clinicId: clinicB })));
    expect(await paymentCount()).toBe(0);
    const inv = await invoice();
    expect(inv.status).toBe('sent');
    expect(Number(inv.paidAmount)).toBe(0);
  });

  it('partial payments sum correctly: two partial events then the final paid event (no double count)', async () => {
    const partial = (id: string, paise: number) => ({
      event: 'payment_link.partially_paid',
      payload: {
        payment_link: { entity: { id: 'plink_int', notes: notes() } },
        payment: { entity: { id, amount: paise, status: 'captured', method: 'upi' } },
      },
    });
    await deliver(partial('pay_p1', 30000));
    await deliver(partial('pay_p2', 20000));
    // final event: link.amount_paid is CUMULATIVE (1000) but this payment is only 500
    await deliver(linkPaid('pay_p3', 50000));
    await deliver(linkPaid('pay_p3', 50000)); // replay
    expect(await paymentCount()).toBe(3);
    const inv = await invoice();
    expect(Number(inv.paidAmount)).toBe(1000);
    expect(inv.status).toBe('paid');
    expect(Number((await prisma.patient.findUniqueOrThrow({ where: { id: patientA } })).outstandingBalance)).toBe(0);
  });
});
