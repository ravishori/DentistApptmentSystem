/**
 * Real-PostgreSQL idempotency tests for payment/refund recording. Skipped unless TEST_DATABASE_URL is set.
 * Point it ONLY at a disposable database (schema created with `prisma db push`), never at dentalease_db.
 */
jest.mock('../../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({ payments: { fetch: jest.fn() } })));

import { PrismaClient } from '@prisma/client';
import { RazorpayService } from './razorpay.service';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Razorpay recording on PostgreSQL', () => {
  const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  const svc = new RazorpayService(prisma as any, { get: () => undefined } as any, { emit: () => true } as any);
  let clinicId: string, otherClinicId: string, patientId: string, invoiceId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    const mk = (n: string) => prisma.clinic.create({ data: { name: n, slug: `${n}${stamp}`, email: `${n}${stamp}@rzp.test` } as any });
    clinicId = (await mk('rzpa')).id;
    otherClinicId = (await mk('rzpb')).id;
    patientId = (await prisma.patient.create({ data: { clinicId, patientCode: `RZ-${stamp}`, fullName: 'Pay Patient', phone: '+910000000009', outstandingBalance: 1000 } as any })).id;
  });

  beforeEach(async () => {
    await prisma.payment.deleteMany({ where: { clinicId } });
    await prisma.invoice.deleteMany({ where: { clinicId } });
    invoiceId = (await prisma.invoice.create({ data: {
      clinicId, patientId, invoiceNumber: `INV-${Date.now()}`, totalAmount: 1000, balanceAmount: 1000, paidAmount: 0, status: 'sent',
    } as any })).id;
    await prisma.patient.update({ where: { id: patientId }, data: { outstandingBalance: 1000 } });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { clinicId: { in: [clinicId, otherClinicId] } } });
    await prisma.invoice.deleteMany({ where: { clinicId: { in: [clinicId, otherClinicId] } } });
    await prisma.patient.deleteMany({ where: { clinicId } });
    await prisma.clinic.deleteMany({ where: { id: { in: [clinicId, otherClinicId] } } });
    await prisma.$disconnect();
  });

  const pay = (paymentId: string, amount = 1000, cid = clinicId) => svc.recordSuccessfulPayment({
    clinicId: cid, invoiceId, patientId, amountPaid: amount, razorpayOrderId: 'order_x',
    razorpayPaymentId: paymentId, method: 'upi',
  });

  it('10 concurrent deliveries of the same payment id record exactly one payment and settle once', async () => {
    await Promise.allSettled(Array.from({ length: 10 }, () => pay('pay_dup_1')));
    expect(await prisma.payment.count({ where: { clinicId, razorpayPaymentId: 'pay_dup_1' } })).toBe(1);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(Number(inv.paidAmount)).toBe(1000);
    expect(inv.status).toBe('paid');
    const pat = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } });
    expect(Number(pat.outstandingBalance)).toBe(0);
  });

  it('a payment claiming another clinic is ignored and changes nothing', async () => {
    await expect(pay('pay_x_clinic', 1000, otherClinicId)).resolves.toBeNull();
    expect(await prisma.payment.count({ where: { razorpayPaymentId: 'pay_x_clinic' } })).toBe(0);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('sent');
  });

  it('refund is applied once under concurrent delivery and over-refunds are rejected', async () => {
    await pay('pay_refund_1', 1000);
    const refund = (id: string, amt: number) => svc.recordRefund({
      clinicId, razorpayRefundId: id, razorpayPaymentId: 'pay_refund_1', amountRefunded: amt, speed: 'normal',
    });
    await Promise.allSettled(Array.from({ length: 5 }, () => refund('rfnd_1', 400)));
    const refunds = await prisma.payment.findMany({ where: { clinicId, razorpayPaymentId: 'rfnd_1' } });
    expect(refunds.length).toBeLessThanOrEqual(1);
    await refund('rfnd_big', 5000);
    expect(await prisma.payment.count({ where: { clinicId, razorpayPaymentId: 'rfnd_big' } })).toBe(0);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(Number(inv.paidAmount)).toBe(600);
  });
});
