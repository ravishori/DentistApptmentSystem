import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Dashboard summary ──────────────────────────────────────────────────────

  async getDashboardSummary(clinicId: string) {
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevStart  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevEnd    = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const today      = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      todayCount, monthCount, prevMonthCount,
      monthRevenue, prevRevenue,
      totalPatients, newPatients, prevNewPatients,
      outstanding, noShowStats, completedStats,
    ] = await Promise.all([
      // Today's appointments
      this.prisma.appointment.count({
        where: { clinicId, appointmentDate: today },
      }),

      // This month appointments
      this.prisma.appointment.count({
        where: { clinicId, appointmentDate: { gte: monthStart } },
      }),

      // Last month appointments
      this.prisma.appointment.count({
        where: { clinicId, appointmentDate: { gte: prevStart, lte: prevEnd } },
      }),

      // This month revenue
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { clinicId, paidAt: { gte: monthStart } },
      }),

      // Last month revenue
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { clinicId, paidAt: { gte: prevStart, lte: prevEnd } },
      }),

      // Total patients
      this.prisma.patient.count({ where: { clinicId, isActive: true } }),

      // New patients this month
      this.prisma.patient.count({ where: { clinicId, createdAt: { gte: monthStart } } }),

      // New patients last month
      this.prisma.patient.count({
        where: { clinicId, createdAt: { gte: prevStart, lte: prevEnd } },
      }),

      // Outstanding amount
      this.prisma.invoice.aggregate({
        _sum: { balanceAmount: true },
        where: { clinicId, balanceAmount: { gt: 0 } },
      }),

      // No-show rate (last 90 days)
      this.prisma.appointment.groupBy({
        by: ['status'],
        _count: { id: true },
        where: {
          clinicId,
          appointmentDate: { gte: new Date(Date.now() - 90 * 864e5) },
        },
      }),

      // Completed appointments (for conversion calc)
      this.prisma.appointment.count({
        where: { clinicId, status: 'completed' },
      }),
    ]);

    const curRevenue  = Number(monthRevenue._sum.amount  ?? 0);
    const prRevenue   = Number(prevRevenue._sum.amount   ?? 0);
    const noShowCount = noShowStats.find(s => s.status === 'no_show')?._count.id ?? 0;
    const totalLast90 = noShowStats.reduce((s, r) => s + r._count.id, 0);

    return {
      today: { appointments: todayCount },
      thisMonth: {
        appointments: monthCount,
        revenue: curRevenue,
        revenueMoM: prRevenue > 0 ? Math.round(((curRevenue - prRevenue) / prRevenue) * 100) : 0,
        newPatients,
        patientGrowth: prevNewPatients > 0
          ? Math.round(((newPatients - prevNewPatients) / prevNewPatients) * 100) : 0,
        appointmentGrowth: prevMonthCount > 0
          ? Math.round(((monthCount - prevMonthCount) / prevMonthCount) * 100) : 0,
      },
      totals: {
        patients: totalPatients,
        outstandingAmount: Number(outstanding._sum.balanceAmount ?? 0),
        completedAppointments: completedStats,
      },
      noShowRate: totalLast90 > 0 ? Math.round((noShowCount / totalLast90) * 100 * 10) / 10 : 0,
    };
  }

  // ── Revenue per procedure ──────────────────────────────────────────────────

  async getRevenuePerProcedure(clinicId: string, months = 12) {
    const since = new Date(Date.now() - months * 30 * 864e5);

    // Join appointments (type) → invoices → payments
    const rows = await this.prisma.$queryRaw<
      { procedure: string; appointment_count: bigint; total_revenue: number; avg_revenue: number }[]
    >`
      SELECT
        a.type                          AS procedure,
        COUNT(DISTINCT a.id)            AS appointment_count,
        COALESCE(SUM(i.total_amount), 0)::FLOAT   AS total_revenue,
        COALESCE(AVG(i.total_amount), 0)::FLOAT   AS avg_revenue
      FROM appointments a
      LEFT JOIN invoices i ON i.appointment_id = a.id
        AND i.status NOT IN ('cancelled','draft')
      WHERE a.clinic_id = ${clinicId}::uuid
        AND a.status = 'completed'
        AND a.appointment_date >= ${since}
      GROUP BY a.type
      ORDER BY total_revenue DESC
    `;

    return rows.map(r => ({
      procedure:        r.procedure,
      appointmentCount: Number(r.appointment_count),
      totalRevenue:     Number(r.total_revenue),
      avgRevenue:       Math.round(Number(r.avg_revenue)),
    }));
  }

  // ── Patient Lifetime Value ─────────────────────────────────────────────────

  async getPatientLTV(clinicId: string) {
    // Top 20 patients by LTV
    const top = await this.prisma.$queryRaw<
      { patient_id: string; full_name: string; ltv: number; visit_count: bigint; last_visit: Date | null }[]
    >`
      SELECT
        p.id          AS patient_id,
        p.full_name,
        COALESCE(SUM(i.total_amount), 0)::FLOAT AS ltv,
        COUNT(DISTINCT a.id)                     AS visit_count,
        MAX(a.appointment_date)                  AS last_visit
      FROM patients p
      LEFT JOIN invoices i ON i.patient_id = p.id
        AND i.status NOT IN ('cancelled','draft')
      LEFT JOIN appointments a ON a.patient_id = p.id
        AND a.status = 'completed'
      WHERE p.clinic_id = ${clinicId}::uuid
      GROUP BY p.id, p.full_name
      ORDER BY ltv DESC
      LIMIT 20
    `;

    // LTV distribution buckets
    const buckets = await this.prisma.$queryRaw<
      { bucket: string; patient_count: bigint }[]
    >`
      SELECT
        CASE
          WHEN ltv = 0          THEN '₹0'
          WHEN ltv < 5000       THEN '< ₹5k'
          WHEN ltv < 15000      THEN '₹5k–15k'
          WHEN ltv < 30000      THEN '₹15k–30k'
          WHEN ltv < 60000      THEN '₹30k–60k'
          ELSE                       '> ₹60k'
        END AS bucket,
        COUNT(*)::bigint AS patient_count
      FROM (
        SELECT p.id, COALESCE(SUM(i.total_amount), 0)::FLOAT AS ltv
        FROM patients p
        LEFT JOIN invoices i ON i.patient_id = p.id
          AND i.status NOT IN ('cancelled','draft')
        WHERE p.clinic_id = ${clinicId}::uuid
        GROUP BY p.id
      ) sub
      GROUP BY bucket
      ORDER BY MIN(ltv)
    `;

    const avgLtv = await this.prisma.$queryRaw<{ avg_ltv: number }[]>`
      SELECT COALESCE(AVG(sub.ltv), 0)::FLOAT AS avg_ltv
      FROM (
        SELECT COALESCE(SUM(i.total_amount), 0)::FLOAT AS ltv
        FROM patients p
        LEFT JOIN invoices i ON i.patient_id = p.id
          AND i.status NOT IN ('cancelled','draft')
        WHERE p.clinic_id = ${clinicId}::uuid
        GROUP BY p.id
      ) sub
      WHERE sub.ltv > 0
    `;

    return {
      topPatients: top.map(r => ({
        patientId:  r.patient_id,
        fullName:   r.full_name,
        ltv:        Number(r.ltv),
        visitCount: Number(r.visit_count),
        lastVisit:  r.last_visit,
      })),
      distribution: buckets.map(b => ({
        bucket:       b.bucket,
        patientCount: Number(b.patient_count),
      })),
      avgLtv: Math.round(Number(avgLtv[0]?.avg_ltv ?? 0)),
    };
  }

  // ── No-show analysis ───────────────────────────────────────────────────────

  async getNoShowAnalysis(clinicId: string, months = 6) {
    const since = new Date(now_months_ago(months));

    // Monthly no-show rate
    const monthly = await this.prisma.$queryRaw<
      { month: string; total: bigint; no_shows: bigint; rate: number }[]
    >`
      SELECT
        TO_CHAR(appointment_date, 'YYYY-MM') AS month,
        COUNT(*)::bigint                      AS total,
        COUNT(*) FILTER (WHERE status = 'no_show')::bigint AS no_shows,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'no_show') * 100.0 / NULLIF(COUNT(*), 0),
          1
        )::FLOAT AS rate
      FROM appointments
      WHERE clinic_id = ${clinicId}::uuid
        AND appointment_date >= ${since}
      GROUP BY TO_CHAR(appointment_date, 'YYYY-MM')
      ORDER BY month
    `;

    // By doctor
    const byDentist = await this.prisma.$queryRaw<
      { dentist_name: string; total: bigint; no_shows: bigint; rate: number }[]
    >`
      SELECT
        u.full_name                           AS dentist_name,
        COUNT(*)::bigint                      AS total,
        COUNT(*) FILTER (WHERE a.status = 'no_show')::bigint AS no_shows,
        ROUND(
          COUNT(*) FILTER (WHERE a.status = 'no_show') * 100.0 / NULLIF(COUNT(*), 0),
          1
        )::FLOAT AS rate
      FROM appointments a
      JOIN users u ON u.id = a.dentist_id
      WHERE a.clinic_id = ${clinicId}::uuid
        AND a.appointment_date >= ${since}
      GROUP BY u.id, u.full_name
      ORDER BY rate DESC
    `;

    // By day of week
    const byDow = await this.prisma.$queryRaw<
      { dow: number; day_name: string; no_shows: bigint; total: bigint; rate: number }[]
    >`
      SELECT
        EXTRACT(DOW FROM appointment_date)::int          AS dow,
        TO_CHAR(appointment_date, 'Dy')                  AS day_name,
        COUNT(*) FILTER (WHERE status = 'no_show')::bigint AS no_shows,
        COUNT(*)::bigint                                  AS total,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'no_show') * 100.0 / NULLIF(COUNT(*), 0),
          1
        )::FLOAT AS rate
      FROM appointments
      WHERE clinic_id = ${clinicId}::uuid
        AND appointment_date >= ${since}
      GROUP BY dow, day_name
      ORDER BY dow
    `;

    return {
      monthly: monthly.map(r => ({
        month:   r.month,
        total:   Number(r.total),
        noShows: Number(r.no_shows),
        rate:    Number(r.rate),
      })),
      byDentist: byDentist.map(r => ({
        dentistName: r.dentist_name,
        total:       Number(r.total),
        noShows:     Number(r.no_shows),
        rate:        Number(r.rate),
      })),
      byDow: byDow.map(r => ({
        dayName: r.day_name,
        noShows: Number(r.no_shows),
        total:   Number(r.total),
        rate:    Number(r.rate),
      })),
    };
  }

  // ── Conversion funnel ──────────────────────────────────────────────────────

  async getConversionFunnel(clinicId: string, months = 3) {
    const since = new Date(now_months_ago(months));

    const [registered, withAppointment, withCompleted, withPaidInvoice] = await Promise.all([
      // Stage 1: registered patients
      this.prisma.patient.count({
        where: { clinicId, createdAt: { gte: since } },
      }),

      // Stage 2: patients who have at least 1 appointment
      this.prisma.patient.count({
        where: {
          clinicId,
          createdAt: { gte: since },
          appointments: { some: {} },
        },
      }),

      // Stage 3: patients with at least 1 completed appointment
      this.prisma.patient.count({
        where: {
          clinicId,
          createdAt: { gte: since },
          appointments: { some: { status: 'completed' } },
        },
      }),

      // Stage 4: patients with at least 1 paid invoice
      this.prisma.patient.count({
        where: {
          clinicId,
          createdAt: { gte: since },
          invoices: { some: { status: 'paid' } },
        },
      }),
    ]);

    return [
      { stage: 'Registered',          count: registered,      pct: 100 },
      { stage: 'Booked Appointment',  count: withAppointment, pct: registered > 0 ? Math.round((withAppointment / registered) * 100) : 0 },
      { stage: 'Treatment Completed', count: withCompleted,   pct: registered > 0 ? Math.round((withCompleted  / registered) * 100) : 0 },
      { stage: 'Invoice Paid',        count: withPaidInvoice, pct: registered > 0 ? Math.round((withPaidInvoice / registered) * 100) : 0 },
    ];
  }

  // ── Monthly / Yearly trend ─────────────────────────────────────────────────

  async getTrends(clinicId: string, period: 'monthly' | 'yearly' = 'monthly', count = 12) {
    const since = period === 'monthly'
      ? new Date(now_months_ago(count))
      : new Date(Date.now() - count * 365 * 864e5);

    type RevRow  = { period: string; revenue: number; payments: bigint };
    type ApptRow = { period: string; total: bigint; completed: bigint; no_show: bigint };
    type PtRow   = { period: string; count: bigint };

    let revenue:     RevRow[];
    let appointments: ApptRow[];
    let newPatients:  PtRow[];

    if (period === 'monthly') {
      [revenue, appointments, newPatients] = await Promise.all([
        this.prisma.$queryRaw<RevRow[]>`
          SELECT TO_CHAR(paid_at, 'YYYY-MM') AS period,
                 COALESCE(SUM(amount), 0)::FLOAT AS revenue,
                 COUNT(*)::bigint                AS payments
          FROM payments
          WHERE clinic_id = ${clinicId}::uuid AND paid_at >= ${since}
          GROUP BY TO_CHAR(paid_at, 'YYYY-MM') ORDER BY period`,
        this.prisma.$queryRaw<ApptRow[]>`
          SELECT TO_CHAR(appointment_date, 'YYYY-MM') AS period,
                 COUNT(*)::bigint AS total,
                 COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed,
                 COUNT(*) FILTER (WHERE status = 'no_show')::bigint   AS no_show
          FROM appointments
          WHERE clinic_id = ${clinicId}::uuid AND appointment_date >= ${since}
          GROUP BY TO_CHAR(appointment_date, 'YYYY-MM') ORDER BY period`,
        this.prisma.$queryRaw<PtRow[]>`
          SELECT TO_CHAR(created_at, 'YYYY-MM') AS period,
                 COUNT(*)::bigint AS count
          FROM patients
          WHERE clinic_id = ${clinicId}::uuid AND created_at >= ${since}
          GROUP BY TO_CHAR(created_at, 'YYYY-MM') ORDER BY period`,
      ]);
    } else {
      [revenue, appointments, newPatients] = await Promise.all([
        this.prisma.$queryRaw<RevRow[]>`
          SELECT TO_CHAR(paid_at, 'YYYY') AS period,
                 COALESCE(SUM(amount), 0)::FLOAT AS revenue,
                 COUNT(*)::bigint                AS payments
          FROM payments
          WHERE clinic_id = ${clinicId}::uuid AND paid_at >= ${since}
          GROUP BY TO_CHAR(paid_at, 'YYYY') ORDER BY period`,
        this.prisma.$queryRaw<ApptRow[]>`
          SELECT TO_CHAR(appointment_date, 'YYYY') AS period,
                 COUNT(*)::bigint AS total,
                 COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed,
                 COUNT(*) FILTER (WHERE status = 'no_show')::bigint   AS no_show
          FROM appointments
          WHERE clinic_id = ${clinicId}::uuid AND appointment_date >= ${since}
          GROUP BY TO_CHAR(appointment_date, 'YYYY') ORDER BY period`,
        this.prisma.$queryRaw<PtRow[]>`
          SELECT TO_CHAR(created_at, 'YYYY') AS period,
                 COUNT(*)::bigint AS count
          FROM patients
          WHERE clinic_id = ${clinicId}::uuid AND created_at >= ${since}
          GROUP BY TO_CHAR(created_at, 'YYYY') ORDER BY period`,
      ]);
    }

    const periodMap = new Map<string, any>();
    revenue.forEach(r => {
      periodMap.set(r.period, { period: r.period, revenue: Number(r.revenue), payments: Number(r.payments) });
    });
    appointments.forEach(r => {
      const existing = periodMap.get(r.period) ?? { period: r.period, revenue: 0, payments: 0 };
      periodMap.set(r.period, {
        ...existing,
        appointments: Number(r.total),
        completed:    Number(r.completed),
        noShow:       Number(r.no_show),
      });
    });
    newPatients.forEach(r => {
      const existing = periodMap.get(r.period) ?? { period: r.period };
      periodMap.set(r.period, { ...existing, newPatients: Number(r.count) });
    });

    return Array.from(periodMap.values()).sort((a, b) => a.period.localeCompare(b.period));
  }

  // ── Dentist performance ────────────────────────────────────────────────────

  async getDentistPerformance(clinicId: string, months = 3) {
    const since = new Date(now_months_ago(months));

    const rows = await this.prisma.$queryRaw<{
      dentist_id: string; dentist_name: string;
      total: bigint; completed: bigint; no_show: bigint; cancelled: bigint;
      revenue: number;
    }[]>`
      SELECT
        u.id                                              AS dentist_id,
        u.full_name                                       AS dentist_name,
        COUNT(*)::bigint                                  AS total,
        COUNT(*) FILTER (WHERE a.status = 'completed')::bigint    AS completed,
        COUNT(*) FILTER (WHERE a.status = 'no_show')::bigint      AS no_show,
        COUNT(*) FILTER (WHERE a.status = 'cancelled')::bigint    AS cancelled,
        COALESCE(SUM(i.total_amount), 0)::FLOAT                   AS revenue
      FROM appointments a
      JOIN users u ON u.id = a.dentist_id
      LEFT JOIN invoices i ON i.appointment_id = a.id
        AND i.status NOT IN ('cancelled','draft')
      WHERE a.clinic_id = ${clinicId}::uuid
        AND a.appointment_date >= ${since}
      GROUP BY u.id, u.full_name
      ORDER BY completed DESC
    `;

    return rows.map(r => ({
      dentistId:   r.dentist_id,
      dentistName: r.dentist_name,
      total:       Number(r.total),
      completed:   Number(r.completed),
      noShow:      Number(r.no_show),
      cancelled:   Number(r.cancelled),
      revenue:     Number(r.revenue),
      completionRate: Number(r.total) > 0
        ? Math.round((Number(r.completed) / Number(r.total)) * 100) : 0,
    }));
  }

  // ── Predictive: inactive patients ─────────────────────────────────────────

  async getInactivePatients(clinicId: string, inactiveDays = 90, limit = 50) {
    const cutoff = new Date(Date.now() - inactiveDays * 864e5);

    const rows = await this.prisma.$queryRaw<{
      patient_id: string; full_name: string; phone: string | null;
      last_visit: Date | null; days_inactive: number;
      total_visits: number; ltv: number;
    }[]>`
      SELECT
        p.id                                      AS patient_id,
        p.full_name,
        p.phone,
        p.last_visit_date                         AS last_visit,
        EXTRACT(DAY FROM NOW() - p.last_visit_date)::int AS days_inactive,
        p.total_visits,
        COALESCE(SUM(i.total_amount), 0)::FLOAT   AS ltv
      FROM patients p
      LEFT JOIN invoices i ON i.patient_id = p.id
        AND i.status NOT IN ('cancelled','draft')
      WHERE p.clinic_id = ${clinicId}::uuid
        AND p.is_active = TRUE
        AND (
          p.last_visit_date IS NULL
          OR p.last_visit_date <= ${cutoff}
        )
      GROUP BY p.id, p.full_name, p.phone, p.last_visit_date, p.total_visits
      ORDER BY p.last_visit_date ASC NULLS FIRST
      LIMIT ${limit}
    `;

    return rows.map(r => ({
      patientId:    r.patient_id,
      fullName:     r.full_name,
      phone:        r.phone,
      lastVisit:    r.last_visit,
      daysInactive: r.days_inactive ?? null,
      totalVisits:  r.total_visits,
      ltv:          Number(r.ltv),
      riskLevel:    risk_level(r.days_inactive),
    }));
  }

  // ── Predictive: high-value patients ───────────────────────────────────────

  async getHighValuePatients(clinicId: string, limit = 30) {
    const rows = await this.prisma.$queryRaw<{
      patient_id: string; full_name: string; phone: string | null;
      ltv: number; visit_count: bigint; avg_invoice: number;
      last_visit: Date | null; outstanding: number;
    }[]>`
      SELECT
        p.id                                                      AS patient_id,
        p.full_name,
        p.phone,
        COALESCE(SUM(i.total_amount), 0)::FLOAT                  AS ltv,
        COUNT(DISTINCT a.id)::bigint                             AS visit_count,
        COALESCE(AVG(i.total_amount), 0)::FLOAT                  AS avg_invoice,
        p.last_visit_date                                         AS last_visit,
        p.outstanding_balance::FLOAT                             AS outstanding
      FROM patients p
      LEFT JOIN invoices i ON i.patient_id = p.id
        AND i.status NOT IN ('cancelled','draft')
      LEFT JOIN appointments a ON a.patient_id = p.id
        AND a.status = 'completed'
      WHERE p.clinic_id = ${clinicId}::uuid
        AND p.is_active = TRUE
      GROUP BY p.id, p.full_name, p.phone, p.last_visit_date, p.outstanding_balance
      HAVING COALESCE(SUM(i.total_amount), 0) > 0
      ORDER BY ltv DESC
      LIMIT ${limit}
    `;

    // Compute median LTV to flag "high value"
    const total = rows.length;
    const median = total > 0 ? Number(rows[Math.floor(total / 2)]?.ltv ?? 0) : 0;

    return rows.map((r, idx) => ({
      patientId:   r.patient_id,
      fullName:    r.full_name,
      phone:       r.phone,
      ltv:         Number(r.ltv),
      visitCount:  Number(r.visit_count),
      avgInvoice:  Math.round(Number(r.avg_invoice)),
      lastVisit:   r.last_visit,
      outstanding: Number(r.outstanding),
      tier:        idx < Math.ceil(total * 0.1) ? 'platinum' : idx < Math.ceil(total * 0.3) ? 'gold' : 'silver',
    }));
  }

  // ── Export: CSV ────────────────────────────────────────────────────────────

  async exportRevenueCsv(clinicId: string, months = 12) {
    const trends = await this.getTrends(clinicId, 'monthly', months);
    const headers = ['Period', 'Revenue (₹)', 'Appointments', 'Completed', 'No-Shows', 'New Patients'];
    const rows = trends.map(t => [
      t.period,
      String(Math.round(t.revenue ?? 0)),
      String(t.appointments ?? 0),
      String(t.completed ?? 0),
      String(t.noShow ?? 0),
      String(t.newPatients ?? 0),
    ]);
    return this.toCsv(headers, rows);
  }

  async exportPatientLtvCsv(clinicId: string) {
    const { topPatients } = await this.getPatientLTV(clinicId);
    const headers = ['Patient', 'LTV (₹)', 'Visits', 'Last Visit'];
    const rows = topPatients.map(p => [
      p.fullName,
      String(Math.round(p.ltv)),
      String(p.visitCount),
      p.lastVisit ? new Date(p.lastVisit).toLocaleDateString('en-IN') : 'Never',
    ]);
    return this.toCsv(headers, rows);
  }

  private toCsv(headers: string[], rows: string[][]): string {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    return [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function now_months_ago(months: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function risk_level(daysInactive: number | null): 'high' | 'medium' | 'low' {
  if (!daysInactive || daysInactive > 365) return 'high';
  if (daysInactive > 180) return 'medium';
  return 'low';
}
