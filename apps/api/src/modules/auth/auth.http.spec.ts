/**
 * HTTP-level authentication regression tests: the REAL passport JwtStrategy, JwtAuthGuard, Roles/Permissions guards,
 * throttling and ValidationPipe, with real JWT signing. Only persistence (user lookup), the token blacklist and the
 * AuthService internals are faked. Pins existing intended behaviour for invalid/expired/revoked tokens, role
 * enforcement, input validation and rate limits.
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });
jest.setTimeout(30_000);          // booting a Nest app per test can exceed 5 s while the whole suite runs in parallel

import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TokenBlacklistService } from '../../cache/token-blacklist.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppointmentsController } from '../appointments/appointments.controller';
import { AppointmentsService } from '../appointments/appointments.service';
import { SlotsService } from '../appointments/slots.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

const SECRET = 'http-spec-access-secret-' + 'Qw3rTy9u'.repeat(4);
const CLINIC = '11111111-1111-4111-8111-111111111111';
const jwt = new JwtService({});

/** DB state the strategy consults. */
const db: { users: Record<string, { id: string; isActive: boolean; email: string; role: string; clinicId: string }> } = { users: {} };
const revokedTokens = new Set<string>();
let userRevokedAt: number | null = null;

const blacklist = {
  isRevoked: async (t: string) => revokedTokens.has(t),
  getUserRevocationTime: async () => userRevokedAt,
  revoke: async (t: string) => { revokedTokens.add(t); },
};
const authSvc = {
  register: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' })),
  login: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' })),
  refresh: jest.fn(async () => ({ accessToken: 'a2', refreshToken: 'r2' })),
  logout: jest.fn(async (_uid: string, _rt: string, at?: string) => { if (at) await blacklist.revoke(at); }),
};
const slots = { generate: jest.fn(async () => ({ created: 1 })) };

const sign = (claims: Record<string, unknown> = {}, opts: { secret?: string; expiresIn?: string | number } = {}) =>
  jwt.sign({ sub: 'u-1', email: 'u1@x.test', role: 'clinic_admin', clinicId: CLINIC, clinicSlug: 's', clinicName: 'C', ...claims }, { secret: opts.secret ?? SECRET, expiresIn: opts.expiresIn ?? '15m' } as any);

async function boot(globalLimit = 1000) {
  const mod = await Test.createTestingModule({
    imports: [
      PassportModule.register({ defaultStrategy: 'jwt' }),
      JwtModule.register({}),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: globalLimit }]),
    ],
    controllers: [AuthController, AppointmentsController],
    providers: [
      JwtStrategy,
      { provide: ConfigService, useValue: { get: (k: string) => (k === 'jwt.secret' ? SECRET : undefined) } },
      { provide: PrismaService, useValue: { user: { findUnique: async ({ where }: any) => db.users[where.id] ?? null } } },
      { provide: TokenBlacklistService, useValue: blacklist },
      { provide: AuthService, useValue: authSvc },
      { provide: AppointmentsService, useValue: {} },
      { provide: SlotsService, useValue: slots },
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_GUARD, useClass: PermissionsGuard },
    ],
  }).compile();
  const app = mod.createNestApplication({ logger: ['error'] });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true, transformOptions: { enableImplicitConversion: true } }));
  await app.listen(0, '127.0.0.1');
  return { app, base: `${await app.getUrl()}/api/v1` };
}

async function call(base: string, method: string, path: string, opts: { token?: string; header?: string; body?: unknown } = {}) {
  const auth = opts.header ?? (opts.token ? `Bearer ${opts.token}` : undefined);
  const r = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let json: any = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}

beforeEach(() => {
  jest.clearAllMocks(); revokedTokens.clear(); userRevokedAt = null;
  db.users = { 'u-1': { id: 'u-1', isActive: true, email: 'u1@x.test', role: 'clinic_admin', clinicId: CLINIC } };
});

