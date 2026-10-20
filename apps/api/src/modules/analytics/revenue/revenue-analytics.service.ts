import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface RevenueMonth {
  period:    string;   // YYYY-MM
  collected: number;   // money received (successful payments)
  refunded:  number;   // money returned to patients (positive number)
  net:       number;   // collected − refunded
  invoiced:  number;   // value of invoices raised in the month (excl. drafts and cancelled)
}

export interface RevenueTrend {
  months:      RevenueMonth[];
  totals:      { collected: number; refunded: number; net: number; invoiced: number };
  /** As of now (not per month): unpaid balance on invoices that have been issued. */
  outstanding: { total: number; overdue: number; openInvoices: number };
}

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Financial definitions (kept explicit so the three numbers can never be conflated):
 *   collected   = SUM(payments.amount)        WHERE status = 'success'   — by paid_at month
 *   refunded    = SUM(ABS(payments.amount))   WHERE status = 'refunded'  — by paid_at month (refunds are stored negative)
 *   net         = collected − refunded
 *   invoiced    = SUM(invoices.total_amount)  for issued invoices         — by created_at month
 *   outstanding = SUM(invoices.balance_amount) for sent / partially_paid / overdue invoices, right now
 * Pending and failed payments are never counted as money received. Drafts and cancelled invoices are
 * neither invoiced nor outstanding. EVERY query is bound to the caller's clinic id.
 */
@Injectable()
export class RevenueAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  static clampMonths(months?: number): number {
    const n = Number.isFinite(months) ? Math.trunc(months as number) : 6;
    return Math.min(36, Math.max(1, n));
  }

  async getTrend(clinicId: string, monthsInput?: number): Promise<RevenueTrend> {
    const months = RevenueAnalyticsService.clampMonths(monthsInput);
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

    const [paymentRows, invoiceRows, outstandingRows] = await Promise.all([
      this.prisma.$queryRaw<{ period: string; collected: number; refunded: number }[]>(Prisma.sql`
        SELECT TO_CHAR(paid_at, 'YYYY-MM') AS period,
               COALESCE(SUM(amount)      FILTER (WHERE status = 'success'),  0)::float AS collected,
               COALESCE(SUM(ABS(amount)) FILTER (WHERE status = 'refunded'), 0)::float AS refunded
        FROM payments
        WHERE clinic_id = ${clinicId}::uuid AND paid_at IS NOT NULL AND paid_at >= ${since}
        GROUP BY TO_CHAR(paid_at, 'YYYY-MM')`),
      this.prisma.$queryRaw<{ period: string; invoiced: number }[]>(Prisma.sql`
        SELECT TO_CHAR(created_at, 'YYYY-MM') AS period,
               COALESCE(SUM(total_amount), 0)::float AS invoiced
        FROM invoices
        WHERE clinic_id = ${clinicId}::uuid AND created_at >= ${since}
          AND status NOT IN ('draft', 'cancelled')
        GROUP BY TO_CHAR(created_at, 'YYYY-MM')`),
      this.prisma.$queryRaw<{ total: number; overdue: number; open_invoices: bigint }[]>(Prisma.sql`
        SELECT COALESCE(SUM(balance_amount), 0)::float                                   AS total,
               COALESCE(SUM(balance_amount) FILTER (WHERE status = 'overdue'), 0)::float AS overdue,
               COUNT(*)                                                                  AS open_invoices
        FROM invoices
        WHERE clinic_id = ${clinicId}::uuid AND status IN ('sent', 'partially_paid', 'overdue')`),
    ]);

    // Dense month list so the chart has no gaps
    const byPeriod = new Map<string, RevenueMonth>();
    for (let i = 0; i < months; i++) {
      const d = new Date(since.getFullYear(), since.getMonth() + i, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byPeriod.set(period, { period, collected: 0, refunded: 0, net: 0, invoiced: 0 });
    }
    for (const r of paymentRows) {
      const m = byPeriod.get(r.period);
      if (m) { m.collected = round2(r.collected); m.refunded = round2(r.refunded); }
    }
    for (const r of invoiceRows) {
      const m = byPeriod.get(r.period);
      if (m) m.invoiced = round2(r.invoiced);
    }
    const list = [...byPeriod.values()].map((m) => ({ ...m, net: round2(m.collected - m.refunded) }));

    const sum = (k: 'collected' | 'refunded' | 'net' | 'invoiced') => round2(list.reduce((s, m) => s + m[k], 0));
    const o = outstandingRows[0] ?? { total: 0, overdue: 0, open_invoices: BigInt(0) };

    return {
      months: list,
      totals: { collected: sum('collected'), refunded: sum('refunded'), net: sum('net'), invoiced: sum('invoiced') },
      outstanding: { total: round2(o.total), overdue: round2(o.overdue), openInvoices: Number(o.open_invoices) },
    };
  }
}
