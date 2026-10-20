import { FINANCIALS_RESTRICTED } from '../patients/patient-financials';

/**
 * Appointment payloads carry patient-level money: the booking's estimatedCost, the linked invoice (number, status,
 * total) and each treatment's unitPrice / discountPct. This is the SAME data the patient endpoints already withhold from
 * roles without `billing:read`; leaving it open here made GET /appointments/:id a back door to it.
 * Keys are removed (never zeroed) and the payload is flagged so the UI can say why.
 */
const withoutKeys = (row: Record<string, any>, keys: string[]) => {
  const copy: Record<string, any> = { ...row };
  for (const k of keys) delete copy[k];
  return copy;
};

export function redactAppointment<T extends Record<string, any>>(appt: T) {
  if (!appt || typeof appt !== 'object') return appt;
  const out = withoutKeys(appt, ['estimatedCost', 'invoice']);
  if (Array.isArray(appt.treatments)) {
    out.treatments = appt.treatments.map((t: Record<string, any>) => withoutKeys(t, ['unitPrice', 'discountPct']));
  }
  out[FINANCIALS_RESTRICTED] = true;
  return out;
}

export function redactAppointments<T extends Record<string, any>>(rows: T[]) {
  return rows.map(redactAppointment);
}

/** { items, total, page, … } → same shape with every item redacted. */
export function redactAppointmentPage<T extends { items: Record<string, any>[] }>(page: T) {
  return { ...page, items: redactAppointments(page.items), [FINANCIALS_RESTRICTED]: true as const };
}
