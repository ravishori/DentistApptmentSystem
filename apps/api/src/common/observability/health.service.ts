import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { ErrorEmailService } from '../logger/error-email.service';
import { MetricsService } from './metrics.service';
import { logEvent } from './structured-logger';
import { retryBounded, withTimeout } from './retry';
import { summariseError } from './redaction';

export interface ComponentCheck { ok: boolean; latencyMs: number }
export interface Readiness {
  status: 'ok' | 'degraded' | 'unavailable';
  checks: { database: 'up' | 'down'; cache: 'up' | 'down' };
}

/**
 * Accurate dependency probes. Results expose only up/down: no hostnames, ports, versions, error text or credentials.
 * The database is REQUIRED (down => 503 / unavailable); the cache is OPTIONAL for serving requests (down => degraded).
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async checkDatabase(timeoutMs = 2000): Promise<ComponentCheck> {
    const t0 = Date.now();
    try {
      // SELECT 1 is idempotent: one bounded retry absorbs a single dropped pooled connection.
      await retryBounded(() => withTimeout(this.prisma.$queryRaw`SELECT 1`, timeoutMs, 'database probe'), { attempts: 2, baseDelayMs: 100, isRetryable: () => true });
      this.metrics?.setGauge('db_up', 1);
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      this.metrics?.setGauge('db_up', 0);
      this.metrics?.inc('db_health_failures_total');
      logEvent('warn', 'health.database_down', { error: summariseError(err) });
      return { ok: false, latencyMs: Date.now() - t0 };
    }
  }

  async checkCache(timeoutMs = 1000): Promise<ComponentCheck> {
    const t0 = Date.now();
    if (!this.cache) return { ok: true, latencyMs: 0 };
    try {
      await withTimeout(this.cache.ping(), timeoutMs, 'cache probe');
      this.metrics?.setGauge('cache_up', 1);
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      this.metrics?.setGauge('cache_up', 0);
      this.metrics?.inc('cache_health_failures_total');
      logEvent('warn', 'health.cache_down', { error: summariseError(err) });
      return { ok: false, latencyMs: Date.now() - t0 };
    }
  }

  async readiness(): Promise<Readiness> {
    const [db, cache] = await Promise.all([this.checkDatabase(), this.checkCache()]);
    return {
      status: !db.ok ? 'unavailable' : !cache.ok ? 'degraded' : 'ok',
      checks: { database: db.ok ? 'up' : 'down', cache: cache.ok ? 'up' : 'down' },
    };
  }
}

/**
 * Background watcher that turns a SUSTAINED outage into one critical alert (and one recovery notice), instead of one
 * alert per failed request. A single failed probe is never alerted. Tunables: HEALTH_MONITOR_INTERVAL_MS (30000),
 * HEALTH_FAILURE_THRESHOLD (3 consecutive failures), HEALTH_MONITOR_ENABLED (false disables, e.g. in tests).
 */
@Injectable()
export class InfraHealthMonitor implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private readonly state: Record<'database' | 'cache', { failures: number; outage: boolean }> = {
    database: { failures: 0, outage: false }, cache: { failures: 0, outage: false },
  };
  private readonly threshold: number;
  private readonly intervalMs: number;
  private readonly enabled: boolean;

  constructor(
    private readonly health: HealthService,
    private readonly alerts: ErrorEmailService,
    config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    const num = (k: string, d: number) => { const v = Number(config.get(k)); return Number.isFinite(v) && v > 0 ? v : d; };
    this.threshold = num('HEALTH_FAILURE_THRESHOLD', 3);
    this.intervalMs = num('HEALTH_MONITOR_INTERVAL_MS', 30_000);
    this.enabled = String(config.get('HEALTH_MONITOR_ENABLED') ?? 'true') !== 'false' && config.get('NODE_ENV') !== 'test';
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** One probe cycle (public for tests). Never throws. */
  async tick(): Promise<void> {
    try {
      const [db, cache] = await Promise.all([this.health.checkDatabase(), this.health.checkCache()]);
      this.observe('database', db.ok, 'DB_UNAVAILABLE', 'The database has failed its health check repeatedly', 'critical');
      this.observe('cache', cache.ok, 'CACHE_UNAVAILABLE', 'Redis has failed its health check repeatedly (sessions, token revocation and rate limits are degraded)', 'error');
    } catch (err) {
      logEvent('error', 'health.monitor_error', { error: summariseError(err) });
    }
  }

  private observe(name: 'database' | 'cache', ok: boolean, code: string, text: string, severity: 'critical' | 'error') {
    const s = this.state[name];
    if (ok) {
      if (s.outage) {
        this.alerts.report({ severity: 'error', code: `${code}_RECOVERED`, subsystem: name, summary: `${name} health check is passing again after ${s.failures} failed probes`, kind: 'recovery' });
        logEvent('info', 'health.recovered', { component: name, failedProbes: s.failures });
        this.metrics?.inc('infra_recoveries_total', { component: name });
      }
      s.failures = 0; s.outage = false;
      return;
    }
    s.failures++;
    if (s.failures >= this.threshold && !s.outage) {
      s.outage = true;
      this.alerts.report({ severity, code, subsystem: name, summary: `${text}: ${s.failures} consecutive failed probes (~${Math.round((s.failures * this.intervalMs) / 1000)}s)`, discriminator: 'sustained-outage' });
      this.metrics?.inc('infra_outages_total', { component: name });
    }
  }
}
