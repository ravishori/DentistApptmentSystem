jest.mock('../../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({ payments: { fetch: jest.fn() } })));

import * as crypto from 'crypto';
import { RazorpayService } from './razorpay.service';
import { RazorpayWebhookService } from './razorpay-webhook.service';

const SECRET = 'whsec_unit_test_value';
const sign = (raw: Buffer, secret = SECRET) => crypto.createHmac('sha256', secret).update(raw).digest('hex');

function setup(opts: { prismaInvoice?: any } = {}) {
  const config: any = { get: (k: string) => (k === 'razorpay.webhookSecret' ? SECRET : undefined) };
  const prisma: any = { invoice: { findUnique: async () => opts.prismaInvoice ?? { patientId: 'p1' } }, payment: { findFirst: async () => null } };
  const razorpay = new RazorpayService(prisma, config, { emit: jest.fn() } as any);
  const record = jest.spyOn(razorpay, 'recordSuccessfulPayment').mockResolvedValue({} as any);
  const refund = jest.spyOn(razorpay, 'recordRefund').mockResolvedValue(undefined);
  const svc = new RazorpayWebhookService(razorpay, prisma);
  const deliver = async (payload: any, signatureOverride?: string) => {
    const raw = Buffer.from(JSON.stringify(payload));
    await svc.process(raw, signatureOverride ?? sign(raw), payload);
  };
  return { svc, record, refund, deliver };
}

const notes = { invoiceId: 'inv1', clinicId: 'c1', patientId: 'p1' };
const link = (o: any = {}) => ({ id: 'plink_123', amount_paid: 150000, notes, ...o });
const payment = (o: any = {}) => ({ id: 'pay_AbC123', amount: 50000, status: 'captured', method: 'upi', ...o });
const linkPaid = (entity: { link?: any; payment?: any }, event = 'payment_link.paid') => ({
  event,
  payload: {
    payment_link: { entity: entity.link ?? link() },
    ...(entity.payment === null ? {} : { payment: { entity: entity.payment ?? payment() } }),
  },
});

describe('payment_link.paid evidence rules', () => {
  it('records a valid event using THIS payment id and amount (not the cumulative link total)', async () => {
    const { deliver, record } = setup();
    await deliver(linkPaid({}));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: 'c1', invoiceId: 'inv1', razorpayPaymentId: 'pay_AbC123', razorpayOrderId: 'plink_123',
      amountPaid: 500, // payment.amount / 100 — NOT link.amount_paid (1500)
    }));
  });

  it('does NOT record (and never invents an id) when the payment entity is missing', async () => {
    const { deliver, record } = setup();
    await deliver(linkPaid({ payment: null }));
    expect(record).not.toHaveBeenCalled();
  });

  it.each([
    ['missing id', { id: undefined }],
    ['empty id', { id: '' }],
    ['synthetic pl_ id', { id: 'pl_plink_123' }],
    ['non-string id', { id: 12345 }],
    ['injection-looking id', { id: "pay_x'; DROP TABLE payments;--" }],
    ['zero amount', { amount: 0 }],
    ['negative amount', { amount: -100 }],
    ['non-numeric amount', { amount: '500' }],
    ['failed status', { status: 'failed' }],
    ['created status', { status: 'created' }],
  ])('does NOT record on %s', async (_label, patch) => {
    const { deliver, record } = setup();
    await deliver(linkPaid({ payment: payment(patch) }));
    expect(record).not.toHaveBeenCalled();
  });

  it('does NOT record when the signed notes lack invoice/clinic', async () => {
    const { deliver, record } = setup();
    await deliver(linkPaid({ link: link({ notes: { invoiceId: 'inv1' } }) }));
    await deliver(linkPaid({ link: link({ notes: {} }) }));
    expect(record).not.toHaveBeenCalled();
  });

  it('does NOT crash or record on a malformed payload with no entities', async () => {
    const { deliver, record } = setup();
    await expect(deliver({ event: 'payment_link.paid', payload: {} })).resolves.toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });

  it('partially_paid follows the same evidence rule', async () => {
    const { deliver, record } = setup();
    await deliver(linkPaid({ payment: null }, 'payment_link.partially_paid'));
    await deliver(linkPaid({ payment: payment({ id: 'pl_fake' }) }, 'payment_link.partially_paid'));
    expect(record).not.toHaveBeenCalled();
    await deliver(linkPaid({}, 'payment_link.partially_paid'));
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe('payment.captured evidence rules', () => {
  const captured = (o: any = {}) => ({ event: 'payment.captured', payload: { payment: { entity: { ...payment(), order_id: 'order_1', notes, ...o } } } });

  it('records a valid captured payment', async () => {
    const { deliver, record } = setup();
    await deliver(captured());
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ razorpayPaymentId: 'pay_AbC123', amountPaid: 500 }));
  });
  it('ignores unsettled or id-less captured events', async () => {
    const { deliver, record } = setup();
    await deliver(captured({ status: 'failed' }));
    await deliver(captured({ id: undefined }));
    expect(record).not.toHaveBeenCalled();
  });
});

describe('signature enforcement at the service boundary', () => {
  it.each([
    ['wrong secret', (raw: Buffer) => sign(raw, 'other-secret')],
    ['empty', () => ''],
    ['non-hex', () => 'not-a-signature'],
    ['truncated', (raw: Buffer) => sign(raw).slice(0, 20)],
  ])('discards a %s signature without recording anything', async (_n, make) => {
    const { svc, record, refund } = setup();
    const payload = linkPaid({});
    const raw = Buffer.from(JSON.stringify(payload));
    await svc.process(raw, make(raw), payload);
    expect(record).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
  });

  it('discards a validly-signed body that was altered after signing', async () => {
    const { svc, record } = setup();
    const original = Buffer.from(JSON.stringify(linkPaid({})));
    const tampered = linkPaid({ payment: payment({ amount: 99999900 }) });
    await svc.process(Buffer.from(JSON.stringify(tampered)), sign(original), tampered);
    expect(record).not.toHaveBeenCalled();
  });
});
