/**
 * AuthService behaviour (registration, login, lockout, refresh rotation, logout) with an in-memory fake of the
 * persistence layer, real bcrypt and real JWT signing. Pins the EXISTING intended behaviour; it does not add policy.
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

jest.setTimeout(30_000);          // bcrypt cost 12 is deliberately slow; the full parallel suite is CPU-bound

const CFG: Record<string, string> = {
  'jwt.secret': 'test-access-secret-' + 'a1B2c3D4'.repeat(4), 'jwt.refreshSecret': 'test-refresh-secret-' + 'Z9y8X7w6'.repeat(4), 'jwt.expiresIn': '15m',
};

function makeFakes() {
  const clinics: any[] = []; const users: any[] = []; const sessions: any[] = [];
  let seq = 0; const id = (p: string) => `${p}-${++seq}`;
  const prisma: any = {
    clinic: {
      findUnique: async ({ where }: any) => clinics.find((c) => c.email === where.email) ?? null,
      create: async ({ data }: any) => { const c = { id: id('clinic'), ...data }; clinics.push(c); return c; },
    },
    user: {
      create: async ({ data }: any) => { const u = { id: id('user'), isActive: true, failedLoginCount: 0, lockedUntil: null, ...data }; users.push(u); return u; },
      findFirst: async ({ where }: any) => {
        const u = users.find((x) => x.email === where.email && (!where.clinic || clinics.find((c) => c.id === x.clinicId)?.slug === where.clinic.slug));
        return u ? { ...u, clinic: clinics.find((c) => c.id === u.clinicId) } : null;
      },
      update: async ({ where, data }: any) => Object.assign(users.find((u) => u.id === where.id), data),
    },
    userSession: {
      create: async ({ data }: any) => { const s = { id: id('sess'), revokedAt: null, ...data }; sessions.push(s); return s; },
      findFirst: async ({ where }: any) => {
        const s = sessions.find((x) => x.refreshToken === where.refreshToken && x.userId === where.userId && x.revokedAt === null && x.expiresAt > where.expiresAt.gt);
        if (!s) return null;
        const user = users.find((u) => u.id === s.userId);
        return { ...s, user: { ...user, clinic: clinics.find((c) => c.id === user.clinicId) } };
      },
      update: async ({ where, data }: any) => Object.assign(sessions.find((s) => s.id === where.id), data),
      updateMany: async ({ where, data }: any) => {
        const hit = sessions.filter((s) => s.userId === where.userId && (where.refreshToken === undefined || s.refreshToken === where.refreshToken) && (where.revokedAt !== null || s.revokedAt === null));
        hit.forEach((s) => Object.assign(s, data)); return { count: hit.length };
      },
    },
  };
  const blacklist = { revoke: jest.fn(async () => undefined), revokeAllForUser: jest.fn(async () => undefined) };
  const svc = new AuthService(prisma, new JwtService({}), { get: (k: string) => CFG[k] } as any, {} as any, blacklist as any);
  return { svc, clinics, users, sessions, blacklist };
}

const reg = { clinicName: 'Smile Dental', ownerName: 'Dr Priya', email: 'priya@smile.test', phone: '+919876543210', password: 'S3cure-Passw0rd!' };

describe('register', () => {
  it('creates the tenant (14-day starter trial) and its clinic_admin with a bcrypt hash, never the plaintext', async () => {
    const f = makeFakes();
    const r = await f.svc.register(reg);
    expect(f.clinics).toHaveLength(1);
    expect(f.clinics[0]).toMatchObject({ plan: 'starter', subStatus: 'trial', email: reg.email });
    const days = (f.clinics[0].trialEndsAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9); expect(days).toBeLessThan(14.1);
    const u = f.users[0];
    expect(u.role).toBe('clinic_admin');
    expect(u.passwordHash).not.toBe(reg.password);
    expect(await bcrypt.compare(reg.password, u.passwordHash)).toBe(true);
    expect(u.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(r.user).toMatchObject({ email: reg.email, role: 'clinic_admin' });
    expect(JSON.stringify(r)).not.toContain('passwordHash');
    expect(f.sessions).toHaveLength(1);
  }, 20000);
  it('a duplicate clinic email → 409 and nothing is created', async () => {
    const f = makeFakes();
    await f.svc.register(reg);
    await expect(f.svc.register(reg)).rejects.toBeInstanceOf(ConflictException);
    expect(f.clinics).toHaveLength(1); expect(f.users).toHaveLength(1);
  }, 20000);
  it('the issued access token carries the tenant and role; the refresh token only the subject', async () => {
    const f = makeFakes();
    const r = await f.svc.register(reg);
    const jwt = new JwtService({});
    const access: any = jwt.verify(r.accessToken, { secret: CFG['jwt.secret'] });
    expect(access).toMatchObject({ sub: f.users[0].id, role: 'clinic_admin', clinicId: f.clinics[0].id, email: reg.email });
    const refresh: any = jwt.verify(r.refreshToken, { secret: CFG['jwt.refreshSecret'] });
    expect(Object.keys(refresh).sort()).toEqual(['exp', 'iat', 'jti', 'sub']);
    expect(() => jwt.verify(r.refreshToken, { secret: CFG['jwt.secret'] })).toThrow();   // secrets are distinct
  }, 20000);
});

describe('login, invalid credentials and lockout', () => {
  let f: ReturnType<typeof makeFakes>;
  beforeEach(async () => { f = makeFakes(); await f.svc.register(reg); f.sessions.length = 0; }, 20000);

  it('valid credentials → token pair + a stored session; counters reset and lastLoginAt set', async () => {
    f.users[0].failedLoginCount = 3;
    const r = await f.svc.login({ email: reg.email, password: reg.password });
    expect(r.accessToken).toBeTruthy(); expect(r.refreshToken).toBeTruthy();
    expect(f.sessions).toHaveLength(1);
    expect(f.users[0]).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    expect(f.users[0].lastLoginAt).toBeInstanceOf(Date);
  });
  it('unknown email and wrong password give the SAME generic error', async () => {
    const a = await f.svc.login({ email: 'nobody@x.test', password: 'whatever12' }).catch((e) => e);
    const b = await f.svc.login({ email: reg.email, password: 'wrong-password' }).catch((e) => e);
    for (const e of [a, b]) { expect(e).toBeInstanceOf(UnauthorizedException); expect(e.message).toBe('Invalid credentials'); }
    expect(f.sessions).toHaveLength(0);
  });
  it('each wrong password increments the counter; the 5th failure locks the account for 15 minutes', async () => {
    for (let i = 1; i <= 4; i++) {
      await expect(f.svc.login({ email: reg.email, password: 'bad-pass-' + i })).rejects.toThrow('Invalid credentials');
      expect(f.users[0].failedLoginCount).toBe(i);
      expect(f.users[0].lockedUntil).toBeNull();
    }
    await expect(f.svc.login({ email: reg.email, password: 'bad-pass-5' })).rejects.toThrow('Invalid credentials');
    const mins = (f.users[0].lockedUntil.getTime() - Date.now()) / 60_000;
    expect(f.users[0].failedLoginCount).toBe(5);
    expect(mins).toBeGreaterThan(14.9); expect(mins).toBeLessThan(15.1);
  });
  it('while locked even the CORRECT password is refused and no session is issued', async () => {
    f.users[0].failedLoginCount = 5; f.users[0].lockedUntil = new Date(Date.now() + 10 * 60_000);
    await expect(f.svc.login({ email: reg.email, password: reg.password })).rejects.toThrow(/locked/i);
    expect(f.sessions).toHaveLength(0);
  });
  it('after the lock expires the correct password works and clears the lock', async () => {
    f.users[0].failedLoginCount = 5; f.users[0].lockedUntil = new Date(Date.now() - 1000);
    await expect(f.svc.login({ email: reg.email, password: reg.password })).resolves.toBeDefined();
    expect(f.users[0]).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });
  it('a deactivated account cannot log in', async () => {
    f.users[0].isActive = false;
    await expect(f.svc.login({ email: reg.email, password: reg.password })).rejects.toThrow(/deactivated/i);
    expect(f.sessions).toHaveLength(0);
  });
  it('clinicSlug narrows the lookup to that clinic', async () => {
    await expect(f.svc.login({ email: reg.email, password: reg.password, clinicSlug: 'some-other-clinic' })).rejects.toThrow('Invalid credentials');
    await expect(f.svc.login({ email: reg.email, password: reg.password, clinicSlug: f.clinics[0].slug })).resolves.toBeDefined();
  });
  it('the login response never contains the password hash', async () => {
    expect(JSON.stringify(await f.svc.login({ email: reg.email, password: reg.password }))).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});

describe('refresh rotation and logout', () => {
  let f: ReturnType<typeof makeFakes>; let pair: { accessToken: string; refreshToken: string };
  beforeEach(async () => { f = makeFakes(); pair = await f.svc.register(reg); }, 20000);

  it('a valid refresh token issues a NEW pair and revokes the old session', async () => {
    const next = await f.svc.refresh(pair.refreshToken);
    expect(next.refreshToken).not.toBe(pair.refreshToken);
    expect(f.sessions.filter((s) => s.revokedAt === null)).toHaveLength(1);
    expect(f.sessions.find((s) => s.refreshToken === pair.refreshToken).revokedAt).toBeInstanceOf(Date);
  });
  it('two tokens issued to one user in the same second are different (regression: identical tokens made replay possible)', async () => {
    const a = await f.svc.login({ email: reg.email, password: reg.password });
    const b = await f.svc.login({ email: reg.email, password: reg.password });
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });
  it('REPLAY: the already-rotated refresh token is rejected', async () => {
    await f.svc.refresh(pair.refreshToken);
    await expect(f.svc.refresh(pair.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it.each([
    ['garbage', 'not-a-jwt'],
    ['signed with the ACCESS secret', null],
  ])('an invalid refresh token (%s) → 401', async (_n, tok) => {
    const bad = tok ?? new JwtService({}).sign({ sub: f.users[0].id }, { secret: CFG['jwt.secret'], expiresIn: '1h' });
    await expect(f.svc.refresh(bad)).rejects.toThrow('Invalid refresh token');
  });
  it('an expired refresh token → 401', async () => {
    const expired = new JwtService({}).sign({ sub: f.users[0].id }, { secret: CFG['jwt.refreshSecret'], expiresIn: '-10s' });
    await expect(f.svc.refresh(expired)).rejects.toThrow('Invalid refresh token');
  });
  it('a correctly signed token with no stored session (never issued / session expired) → 401', async () => {
    const orphan = new JwtService({}).sign({ sub: f.users[0].id }, { secret: CFG['jwt.refreshSecret'], expiresIn: '1h' });
    await expect(f.svc.refresh(orphan)).rejects.toThrow(/Session expired/);
  });
  it('a session whose stored expiry has passed → 401', async () => {
    f.sessions[0].expiresAt = new Date(Date.now() - 1000);
    await expect(f.svc.refresh(pair.refreshToken)).rejects.toThrow(/Session expired/);
  });
  it('a refresh token cannot be used by another user (subject must match the session)', async () => {
    const other = await f.svc.register({ ...reg, email: 'other@smile.test' });
    // other user's token string, but claims are verified against the stored row for THAT token only
    await expect(f.svc.refresh(other.refreshToken)).resolves.toBeDefined();
    const forged = new JwtService({}).sign({ sub: f.users[0].id }, { secret: CFG['jwt.refreshSecret'], expiresIn: '1h' });
    await expect(f.svc.refresh(forged)).rejects.toThrow(/Session expired/);
  }, 20000);
  it('logout revokes the session and (when given) the access token', async () => {
    await f.svc.logout(f.users[0].id, pair.refreshToken, pair.accessToken);
    expect(f.sessions[0].revokedAt).toBeInstanceOf(Date);
    expect(f.blacklist.revoke).toHaveBeenCalledWith(pair.accessToken);
    await expect(f.svc.refresh(pair.refreshToken)).rejects.toThrow(/Session expired/);
  });
  it('logout of one user cannot revoke another user\'s session', async () => {
    const other = await f.svc.register({ ...reg, email: 'other@smile.test' });
    await f.svc.logout(f.users[0].id, other.refreshToken);
    expect(f.sessions.find((s) => s.refreshToken === other.refreshToken).revokedAt).toBeNull();
  }, 20000);
  it('revokeAllSessions invalidates every refresh token and marks the user for access-token revocation', async () => {
    await f.svc.revokeAllSessions(f.users[0].id);
    expect(f.sessions.every((s) => s.revokedAt instanceof Date)).toBe(true);
    expect(f.blacklist.revokeAllForUser).toHaveBeenCalledWith(f.users[0].id);
  });
});
