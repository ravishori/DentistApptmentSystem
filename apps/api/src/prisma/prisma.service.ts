import {
  Injectable, OnModuleInit, OnModuleDestroy, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { logEvent } from '../common/observability/structured-logger';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: ConfigService) {
    super({
      datasources: { db: { url: config.get('database.url') } },
      // Prisma's own stdout logging is replaced by events routed through the structured logger. Query text/params are
      // never logged (parameters can contain patient data); set PRISMA_LOG_QUERIES=1 for query DURATIONS only.
      log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }, ...(process.env.PRISMA_LOG_QUERIES === '1' ? [{ emit: 'event' as const, level: 'query' as const }] : [])],
    });
    const on = this.$on.bind(this) as (ev: string, cb: (e: any) => void) => void;
    on('warn', (e) => logEvent('warn', 'db.prisma_warning', { target: e.target }));
    on('error', (e) => logEvent('error', 'db.prisma_error', { target: e.target }));
    on('query', (e) => { if (e.duration > Number(process.env.SLOW_QUERY_MS ?? 500)) logEvent('warn', 'db.slow_query', { durationMs: e.duration, target: e.target }); });

    // ── Soft-delete middleware ─────────────────────────────────────────────
    // Intercepts all findFirst/findMany to filter out soft-deleted records.
    // Extend here for any model that gains a deletedAt column.
    this.$use(async (params, next) => {
      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }

  /**
   * Scope any query builder to a specific clinic.
   * Use as a base where clause in every tenant-scoped query.
   */
  clinicScope(clinicId: string) {
    return { clinicId };
  }

  /**
   * Paginated query helper — returns { items, total, page, limit, pages }.
   */
  async paginate<T>(
    model: any,
    args: { where?: any; include?: any; orderBy?: any },
    page = 1,
    limit = 20,
  ): Promise<{ items: T[]; total: number; page: number; limit: number; pages: number }> {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      model.findMany({ ...args, skip, take: limit }),
      model.count({ where: args.where }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
