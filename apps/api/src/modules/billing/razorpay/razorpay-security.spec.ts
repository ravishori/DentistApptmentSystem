jest.mock('../../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });
const fetchPayment = jest.fn();
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({
  payments: { fetch: fetchPayment },
  orders: { create: jest.fn() },
  paymentLink: { create: jest.fn() },
})));

import * as crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RazorpayService } from './razorpay.service';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { RazorpayWebhookService } from './razorpay-webhook.service';

const WH = 'whsec_test_value';
const KS = 'key_secret_test_value';
const hmac = (secret: string, data: string | Buffer) =>
  crypto.createHmac('sha256', secret).update(data).digest('hex');

function build(cfg: Record<string, string | undefined>, prisma: any = {}) {
  const config: any = { get: (k: string) => cfg[k] };
  const emitter: any = { emit: jest.fn() };
  return new RazorpayService(prisma, config, emitter);
}

describe('webhook signature', () => {
  const body = Buffer.from('{"event":"payment.captured"}');

  it('accepts a correct signature', () => {
    expect(build({ 'razorpay.webhookSecret': WH }).verifyWebhookSignature(body, hmac(WH, body))).toBe(true);
  });
  it('fails CLOSED when the webhook secret is not configured', () => {
    expect(build({}).verifyWebhookSignature(body, hmac('anything', body))).toBe(false);
    expect(build({ 'razorpay.webhookSecret': '' }).verifyWebhookSignature(body, '')).toBe(false);
  });
  it('rejects wrong, empty, non-hex and wrong-length signatures without throwing', () => {
    const svc = build({ 'razorpay.webhookSecret': WH });
    for (const bad of [hmac('other', body), '', 'zz', 'abcd', undefined as any, hmac(WH, body) + '00']) {
      expect(svc.verifyWebhookSignature(body, bad)).toBe(false);
    }
  });
  it('rejects a valid signature over a tampered body', () => {
    const svc = build({ 'razorpay.webhookSecret': WH });
    expect(svc.verifyWebhookSignature(Buffer.from('{"event":"x"}'), hmac(WH, body))).toBe(false);
  });
});

describe('webhook controller authenticates before processing', () => {
  it('returns 401 and never processes an unsigned/forged event', async () => {
    const rz = build({ 'razorpay.webhookSecret': WH });
    const process = jest.fn();
    const svc = new RazorpayWebhookService(rz, {} as any);
    (svc as any).process = process;
    const ctrl = new RazorpayWebhookController(svc);
    const raw = Buffer.from('{"event":"payment.captured"}');
    await expect(ctrl.handle({ rawBody: raw } as any, 'deadbeef')).rejects.toThrow();
    expect(process).not.toHaveBeenCalled();
  });
});

describe('client-side payment verification', () => {
  const dto = { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: '', invoiceId: 'inv1' };
  const signed = { ...dto, razorpay_signature: hmac(KS, 'order_1|pay_1') };
  const invoice = (o: any = {}) => ({
    id: 'inv1', clinicId: 'c1', patientId: 'p1', status: 'sent', razorpayOrderId: 'order_1',
    balanceAmount: 1000, totalAmount: 1000, paidAmount: 0, invoiceNumber: 'INV-1', ...o,
  });
  const mk = (inv: any) => build({ 'razorpay.keySecret': KS }, {
    invoice: { findFirst: async ({ where }: any) => ((!where.clinicId || where.clinicId === inv?.clinicId) && where.id === inv?.id ? inv : null) },
  });

  beforeEach(() => fetchPayment.mockReset());

  it('rejects when key secret is not configured', async () => {
    const svc = build({}, {});
    await expect(svc.verifyOrderPayment('c1', signed)).rejects.toThrow(BadRequestException);
  });
  it('rejects a bad or malformed signature', async () => {
    const svc = mk(invoice());
    await expect(svc.verifyOrderPayment('c1', { ...dto, razorpay_signature: 'abc' })).rejects.toThrow(/signature/i);
  });
  it('rejects a valid signature for an order that belongs to a different invoice', async () => {
    const svc = mk(invoice({ razorpayOrderId: 'order_OTHER' }));
    await expect(svc.verifyOrderPayment('c1', signed)).rejects.toThrow(/does not belong/);
    expect(fetchPayment).not.toHaveBeenCalled();
  });
  it('rejects when Razorpay reports the payment is not captured/authorized', async () => {
    fetchPayment.mockResolvedValue({ order_id: 'order_1', status: 'failed', amount: 100000 });
    await expect(mk(invoice()).verifyOrderPayment('c1', signed)).rejects.toThrow(/not completed/);
  });
  it('is tenant scoped: another clinic cannot verify this invoice', async () => {
    await expect(mk(invoice()).verifyOrderPayment('c2', signed)).rejects.toThrow(/not found/i);
  });
  it('anonymous checkout callback (no clinic context) records against the invoice clinic after order binding', async () => {
    fetchPayment.mockResolvedValue({ order_id: 'order_1', status: 'captured', amount: 100000 });
    const svc = mk(invoice());
    const spy = jest.spyOn(svc, 'recordSuccessfulPayment').mockResolvedValue({} as any);
    await expect(svc.verifyOrderPayment(undefined, signed)).resolves.toEqual({ success: true });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'c1', invoiceId: 'inv1', amountPaid: 1000 }));
  });
  it('anonymous callback still cannot hit an invoice with a different order id', async () => {
    const svc = mk(invoice({ razorpayOrderId: 'order_OTHER' }));
    await expect(svc.verifyOrderPayment(undefined, signed)).rejects.toThrow(/does not belong/);
  });
  it('loadInvoice refuses an empty clinic id (Prisma would drop the filter and match any tenant)', async () => {
    const svc: any = mk(invoice());
    await expect(svc.loadInvoice(undefined, 'inv1')).rejects.toThrow(/Clinic context/);
  });
  it('already-paid invoice short-circuits without recording again', async () => {
    const r = await mk(invoice({ status: 'paid' })).verifyOrderPayment('c1', signed);
    expect(r).toEqual({ success: true, alreadyPaid: true });
  });
});

