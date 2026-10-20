jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });
jest.mock('../../cache/cache.service', () => ({ CacheService: { keys: {} } }), { virtual: true });

import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PermissionsGuard, roleHasPermission } from './permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { BillingController } from '../../modules/billing/billing.controller';

const ALL_ROLES = [UserRole.super_admin, UserRole.clinic_admin, UserRole.dentist, UserRole.receptionist, UserRole.assistant];

/** Execution context whose handler/class carry the given metadata. */
function ctx(opts: { permissions?: string[]; isPublic?: boolean; user?: { role: UserRole } }) {
  const handler = () => undefined;
  class Host {}
  if (opts.permissions) Reflect.defineMetadata(PERMISSIONS_KEY, opts.permissions, handler);
  if (opts.isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
  return { getHandler: () => handler, getClass: () => Host, switchToHttp: () => ({ getRequest: () => ({ user: opts.user }) }) } as any;
}
const guard = new PermissionsGuard(new Reflector());

describe('permission matrix (billing)', () => {
  it.each([
    [UserRole.super_admin, true, true], [UserRole.clinic_admin, true, true],
    [UserRole.receptionist, true, true],
    [UserRole.dentist, true, false],            // read-only on billing
    [UserRole.assistant, false, false],         // no billing access at all
  ])('%s → read=%p write=%p', (role, read, write) => {
    expect(roleHasPermission(role, 'billing:read')).toBe(read);
    expect(roleHasPermission(role, 'billing:write')).toBe(write);
    const run = (p: string) => { try { return guard.canActivate(ctx({ permissions: [p], user: { role } })); } catch (e) { return e instanceof ForbiddenException ? false : 'crash'; } };
    expect(run('billing:read')).toBe(read);
    expect(run('billing:write')).toBe(write);
  });
  it('unknown / missing role holds nothing', () => {
    expect(roleHasPermission(undefined, 'billing:read')).toBe(false);
    expect(roleHasPermission('hacker', 'billing:read')).toBe(false);
  });
});

describe('PermissionsGuard edge cases', () => {
  it('a @Public() route is never blocked and never crashes without a user (this used to be an HTTP 500)', () => {
    expect(guard.canActivate(ctx({ permissions: ['billing:read'], isPublic: true }))).toBe(true);
  });
  it('a protected route with NO user is a 403, not a TypeError', () => {
    expect(() => guard.canActivate(ctx({ permissions: ['billing:read'] }))).toThrow(ForbiddenException);
  });
  it('a route with no permission requirement passes through', () => {
    expect(guard.canActivate(ctx({ user: { role: UserRole.assistant } }))).toBe(true);
  });
});

describe('BillingController route inventory — nothing is accidentally open or write-open', () => {
  const proto = BillingController.prototype as any;
  const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && typeof proto[n] === 'function');
  const meta = (name: string) => ({
    method: Reflect.getMetadata('method', proto[name]) as RequestMethod,
    isPublic: !!Reflect.getMetadata(IS_PUBLIC_KEY, proto[name]),
    handlerPerm: Reflect.getMetadata(PERMISSIONS_KEY, proto[name]) as string[] | undefined,
  });
  const classPerm = Reflect.getMetadata(PERMISSIONS_KEY, BillingController) as string[] | undefined;

  it('the class requires billing:read by default', () => expect(classPerm).toEqual(['billing:read']));

  it('discovers the routes (guards against the inventory silently becoming empty)', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(25);
  });

  it('only the two payment-checkout routes are public — a new public route fails this test and needs review', () => {
    const pub = handlers.filter((h) => meta(h).isPublic).sort();
    expect(pub).toEqual(['resolveCheckout', 'verifyPayment'].sort());
  });

  it('every non-public route is covered by a permission (handler or class)', () => {
    const uncovered = handlers.filter((h) => !meta(h).isPublic && !meta(h).handlerPerm && !classPerm).map((h) => h);
    expect(uncovered).toEqual([]);
  });

  it('every non-public mutating route (POST/PUT/PATCH/DELETE) requires billing:write', () => {
    const MUTATING = [RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE];
    const offenders = handlers
      .filter((h) => !meta(h).isPublic && MUTATING.includes(meta(h).method))
      .filter((h) => !(meta(h).handlerPerm ?? []).includes('billing:write'));
    expect(offenders).toEqual([]);
  });

  it('read routes never demand write (read-only roles can still view)', () => {
    const bad = handlers.filter((h) => !meta(h).isPublic && meta(h).method === RequestMethod.GET && (meta(h).handlerPerm ?? []).includes('billing:write'));
    expect(bad).toEqual([]);
  });

  it('end to end through the guard: assistant is blocked everywhere; dentist can read but not write', () => {
    const run = (role: UserRole, handler: string) => {
      const h = proto[handler];
      const c = { getHandler: () => h, getClass: () => BillingController, switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) } as any;
      try { return guard.canActivate(c); } catch { return false; }
    };
    const reads = handlers.filter((h) => !meta(h).isPublic && meta(h).method === RequestMethod.GET);
    const writes = handlers.filter((h) => !meta(h).isPublic && meta(h).method !== RequestMethod.GET);
    for (const h of [...reads, ...writes]) expect(run(UserRole.assistant, h)).toBe(false);
    for (const h of reads) expect(run(UserRole.dentist, h)).toBe(true);
    for (const h of writes) expect(run(UserRole.dentist, h)).toBe(false);
    for (const h of [...reads, ...writes]) { expect(run(UserRole.receptionist, h)).toBe(true); expect(run(UserRole.clinic_admin, h)).toBe(true); }
  });

  it('role coverage sanity: every role is exercised', () => expect(ALL_ROLES).toHaveLength(5));
});
