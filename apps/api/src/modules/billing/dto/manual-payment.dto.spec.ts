/**
 * DTO-level validation contract for manual payments.
 *
 * `insurance` must NOT be accepted here: insurance settlements are tracked
 * through the dedicated insurance-claims workflow, not as manual payments.
 * The `insurance` value remains in the Prisma `PaymentMethod` enum for
 * historical rows and the claims workflow; this DTO guards the write path
 * at the API boundary.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ManualPaymentMethod, RecordManualPaymentDto } from './manual-payment.dto';

async function errorKeysFor(payload: unknown): Promise<string[]> {
  const dto = plainToInstance(RecordManualPaymentDto, payload);
  const errs = await validate(dto as object, { whitelist: true, forbidNonWhitelisted: false });
  return errs.map((e) => e.property);
}

describe('RecordManualPaymentDto', () => {
  describe('ManualPaymentMethod enum', () => {
    it('does not include insurance', () => {
      expect(Object.values(ManualPaymentMethod)).not.toContain('insurance');
    });

    it('still includes every approved manual method', () => {
      expect(Object.values(ManualPaymentMethod).sort()).toEqual(
        ['card', 'cash', 'cheque', 'netbanking', 'other', 'upi'],
      );
    });
  });

  describe('validation', () => {
    const base = { amount: 100 };

    it('accepts every approved manual method', async () => {
      for (const method of Object.values(ManualPaymentMethod)) {
        await expect(errorKeysFor({ ...base, method })).resolves.toEqual([]);
      }
    });

    it('rejects insurance as a payment method', async () => {
      await expect(errorKeysFor({ ...base, method: 'insurance' })).resolves.toContain('method');
    });

    it('rejects an unknown payment method', async () => {
      await expect(errorKeysFor({ ...base, method: 'crypto' })).resolves.toContain('method');
    });

    it('rejects a missing payment method', async () => {
      await expect(errorKeysFor({ amount: 100 })).resolves.toContain('method');
    });

    it('rejects a non-positive amount', async () => {
      await expect(errorKeysFor({ amount: 0, method: 'cash' })).resolves.toContain('amount');
      await expect(errorKeysFor({ amount: -5, method: 'cash' })).resolves.toContain('amount');
    });

    it('rejects a non-numeric amount', async () => {
      await expect(errorKeysFor({ amount: 'ten' as unknown as number, method: 'cash' })).resolves.toContain('amount');
    });

    it('accepts a valid manual payment with optional fields omitted', async () => {
      await expect(errorKeysFor({ amount: 500, method: 'upi' })).resolves.toEqual([]);
    });

    it('accepts a valid manual payment with transactionRef, paidAt and notes', async () => {
      await expect(
        errorKeysFor({
          amount:         500,
          method:         'upi',
          transactionRef: 'UPI-REF-123',
          paidAt:         '2026-11-23T10:00:00.000Z',
          notes:          'Paid at counter',
        }),
      ).resolves.toEqual([]);
    });

    it('rejects a malformed paidAt', async () => {
      await expect(
        errorKeysFor({ amount: 500, method: 'cash', paidAt: 'not-a-date' }),
      ).resolves.toContain('paidAt');
    });
  });
});
