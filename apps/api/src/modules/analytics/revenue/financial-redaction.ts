/**
 * Field-level redaction for endpoints that mix operational counts with money.
 *
 * Policy (one place, so every API and export applies the same rule):
 *   - Aggregates, KPIs, reports, LTV and exports   → RevenueAccessGuard (403) or the redactors below.
 *   - Per-invoice / per-patient billing-desk data  → unchanged: staff with `billing:read` need an invoice's own
 *     amount and balance to collect payment. That is operational, not clinic-level financial analytics.
 * Redactors REMOVE the keys (they are never replaced by 0, which would look like real data) and flag the payload so the
 * UI can hide the card instead of showing a misleading ₹0.
 */

export const FINANCIALS_RESTRICTED = 'financialsRestricted' as const;

/** Return a shallow copy of each row without the given keys. */
export function omitKeys<T extends Record<string, any>>(rows: T[], keys: string[]): Partial<T>[] {
  return rows.map((row) => {
    const copy: Record<string, any> = { ...row };
    for (const k of keys) delete copy[k];
    return copy as Partial<T>;
  });
}

/** analytics/dashboard summary: drop monthly revenue, its month-over-month change and the outstanding balance. */
export function redactDashboardSummary<T extends { thisMonth?: any; totals?: any }>(summary: T): T & { [FINANCIALS_RESTRICTED]: true } {
  const out: any = { ...summary };
  if (summary.thisMonth) {
    const { revenue: _r, revenueMoM: _m, ...rest } = summary.thisMonth;
    out.thisMonth = rest;
  }
  if (summary.totals) {
    const { outstandingAmount: _o, ...rest } = summary.totals;
    out.totals = rest;
  }
  out[FINANCIALS_RESTRICTED] = true;
  return out;
}

/** billing/stats: drop the money KPIs, keep invoice counts. */
export function redactBillingStats<T extends { thisMonth?: unknown; outstanding?: unknown }>(stats: T) {
  const { thisMonth: _t, outstanding: _o, ...rest } = stats;
  return { ...rest, [FINANCIALS_RESTRICTED]: true as const };
}

/** clinic/stats: drop the outstanding balance, keep counts. */
export function redactClinicStats<T extends { outstandingBalance?: unknown }>(stats: T) {
  const { outstandingBalance: _o, ...rest } = stats;
  return { ...rest, [FINANCIALS_RESTRICTED]: true as const };
}
