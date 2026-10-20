import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly DEFAULT_TTL = 300; // 5 min

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // ── Core primitives ────────────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.warn(`Cache GET failed [${key}]: ${err.message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttl = this.DEFAULT_TTL): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (err) {
      this.logger.warn(`Cache SET failed [${key}]: ${err.message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn(`Cache DEL failed [${key}]: ${err.message}`);
    }
  }

  /** Delete all keys matching a glob pattern — e.g. "clinic:abc:slots:*" */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length) await this.redis.del(...keys);
    } catch (err) {
      this.logger.warn(`Cache INVALIDATE failed [${pattern}]: ${err.message}`);
    }
  }

  // ── Cache-aside helper ─────────────────────────────────────────────────────

  async wrap<T>(key: string, fn: () => Promise<T>, ttl = this.DEFAULT_TTL): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const result = await fn();
    await this.set(key, result, ttl);
    return result;
  }

  // ── Key builders (centralised naming convention) ───────────────────────────

  static keys = {
    clinicProfile:  (id: string)                         => `clinic:${id}:profile`,
    clinicSettings: (id: string)                         => `clinic:${id}:settings`,
    slots:          (cId: string, dId: string, date: string) => `clinic:${cId}:slots:${dId}:${date}`,
    allSlots:       (cId: string)                        => `clinic:${cId}:slots:*`,
    patients:       (cId: string, page: number)          => `clinic:${cId}:patients:p${page}`,
    patientDetail:  (cId: string, pId: string)           => `clinic:${cId}:patient:${pId}`,
    allPatients:    (cId: string)                        => `clinic:${cId}:patients:*`,
    dashboard:      (cId: string)                        => `clinic:${cId}:analytics:dashboard`,
    procedures:     (cId: string)                        => `clinic:${cId}:procedures`,
    dentists:       (cId: string)                        => `clinic:${cId}:dentists`,
  };
}
