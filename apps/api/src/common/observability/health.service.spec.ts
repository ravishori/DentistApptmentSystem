jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { HealthService, InfraHealthMonitor } from './health.service';
import { MetricsService } from './metrics.service';
import { setLogSink } from './structured-logger';

let logs: any[]; let restore: () => void;
beforeEach(() => { logs = []; restore = setLogSink((l) => logs.push(JSON.parse(l))); });
afterEach(() => restore());

const prismaWith = (impl: () => Promise<unknown>) => ({ $queryRaw: jest.fn(impl) }) as any;

describe('HealthService', () => {
  it('database up → ok; sets the db_up gauge', async () => {
    const m = new MetricsService();
    const h = new HealthService(prismaWith(async () => [{ '?column?': 1 }]), { ping: async () => undefined } as any, m);
    expect(await h.readiness()).toEqual({ status: 'ok', checks: { database: 'up', cache: 'up' } });
    expect(m.getGauge('db_up')).toBe(1);
  });
  it('database down → unavailable, retried once (idempotent probe), counted, and the error text is not in the result', async () => {
    const m = new MetricsService();
    const prisma = prismaWith(async () => { throw new Error("Can't reach database server at postgresql://u:pw@h/db"); });
    const r = await new HealthService(prisma, { ping: async () => undefined } as any, m).readiness();
    expect(r).toEqual({ status: 'unavailable', checks: { database: 'down', cache: 'up' } });
    expect(JSON.stringify(r)).not.toMatch(/pw@h|postgres/);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(m.getGauge('db_up')).toBe(0);
    expect(m.getCounter('db_health_failures_total')).toBe(1);
    expect(JSON.stringify(logs)).not.toContain('pw@h');
  });
  it('a single dropped connection is absorbed by the one retry', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValueOnce(new Error('Connection terminated')).mockResolvedValue([1]) } as any;
    expect((await new HealthService(prisma).readiness()).status).toBe('ok');
  });
  it('a hanging database probe is cut off by the timeout instead of hanging the endpoint', async () => {
    const h = new HealthService(prismaWith(() => new Promise(() => undefined)));
    const t0 = Date.now();
    expect((await h.checkDatabase(50)).ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
  it('cache down only degrades (the API can still serve); no cache configured counts as up', async () => {
    const h = new HealthService(prismaWith(async () => [1]), { ping: async () => { throw new Error('ECONNREFUSED'); } } as any);
    expect(await h.readiness()).toEqual({ status: 'degraded', checks: { database: 'up', cache: 'down' } });
    expect((await new HealthService(prismaWith(async () => [1])).readiness()).checks.cache).toBe('up');
  });
});

describe('InfraHealthMonitor (sustained outage → one alert, one recovery)', () => {
  const cfg = (o: Record<string, string> = {}) => ({ get: (k: string) => ({ NODE_ENV: 'test', HEALTH_FAILURE_THRESHOLD: '3', HEALTH_MONITOR_INTERVAL_MS: '30000', ...o })[k] }) as any;
  const setup = () => {
    const state = { db: true, cache: true };
    const health = { checkDatabase: jest.fn(async () => ({ ok: state.db, latencyMs: 1 })), checkCache: jest.fn(async () => ({ ok: state.cache, latencyMs: 1 })) } as any;
    const alerts = { report: jest.fn() } as any;
    const metrics = new MetricsService();
    return { state, alerts, metrics, mon: new InfraHealthMonitor(health, alerts, cfg(), metrics) };
  };

  it('does not alert on a single or double failed probe', async () => {
    const { state, alerts, mon } = setup();
    state.db = false; await mon.tick(); await mon.tick();
    expect(alerts.report).not.toHaveBeenCalled();
  });
  it('alerts ONCE (critical) at the threshold and stays quiet while the outage continues', async () => {
    const { state, alerts, mon, metrics } = setup();
    state.db = false;
    for (let i = 0; i < 8; i++) await mon.tick();
    expect(alerts.report).toHaveBeenCalledTimes(1);
    expect(alerts.report).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical', code: 'DB_UNAVAILABLE', subsystem: 'database', discriminator: 'sustained-outage' }));
    expect(alerts.report.mock.calls[0][0].summary).toMatch(/3 consecutive failed probes/);
    expect(metrics.getCounter('infra_outages_total', { component: 'database' })).toBe(1);
  });
  it('sends one recovery notice when the dependency comes back, and re-arms for the next outage', async () => {
    const { state, alerts, mon } = setup();
    state.db = false; for (let i = 0; i < 3; i++) await mon.tick();
    state.db = true; await mon.tick(); await mon.tick();
    expect(alerts.report).toHaveBeenCalledTimes(2);
    expect(alerts.report.mock.calls[1][0]).toMatchObject({ kind: 'recovery', code: 'DB_UNAVAILABLE_RECOVERED' });
    state.db = false; for (let i = 0; i < 3; i++) await mon.tick();
    expect(alerts.report).toHaveBeenCalledTimes(3);
  });
  it('tracks database and cache independently', async () => {
    const { state, alerts, mon } = setup();
    state.cache = false; for (let i = 0; i < 3; i++) await mon.tick();
    expect(alerts.report).toHaveBeenCalledWith(expect.objectContaining({ code: 'CACHE_UNAVAILABLE', subsystem: 'cache', severity: 'error' }));
  });
  it('a throwing probe or alert channel never escapes tick()', async () => {
    const health = { checkDatabase: jest.fn(async () => { throw new Error('probe bug'); }), checkCache: jest.fn() } as any;
    const mon = new InfraHealthMonitor(health, { report: jest.fn() } as any, cfg());
    await expect(mon.tick()).resolves.toBeUndefined();
    expect(logs.some((l) => l.event === 'health.monitor_error')).toBe(true);
  });
  it('is inert in the test environment and when disabled (no timers started)', () => {
    const { mon } = setup(); mon.onModuleInit(); expect((mon as any).timer).toBeNull();
    const m2 = new InfraHealthMonitor({} as any, {} as any, cfg({ NODE_ENV: 'production', HEALTH_MONITOR_ENABLED: 'false' })); m2.onModuleInit(); expect((m2 as any).timer).toBeNull();
    const m3 = new InfraHealthMonitor({ checkDatabase: async () => ({ ok: true }), checkCache: async () => ({ ok: true }) } as any, {} as any, cfg({ NODE_ENV: 'production', HEALTH_MONITOR_INTERVAL_MS: '60000' }));
    m3.onModuleInit(); expect((m3 as any).timer).not.toBeNull(); m3.onModuleDestroy(); expect((m3 as any).timer).toBeNull();
  });
});
