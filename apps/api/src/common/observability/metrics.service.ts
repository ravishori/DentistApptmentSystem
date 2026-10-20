import { Injectable } from '@nestjs/common';

/**
 * Dependency-free, in-process metrics (counters, gauges, one latency histogram). No external observability platform is
 * required; `toPrometheus()` renders the standard text format so one can be attached later without code changes.
 * Process-local by design: with several API instances scrape each one (documented in docs/OBSERVABILITY.md).
 */
const BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000];

type Labels = Record<string, string | number>;
const keyOf = (name: string, labels?: Labels) =>
  labels && Object.keys(labels).length ? `${name}{${Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`).join(',')}}` : name;

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly latency = new Map<string, { buckets: number[]; sum: number; count: number }>();
  readonly startedAt = Date.now();

  inc(name: string, labels?: Labels, by = 1): void {
    const k = keyOf(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }

  setGauge(name: string, value: number, labels?: Labels): void { this.gauges.set(keyOf(name, labels), value); }

  /** Per-request counters and latency; `route` must already be a template (no ids) to keep cardinality bounded. */
  recordHttp(method: string, route: string, status: number, ms: number): void {
    const cls = `${Math.floor(status / 100)}xx`;
    this.inc('http_requests_total', { method, status_class: cls });
    if (status >= 500) this.inc('http_server_errors_total');
    else if (status >= 400) this.inc('http_client_errors_total', { status });
    const k = keyOf('http_request_duration_ms', { route: this.boundRoute(route) });
    const h = this.latency.get(k) ?? { buckets: BUCKETS_MS.map(() => 0), sum: 0, count: 0 };
    BUCKETS_MS.forEach((b, i) => { if (ms <= b) h.buckets[i]++; });
    h.sum += ms; h.count++;
    this.latency.set(k, h);
  }

  /** Cardinality guard: after 200 distinct routes everything new is folded into "other". */
  private boundRoute(route: string): string {
    if (this.latency.size >= 200 && !this.latency.has(keyOf('http_request_duration_ms', { route }))) return 'other';
    return route;
  }

  getCounter(name: string, labels?: Labels): number { return this.counters.get(keyOf(name, labels)) ?? 0; }
  getGauge(name: string, labels?: Labels): number | undefined { return this.gauges.get(keyOf(name, labels)); }

  snapshot() {
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      latency: Object.fromEntries([...this.latency].map(([k, h]) => [k, { count: h.count, avgMs: h.count ? Math.round(h.sum / h.count) : 0 }])),
    };
  }

  toPrometheus(): string {
    const lines: string[] = [];
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    for (const [k, v] of this.gauges) lines.push(`${k} ${v}`);
    for (const [k, h] of this.latency) {
      const base = k.replace('{', '_bucket{le="__LE__",').replace(/,\}$/, '}');
      BUCKETS_MS.forEach((b, i) => lines.push(base.replace('__LE__', String(b)) + ` ${h.buckets[i]}`));
      lines.push(base.replace('__LE__', '+Inf') + ` ${h.count}`);
      lines.push(`${k.replace('{', '_sum{')} ${Math.round(h.sum)}`, `${k.replace('{', '_count{')} ${h.count}`);
    }
    lines.push(`process_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`);
    return lines.join('\n') + '\n';
  }
}
