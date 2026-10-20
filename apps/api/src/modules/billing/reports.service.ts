import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportFormat } from './dto/report.dto';

export interface DailyRevenueRow {
  [key: string]: unknown;
  date:    string;
  revenue: number;
  invoices: number;
}

export interface OutstandingRow {
  [key: string]: unknown;
  patientId:   string;
  patientName: string;
  phone:       string | null;
  invoiceId:   string;
  invoiceNumber: string;
  dueDate:     string | null;
  totalAmount: number;
  paidAmount:  number;
  balance:     number;
  agingBucket: '0-30' | '31-60' | '61-90' | '90+';
}

interface GstRow {
  month:       string;
  taxableBase: number;
  cgst:        number;
  sgst:        number;
  igst:        number;
  totalTax:    number;
  totalRevenue: number;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Daily Revenue ─────────────────────────────────────────────────────────

  async getDailyRevenue(
    clinicId: string,
    from: string,
    to: string,
    format: ReportFormat = ReportFormat.JSON,
  ) {
    const payments = await this.prisma.payment.findMany({
      where: {
        clinicId,
        status: 'success',
        paidAt: {
          gte: new Date(from),
          lte: new Date(`${to}T23:59:59`),
        },
      },
      include: { invoice: { select: { invoiceNumber: true } } },
      orderBy: { paidAt: 'asc' },
    });

    const byDate = new Map<string, { revenue: number; invoices: Set<string> }>();
    for (const p of payments) {
      const d = p.paidAt!.toISOString().split('T')[0];
      if (!byDate.has(d)) byDate.set(d, { revenue: 0, invoices: new Set() });
      const entry = byDate.get(d)!;
      entry.revenue += Number(p.amount);
      entry.invoices.add(p.invoiceId);
    }

    const rows: DailyRevenueRow[] = Array.from(byDate.entries()).map(([date, v]) => ({
      date,
      revenue:  Math.round(v.revenue * 100) / 100,
      invoices: v.invoices.size,
    }));

    if (format === ReportFormat.CSV) {
      return this.toCsv(rows, ['date', 'revenue', 'invoices']);
    }
    return {
      rows,
      total:    rows.reduce((s, r) => s + r.revenue, 0),
      from,
      to,
    };
  }

  // ── Outstanding Dues ──────────────────────────────────────────────────────

  async getOutstandingDues(clinicId: string, format: ReportFormat = ReportFormat.JSON) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        clinicId,
        status: { in: ['sent', 'partially_paid', 'overdue'] },
        balanceAmount: { gt: 0 },
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    const today = new Date();
    const rows: OutstandingRow[] = invoices.map((inv) => {
      const daysOverdue = inv.dueDate
        ? Math.floor((today.getTime() - inv.dueDate.getTime()) / 86_400_000)
        : 0;

      let agingBucket: OutstandingRow['agingBucket'];
      if (daysOverdue <= 30)      agingBucket = '0-30';
      else if (daysOverdue <= 60) agingBucket = '31-60';
      else if (daysOverdue <= 90) agingBucket = '61-90';
      else                         agingBucket = '90+';

      return {
        patientId:     inv.patient.id,
        patientName:   inv.patient.fullName,
        phone:         inv.patient.phone ?? null,
        invoiceId:     inv.id,
        invoiceNumber: inv.invoiceNumber,
        dueDate:       inv.dueDate?.toISOString().split('T')[0] ?? null,
        totalAmount:   Number(inv.totalAmount),
        paidAmount:    Number(inv.paidAmount),
        balance:       Number(inv.balanceAmount),
        agingBucket,
      };
    });

    const summary = {
      total:    rows.reduce((s, r) => s + r.balance, 0),
      bucket_0_30:  rows.filter(r => r.agingBucket === '0-30').reduce((s, r) => s + r.balance, 0),
      bucket_31_60: rows.filter(r => r.agingBucket === '31-60').reduce((s, r) => s + r.balance, 0),
      bucket_61_90: rows.filter(r => r.agingBucket === '61-90').reduce((s, r) => s + r.balance, 0),
      bucket_90p:   rows.filter(r => r.agingBucket === '90+').reduce((s, r) => s + r.balance, 0),
    };

    if (format === ReportFormat.CSV) {
      return this.toCsv(rows, [
        'invoiceNumber', 'patientName', 'phone', 'dueDate',
        'totalAmount', 'paidAmount', 'balance', 'agingBucket',
      ]);
    }
    return { rows, summary };
  }

  // ── GST Report ────────────────────────────────────────────────────────────

  async getGstReport(
    clinicId: string,
    from: string,
    to: string,
    format: ReportFormat = ReportFormat.JSON,
  ) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        clinicId,
        status: { in: ['paid', 'partially_paid'] },
        invoiceDate: {
          gte: new Date(from),
          lte: new Date(`${to}T23:59:59`),
        },
      },
      orderBy: { invoiceDate: 'asc' },
    });

    const byMonth = new Map<string, GstRow>();
    for (const inv of invoices) {
      const month = inv.invoiceDate.toISOString().substring(0, 7);
      if (!byMonth.has(month)) {
        byMonth.set(month, {
          month,
          taxableBase:  0,
          cgst:         0,
          sgst:         0,
          igst:         0,
          totalTax:     0,
          totalRevenue: 0,
        });
      }
      const row = byMonth.get(month)!;
      const taxable = Number(inv.totalAmount) - Number(inv.taxAmount);
      row.taxableBase  += taxable;
      row.cgst         += Number(inv.cgst);
      row.sgst         += Number(inv.sgst);
      row.igst         += Number(inv.igst);
      row.totalTax     += Number(inv.taxAmount);
      row.totalRevenue += Number(inv.totalAmount);
    }

    const rows = Array.from(byMonth.values()).map(r => ({
      ...r,
      taxableBase:  Math.round(r.taxableBase * 100) / 100,
      cgst:         Math.round(r.cgst * 100) / 100,
      sgst:         Math.round(r.sgst * 100) / 100,
      igst:         Math.round(r.igst * 100) / 100,
      totalTax:     Math.round(r.totalTax * 100) / 100,
      totalRevenue: Math.round(r.totalRevenue * 100) / 100,
    }));

    if (format === ReportFormat.CSV) {
      return this.toCsv(rows, [
        'month', 'taxableBase', 'cgst', 'sgst', 'igst', 'totalTax', 'totalRevenue',
      ]);
    }
    return {
      rows,
      summary: {
        taxableBase:  rows.reduce((s, r) => s + r.taxableBase, 0),
        cgst:         rows.reduce((s, r) => s + r.cgst, 0),
        sgst:         rows.reduce((s, r) => s + r.sgst, 0),
        igst:         rows.reduce((s, r) => s + r.igst, 0),
        totalTax:     rows.reduce((s, r) => s + r.totalTax, 0),
        totalRevenue: rows.reduce((s, r) => s + r.totalRevenue, 0),
      },
    };
  }

  // ── CSV helper ────────────────────────────────────────────────────────────

  private toCsv(rows: Record<string, unknown>[], headers: string[]): string {
    const escape = (v: unknown) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map(h => escape(row[h])).join(','));
    }
    return lines.join('\n');
  }
}