describe('recordSuccessfulPayment replay & tenant protection', () => {
  const params = {
    clinicId: 'c1', invoiceId: 'inv1', patientId: 'evil', amountPaid: 500,
    razorpayOrderId: 'o', razorpayPaymentId: 'pay_9', method: 'upi',
  };
  const baseInvoice = { id: 'inv1', clinicId: 'c1', patientId: 'p1', paidAmount: 0, totalAmount: 1000 };

  it('ignores a duplicate already recorded', async () => {
    const existing = { id: 'x' };
    const svc = build({}, { payment: { findFirst: async () => existing } });
    await expect(svc.recordSuccessfulPayment(params)).resolves.toBe(existing);
  });
  it('refuses to record a payment whose clinic does not own the invoice', async () => {
    const tx = jest.fn();
    const svc = build({}, {
      payment: { findFirst: async () => null },
      invoice: { findUniqueOrThrow: async () => ({ ...baseInvoice, clinicId: 'other' }) },
      $transaction: tx,
    });
    await expect(svc.recordSuccessfulPayment(params)).resolves.toBeNull();
    expect(tx).not.toHaveBeenCalled();
  });
  it('treats a concurrent unique-constraint race (P2002) as a replay, not an error', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    const svc = build({}, {
      payment: { findFirst: async () => null, create: jest.fn() },
      invoice: { findUniqueOrThrow: async () => baseInvoice, update: jest.fn() },
      patient: { update: jest.fn() },
      $transaction: async () => { throw err; },
    });
    await expect(svc.recordSuccessfulPayment(params)).resolves.toBeNull();
  });
  it('uses the invoice\'s patient, not the caller-supplied one', async () => {
    const create = jest.fn();
    const svc = build({}, {
      payment: { findFirst: async () => null, create },
      invoice: { findUniqueOrThrow: async () => baseInvoice, update: jest.fn() },
      patient: { update: jest.fn() },
      $transaction: async (ops: any[]) => ops,
    });
    await svc.recordSuccessfulPayment(params);
    expect(create.mock.calls[0][0].data.patientId).toBe('p1');
  });
});

describe('refund handling', () => {
  const p = { clinicId: 'c1', razorpayRefundId: 'rf1', razorpayPaymentId: 'pay_1', amountRefunded: 100, speed: 'normal' };
  it('ignores refunds for unknown payments', async () => {
    const tx = jest.fn();
    const svc = build({}, { payment: { findFirst: async () => null }, $transaction: tx });
    await svc.recordRefund(p);
    expect(tx).not.toHaveBeenCalled();
  });
  it('rejects refunds larger than the original payment', async () => {
    const tx = jest.fn();
    const svc = build({}, { payment: { findFirst: async () => ({ amount: 50, invoiceId: 'i' }) }, $transaction: tx });
    await svc.recordRefund(p);
    expect(tx).not.toHaveBeenCalled();
  });
  it('is idempotent for an already-recorded refund id', async () => {
    const tx = jest.fn();
    const findFirst = jest.fn()
      .mockResolvedValueOnce({ amount: 500, invoiceId: 'i', patientId: 'p1', razorpayOrderId: 'o' })
      .mockResolvedValueOnce({ id: 'existing' });
    const svc = build({}, { payment: { findFirst }, $transaction: tx });
    await svc.recordRefund(p);
    expect(tx).not.toHaveBeenCalled();
  });
});

describe('VerifyOrderPaymentDto (public route) survives ValidationPipe whitelist', () => {
  // Imported late: class-validator/transformer are plain dependencies, no Nest bootstrap needed
  const { plainToInstance } = require('class-transformer');
  const { validate } = require('class-validator');
  const { VerifyOrderPaymentDto } = require('../dto/payment-link.dto');
  const good = { razorpay_order_id: 'order_Abc123', razorpay_payment_id: 'pay_Abc123', razorpay_signature: 'ab12cd', invoiceId: '8f14e45f-ceea-467a-9575-0a1b2c3d4e5f' };

  it('accepts well-formed input and keeps every field when whitelisted', async () => {
    const dto = plainToInstance(VerifyOrderPaymentDto, good);
    expect(await validate(dto, { whitelist: true, forbidUnknownValues: true })).toHaveLength(0);
    expect(Object.keys(dto).sort()).toEqual(Object.keys(good).sort());
  });
  it('rejects malformed ids, non-hex signature and wrong types', async () => {
    for (const bad of [
      { ...good, razorpay_order_id: 'x' }, { ...good, razorpay_payment_id: 123 },
      { ...good, razorpay_signature: 'not-hex!' }, { ...good, invoiceId: 'nope' }, {},
    ]) {
      expect((await validate(plainToInstance(VerifyOrderPaymentDto, bad))).length).toBeGreaterThan(0);
    }
  });
});