describe('token validation on a protected route (GET /auth/me)', () => {
  let ctx: { app: INestApplication; base: string };
  beforeAll(async () => { ctx = await boot(); });
  afterAll(async () => { await ctx.app.close(); });
  const me = (o: Parameters<typeof call>[3]) => call(ctx.base, 'GET', '/auth/me', o);

  it('valid token → 200 with the caller', async () => {
    const r = await me({ token: sign() });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).toContain('u1@x.test');
  });
  it.each([
    ['no Authorization header', {}],
    ['empty bearer', { header: 'Bearer ' }],
    ['Basic scheme', { header: 'Basic dTpw' }],
    ['garbage token', { token: 'not.a.jwt' }],
    ['truncated token', { token: sign().slice(0, -8) }],
  ])('%s → 401', async (_n, o) => { expect((await me(o as any)).status).toBe(401); });

  it('token signed with a different secret → 401', async () => { expect((await me({ token: sign({}, { secret: 'attacker-secret-attacker-secret-12345' }) })).status).toBe(401); });
  it('expired token → 401', async () => { expect((await me({ token: sign({}, { expiresIn: -30 }) })).status).toBe(401); });
  it('unsigned token (alg=none) → 401', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u-1', role: 'super_admin', clinicId: CLINIC, exp: Math.floor(Date.now() / 1000) + 600 })}.`;
    expect((await me({ token: none })).status).toBe(401);
  });
  it('a REFRESH token (signed with the refresh secret) is not accepted as an access token', async () => {
    expect((await me({ token: jwt.sign({ sub: 'u-1' }, { secret: 'a-different-refresh-secret-xxxxxxxxxxxx', expiresIn: '30d' }) })).status).toBe(401);
  });
  it('valid signature but the user no longer exists → 401', async () => { expect((await me({ token: sign({ sub: 'ghost' }) })).status).toBe(401); });
  it('valid signature but the user was deactivated → 401', async () => {
    db.users['u-1'].isActive = false;
    expect((await me({ token: sign() })).status).toBe(401);
  });
  it('individually revoked token (after logout) → 401', async () => {
    const t = sign(); revokedTokens.add(t);
    const r = await me({ token: t });
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.json)).toMatch(/revoked/i);
  });
  it('user-level revocation: a token issued BEFORE the marker is rejected, one issued after is accepted', async () => {
    const old = jwt.sign({ sub: 'u-1', email: 'u1@x.test', role: 'clinic_admin', clinicId: CLINIC, iat: Math.floor(Date.now() / 1000) - 3600 }, { secret: SECRET, expiresIn: '2h' });
    userRevokedAt = Date.now() - 60_000;
    const r = await me({ token: old });
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.json)).toMatch(/invalidated/i);
    expect((await me({ token: sign() })).status).toBe(200);
  });
  it('the role comes from the DATABASE, not from the token claim (privilege escalation via claims is impossible)', async () => {
    db.users['u-1'].role = 'assistant';
    const r = await me({ token: sign({ role: 'super_admin' }) });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).toContain('"role":"assistant"');
    expect(JSON.stringify(r.json)).not.toContain('super_admin');
  });
});

describe('role enforcement (POST /appointments/slots/generate is admin-only)', () => {
  let ctx: { app: INestApplication; base: string };
  beforeAll(async () => { ctx = await boot(); });
  afterAll(async () => { await ctx.app.close(); });
  const body = { dentistId: '55555555-5555-4555-8555-555555555555', date: '2031-06-16', startTime: '09:00', endTime: '12:00', slotDurationMin: 30 };

  it.each(['assistant', 'receptionist', 'dentist'])('%s → 403 and the service is not called', async (role) => {
    db.users['u-1'].role = role;
    const r = await call(ctx.base, 'POST', '/appointments/slots/generate', { token: sign(), body });
    expect(r.status).toBe(403);
    expect(slots.generate).not.toHaveBeenCalled();
  });
  it('clinic_admin passes the role guard', async () => {
    const r = await call(ctx.base, 'POST', '/appointments/slots/generate', { token: sign(), body });
    expect(r.status).not.toBe(403);
    expect(r.status).not.toBe(401);
  });
  it('a role claim inside the token cannot unlock the route for an assistant', async () => {
    db.users['u-1'].role = 'assistant';
    expect((await call(ctx.base, 'POST', '/appointments/slots/generate', { token: sign({ role: 'clinic_admin' }), body })).status).toBe(403);
  });
  it('no token → 401 (not 403)', async () => { expect((await call(ctx.base, 'POST', '/appointments/slots/generate', { body })).status).toBe(401); });
});

