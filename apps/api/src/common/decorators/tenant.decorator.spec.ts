import { ForbiddenException } from '@nestjs/common';
import { resolveTenantId } from './tenant.decorator';

describe('resolveTenantId (the clinic of the verified caller; fails closed)', () => {
  it('prefers the verified user clinic', () => expect(resolveTenantId({ user: { clinicId: 'c1' }, clinicId: 'c2' })).toBe('c1'));
  it('falls back to the middleware clinicId', () => expect(resolveTenantId({ clinicId: 'c2' })).toBe('c2'));
  it('REGRESSION: it no longer returns `undefined` (a Prisma where {clinicId: undefined} matches EVERY clinic)', () => {
    expect(() => resolveTenantId({})).toThrow(ForbiddenException);
    expect(() => resolveTenantId({ user: {} })).toThrow(ForbiddenException);
    expect(() => resolveTenantId({ user: { clinicId: '' }, clinicId: '' })).toThrow(ForbiddenException);
  });
  it('ignores a client-supplied tenantId property (the old, never-set field)', () => {
    expect(() => resolveTenantId({ tenantId: 'attacker' } as any)).toThrow(ForbiddenException);
  });
});
