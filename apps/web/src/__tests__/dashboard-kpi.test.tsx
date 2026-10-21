/**
 * Dashboard KPI cards: a failed request is an error ("—", no sub-figures), never zero; genuine zero stays zero;
 * a failed refresh keeps the last loaded figures and says so. Server rendering with seeded query results (no network).
 */
import * as React from 'react';
import DashboardPage from '@/app/(dashboard)/dashboard/page';
import { failQueries, html, newClient, succeedQueries, unavailable503 } from './helpers';

const isStats = (k: readonly unknown[]) => k[0] === 'dashboard-stats';
const kpi = (m: string, title: string) => {
  const i = m.indexOf(title);
  return i < 0 ? '' : m.slice(i, i + 700);
};

const ZERO = { today: { appointments: 0, completed: 0, pending: 0 }, thisMonth: { revenue: 0, newPatients: 0 }, totals: { patients: 0, outstandingAmount: 0, pendingInvoices: 0 } };
const DATA = {
  today: { appointments: 7, completed: 3, pending: 4 },
  thisMonth: { revenue: 125000, newPatients: 9, appointmentGrowth: 12, revenueMoMPercent: 5, patientGrowth: 3 },
  totals: { patients: 1234, outstandingAmount: 48000, pendingInvoices: 6 },
};

function render(mutate?: (qc: ReturnType<typeof newClient>) => void) {
  const qc = newClient();
  html(<DashboardPage />, qc); // first pass registers the queries
  mutate?.(qc);
  return html(<DashboardPage />, qc);
}

describe('Dashboard KPI cards', () => {
  it('loading: skeletons, no figures, no error', () => {
    const m = render();
    expect(m).not.toContain('Could not load the dashboard figures');
    expect(m).not.toContain('completed ·');
    expect(m).not.toContain('pending invoices');
  });

  it('succeeded with genuine zeros: shows 0 and ₹0 with their sub-figures', () => {
    const m = render((qc) => succeedQueries(qc, ZERO, isStats));
    expect(kpi(m, "Today&#x27;s Appointments")).toContain('>0<');
    expect(m).toContain('0 completed · 0 pending');
    expect(m).toContain('₹0');
    expect(m).toContain('+0 new this month');
    expect(m).toContain('0 pending invoices');
    expect(m).not.toContain('Could not load the dashboard figures');
    expect(m).not.toContain('>—<');
  });

  it('succeeded with real figures: shows them', () => {
    const m = render((qc) => succeedQueries(qc, DATA, isStats));
    expect(m).toContain('>7<');
    expect(m).toContain('3 completed · 4 pending');
    expect(m).toContain('1,234');
    expect(m).toContain('+9 new this month');
    expect(m).toContain('6 pending invoices');
    expect(m).not.toContain('>—<');
  });

  it('failed initial load: error with reference and retry, "—" in every KPI, no zero or sub-figure', () => {
    const m = render((qc) => failQueries(qc, unavailable503(), isStats));
    expect(m).toContain('Could not load the dashboard figures');
    expect(m).toContain('req-ref-12345');
    expect(m).toContain('Try again');
    expect((m.match(/>—</g) ?? []).length).toBe(4);
    expect(m).not.toContain('completed ·');
    expect(m).not.toContain('new this month');
    expect(m).not.toContain('pending invoices');
    expect(kpi(m, 'This Month Revenue')).not.toContain('₹0');
    expect(kpi(m, 'Outstanding')).not.toContain('₹0');
    expect(m).not.toContain('Could not refresh');
  });

  it('failed refresh with previous data: keeps the last figures and shows the stale notice, not "—"', () => {
    const m = render((qc) => {
      succeedQueries(qc, DATA, isStats);
      for (const q of qc.getQueryCache().getAll()) {
        if (!isStats(q.queryKey)) continue;
        q.setState({ ...q.state, status: 'error', error: unavailable503(), fetchStatus: 'idle', errorUpdatedAt: Date.now(), errorUpdateCount: 1, fetchFailureCount: 1 } as never);
      }
    });
    expect(m).toContain('Could not refresh');
    expect(m).toContain('Retry');
    expect(m).toContain('3 completed · 4 pending');
    expect(m).toContain('1,234');
    expect(m).not.toContain('>—<');
    expect(m).not.toContain('Could not load the dashboard figures');
  });
});