describe('public auth endpoints: validation and routing', () => {
  let ctx: { app: INestApplication; base: string };
  // fresh app per test: register/login carry per-route rate limits that must not bleed between cases
  beforeEach(async () => { ctx = await boot(); });
  afterEach(async () => { await ctx.app.close(); });
  const goodReg = { clinicName: 'Smile', ownerName: 'Dr P', email: 'p@smile.test', phone: '+919876543210', password: 'longenough1' };

  it('register/login/refresh need no token', async () => {
    expect((await call(ctx.base, 'POST', '/auth/register', { body: goodReg })).status).toBe(201);
    expect((await call(ctx.base, 'POST', '/auth/login', { body: { email: 'p@smile.test', password: 'x' } })).status).toBe(200);
    expect((await call(ctx.base, 'POST', '/auth/refresh', { body: { refreshToken: 'r' } })).status).toBe(200);
  });
  it.each([
    ['missing clinicName', { ...goodReg, clinicName: undefined }],
    ['bad email', { ...goodReg, email: 'not-an-email' }],
    ['password shorter than 8', { ...goodReg, password: 'short' }],
    ['bad phone', { ...goodReg, phone: '12' }],
    ['password a number (no implicit coercion)', { ...goodReg, password: 12345678 }],
    ['password an object (would coerce to "[object Object]")', { ...goodReg, password: { a: 1 } }],
    ['empty body', {}],
  ])('register rejects %s with 400 and never reaches the service', async (_n, b) => {
    expect((await call(ctx.base, 'POST', '/auth/register', { body: b })).status).toBe(400);
    expect(authSvc.register).not.toHaveBeenCalled();
  });
  it.each([
    ['bad email', { email: 'x', password: 'p' }], ['missing password', { email: 'a@b.co' }], ['empty', {}],
    ['password an object', { email: 'a@b.co', password: { a: 1 } }], ['password a number', { email: 'a@b.co', password: 12345678 }],
  ])('login rejects %s with 400', async (_n, b) => {
    expect((await call(ctx.base, 'POST', '/auth/login', { body: b })).status).toBe(400);
    expect(authSvc.login).not.toHaveBeenCalled();
  });
  it('refresh without a token string → 400', async () => {
    expect((await call(ctx.base, 'POST', '/auth/refresh', { body: {} })).status).toBe(400);
    expect(authSvc.refresh).not.toHaveBeenCalled();
  });
  it('unexpected body fields (role, clinicId) are stripped from registration', async () => {
    await call(ctx.base, 'POST', '/auth/register', { body: { ...goodReg, role: 'super_admin', clinicId: CLINIC, plan: 'enterprise' } });
    const dto = (authSvc.register.mock.calls[0] as any[])[0];
    expect(dto).not.toHaveProperty('role'); expect(dto).not.toHaveProperty('clinicId'); expect(dto).not.toHaveProperty('plan');
  });
});

describe('logout and session invalidation', () => {
  let ctx: { app: INestApplication; base: string };
  beforeAll(async () => { ctx = await boot(); });
  afterAll(async () => { await ctx.app.close(); });

  it('logout needs authentication', async () => {
    expect((await call(ctx.base, 'POST', '/auth/logout', { body: { refreshToken: 'r' } })).status).toBe(401);
    expect(authSvc.logout).not.toHaveBeenCalled();
  });
  it('logout passes the refresh token AND the bearer access token to the service (regression: the access token was never revoked)', async () => {
    const t = sign();
    const r = await call(ctx.base, 'POST', '/auth/logout', { token: t, body: { refreshToken: 'rt-1' } });
    expect(r.status).toBe(204);
    expect(authSvc.logout).toHaveBeenCalledWith('u-1', 'rt-1', t);
  });
  it('after logout the SAME access token is rejected immediately', async () => {
    const t = sign();
    expect((await call(ctx.base, 'GET', '/auth/me', { token: t })).status).toBe(200);
    await call(ctx.base, 'POST', '/auth/logout', { token: t, body: { refreshToken: 'rt-1' } });
    expect((await call(ctx.base, 'GET', '/auth/me', { token: t })).status).toBe(401);
    // a token revoked individually does not affect a differently-issued token of the same user
    expect((await call(ctx.base, 'GET', '/auth/me', { token: sign({ email: 'u1@x.test', iat: Math.floor(Date.now() / 1000) - 5 }) })).status).toBe(200);
  });
  it('logout without a refresh token string → 400', async () => {
    expect((await call(ctx.base, 'POST', '/auth/logout', { token: sign(), body: {} })).status).toBe(400);
  });
});

describe('rate limiting of credential endpoints', () => {
  let ctx: { app: INestApplication; base: string };
  beforeEach(async () => { ctx = await boot(1000); });
  afterEach(async () => { await ctx.app.close(); });
  const login = (base: string) => call(base, 'POST', '/auth/login', { body: { email: 'a@b.co', password: 'x' } });

  it('login: 10 per minute, the 11th is 429 and never reaches the service', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await login(ctx.base)).status);
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(codes.slice(10)).toEqual([429, 429]);
    expect(authSvc.login).toHaveBeenCalledTimes(10);
  });
  it('register: 5 per minute, the 6th is 429', async () => {
    const b = { clinicName: 'S', ownerName: 'D', email: 'p@smile.test', phone: '+919876543210', password: 'longenough1' };
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await call(ctx.base, 'POST', '/auth/register', { body: b })).status);
    expect(codes.slice(0, 5)).toEqual(Array(5).fill(201));
    expect(codes.slice(5)).toEqual([429, 429]);
  });
});
