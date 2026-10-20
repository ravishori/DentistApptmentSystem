/**
 * Patient-level financial data (a patient's outstanding balance, their invoices and treatment prices) is shown only to
 * roles that hold the `billing:read` permission (billing desk + owners). Everyone else who may open a patient
 * record (e.g. clinical-only staff) gets the same record WITHOUT any money, plus a flag so the UI can say why.
 * Keys are removed, never zeroed — a ₹0 balance must not look like real data.
 */
export const FINANCIALS_RESTRICTED = 'financialsRestricted' as const;

const withoutKeys = <T extends Record<string, any>>(row: T, keys: string[]): Partial<T> => {
  const copy: Record<string, any> = { ...row };
  for (const k of keys) delete copy[k];
  return copy as Partial<T>;
};

const APPOINTMENT_MONEY = ['estimatedCost'];
const TREATMENT_MONEY = ['unitPrice', 'discountPct'];

function stripAppointment(a: Record<string, any>) {
  const out: Record<string, any> = withoutKeys(a, APPOINTMENT_MONEY);
  if (Array.isArray(a.treatments)) out.treatments = a.treatments.map((t: any) => withoutKeys(t, TREATMENT_MONEY));
  return out;
}

/** patients/:id — drops outstandingBalance, the invoice list and appointment/treatment prices. */
export function redactPatientDetail<T extends Record<string, any>>(patient: T) {
  const out: Record<string, any> = withoutKeys(patient, ['outstandingBalance', 'invoices']);
  if (Array.isArray(patient.appointments)) out.appointments = patient.appointments.map(stripAppointment);
  out[FINANCIALS_RESTRICTED] = true;
  return out;
}

/** patients (list) — drops each patient's outstandingBalance. */
export function redactPatientList<T extends { items: Record<string, any>[] }>(result: T) {
  return { ...result, items: result.items.map((p) => withoutKeys(p, ['outstandingBalance'])), [FINANCIALS_RESTRICTED]: true as const };
}

/** patients/:id/timeline — drops the invoice history and appointment/treatment prices. */
export function redactPatientTimeline<T extends { appointments?: Record<string, any>[]; invoices?: unknown[] }>(timeline: T) {
  return {
    ...timeline,
    appointments: (timeline.appointments ?? []).map(stripAppointment),
    invoices: [] as unknown[],
    [FINANCIALS_RESTRICTED]: true as const,
  };
}
