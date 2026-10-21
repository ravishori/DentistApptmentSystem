/**
 * The platform-operator endpoints over real HTTP with the REAL RolesGuard, PermissionsGuard and ThrottlerGuard.
 * Only authentication (an x-test-user header) and the alert service are fakes, so no SMTP server or provider is
 * contacted. Proves: the alert-test endpoint (and its siblings) are super_admin-only, an unauthorised call has no side
 * effect, and the endpoint is rate limited.
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });
jest.setTimeout(30_000);          // booting a Nest app per test can exceed 5 s while the whole suite runs in parallel

import { CanActivate, ExecutionContext, Injectable, INestApplication, UnauthorizedException, ValidationPipe, VersioningType } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { RolesGuard } from '../guards/roles.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { ErrorEmailService } from '../logger/error-email.service';
import { MetricsService } from './metrics.service';
import { OpsController } from './ops.controller';
import { setLogSink } from './structured-logger';

@Injectable()
class FakeAuth implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const raw = req.headers['x-test-user'];
    if (!raw) throw new UnauthorizedException();
    req.user = JSON.parse(String(raw));
    req.clinicId = req.user.clinicId;
    return true;
  }
}

const ROLES = ['clinic_admin', 'dentist', 'receptionist', 'assistant'];
const who = (role: string) => JSON.stringify({ id: `u-${role}`, email: `${role}@x.test`, role, clinicId: '11111111-1111-4111-8111-111111111111' });

function makeAlerts(result: Promise<unknown> | null = Promise.resolve({ state: 'smtp_accepted', attempts: 1 })) {
  return {
    report: jest.fn(() => (result ? { outcome: 'queued', id: 'alert-1', result } : { outcome: 'disabled', reason: 'alerting is not configured' })),
    getStatus: jest.fn(() => ({ enabled: true, transport: 'smtp', recipientsConfigured: 1 })),
    verifyConnection: jest.fn(async () => ({ ok: true })),
  };
}

async function boot(alerts = makeAlerts(), throttleGlobal = 1000) {
  const metrics = new MetricsService();
  const mod = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: throttleGlobal }])],
    controllers: [OpsController],
    providers: [
      { provide: ErrorEmailService, useValue: alerts }, { provide: MetricsService, useValue: metrics },
      { provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_GUARD, useClass: FakeAuth },
      { provide: APP_GUARD, useClass: RolesGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
      { provide: APP_FILTER, useClass: HttpExceptionFilter },
    ],
  }).compile();
  const app: INestApplication = mod.createNestApplication({ logger: false });
  app.setGlobalPrefix('api'); app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return { app, base: `${await app.getUrl()}/api/v1`, alerts };
}
const call = async (base: string, method: string, path: string, role?: string) => {
  const r = await fetch(`${base}${path}`, { method, headers: role ? { 'x-test-user': who(role) } : {} });
  let j: any = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, json: j };
};

let restore: () => void;
beforeEach(() => { restore = setLogSink(() => undefined); });
afterEach(() => restore());

describe('POST /ops/alerts/test is super_admin only', () => {
  it.each(ROLES)('%s → 403, and NO alert is created, queued or sent', async (role) => {
    const { app, base, alerts } = await boot();
    const r = await call(base, 'POST', '/ops/alerts/test?wait=true', role);
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('FORBIDDEN');
    expect(alerts.report).not.toHaveBeenCalled();
    await app.close();
  });
  it('unauthenticated → 401 and no side effect', async () => {
    const { app, base, alerts } = await boot();
    const r = await call(base, 'POST', '/ops/alerts/test');
    expect(r.status).toBe(401);
    expect(alerts.report).not.toHaveBeenCalled();
    await app.close();
  });
  it('super_admin → 200: a clearly labelled TEST alert is requested', async () => {
    const { app, base, alerts } = await boot();
    const r = await call(base, 'POST', '/ops/alerts/test', 'super_admin');
    expect(r.status).toBe(200);
    expect(alerts.report).toHaveBeenCalledTimes(1);
    expect(alerts.report).toHaveBeenCalledWith(expect.objectContaining({ kind: 'test', code: 'TEST_ALERT', subsystem: 'ops', severity: 'warning' }));
    expect(JSON.stringify(alerts.report.mock.calls[0])).not.toMatch(/@|password|token/i);
    await app.close();
  });
  it('?wait=true reports the SMTP result; failures and disabled alerting are surfaced, not hidden', async () => {
    let c = await boot(makeAlerts(Promise.resolve({ state: 'smtp_accepted', attempts: 1 })));
    let r = await call(c.base, 'POST', '/ops/alerts/test?wait=true', 'super_admin');
    expect(r.json.data ?? r.json).toMatchObject({ outcome: 'smtp_accepted', alertId: 'alert-1' });
    await c.app.close();
    c = await boot(makeAlerts(Promise.resolve({ state: 'failed', attempts: 3, reason: 'EAUTH' })));
    r = await call(c.base, 'POST', '/ops/alerts/test?wait=true', 'super_admin');
    expect(r.status).toBe(200);
    expect(r.json.data ?? r.json).toMatchObject({ outcome: 'failed', reason: 'EAUTH' });
    await c.app.close();
    c = await boot(makeAlerts(null));
    r = await call(c.base, 'POST', '/ops/alerts/test?wait=true', 'super_admin');
    expect(r.json.data ?? r.json).toMatchObject({ outcome: 'disabled' });
    await c.app.close();
  });
  it('is rate limited: 3 per minute, the 4th is 429 and creates no alert', async () => {
    const { app, base, alerts } = await boot();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await call(base, 'POST', '/ops/alerts/test', 'super_admin')).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect(alerts.report).toHaveBeenCalledTimes(3);
    await app.close();
  });
});

describe('the sibling operator endpoints share the same restriction (class-level @Roles)', () => {
  it.each([['GET', '/ops/metrics'], ['GET', '/ops/alerts/status'], ['GET', '/ops/alerts/status?verify=true']])('%s %s: 401 anonymous, 403 for every tenant role, 200 for super_admin', async (method, path) => {
    const { app, base, alerts } = await boot();
    expect((await call(base, method, path)).status).toBe(401);
    for (const role of ROLES) expect([role, (await call(base, method, path, role)).status]).toEqual([role, 403]);
    expect((await call(base, method, path, 'super_admin')).status).toBe(200);
    expect(alerts.verifyConnection).toHaveBeenCalledTimes(path.includes('verify=true') ? 1 : 0);
    await app.close();
  });
  it('the status response never includes addresses, hosts or credentials', async () => {
    const { app, base } = await boot();
    const r = await call(base, 'GET', '/ops/alerts/status?verify=true', 'super_admin');
    expect(JSON.stringify(r.json)).not.toMatch(/@|smtp\.|password|secret/i);
    await app.close();
  });
  it('metrics can be read as JSON or Prometheus text by super_admin only', async () => {
    const { app, base } = await boot();
    const j = await call(base, 'GET', '/ops/metrics?format=prometheus', 'super_admin');
    expect(JSON.stringify(j.json)).toContain('process_uptime_seconds');
    expect((await call(base, 'GET', '/ops/metrics?format=prometheus', 'dentist')).status).toBe(403);
    await app.close();
  });
});
