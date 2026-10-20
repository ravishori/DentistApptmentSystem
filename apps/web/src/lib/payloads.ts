/**
 * Request-payload builders for forms. They exist because the API validates strictly (DTO whitelist, enums,
 * HH:MM times, no empty strings for optional fields) and the forms used to send values the API always rejected:
 * gender "MALE" (enum is lower case), "" for untouched optional fields, and slot times as "09:00:00".
 * Pure functions, unit tested against the real API DTOs (apps/api/src/web-payload-contract.spec.ts).
 */

const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export interface PatientFormValues {
  fullName: string; phone: string; email?: string; dateOfBirth?: string; gender?: string; bloodGroup?: string; address?: string;
}

/** POST /patients: only non-empty optional fields, lower-case gender, phone without spaces/punctuation. */
export function buildPatientPayload(form: PatientFormValues) {
  const out: Record<string, string> = {
    fullName: trim(form.fullName),
    phone: trim(form.phone).replace(/[\s().-]/g, ''),
  };
  for (const k of ['email', 'dateOfBirth', 'address'] as const) {
    const v = trim(form[k]);
    if (v) out[k] = v;
  }
  const gender = trim(form.gender).toLowerCase();
  if (gender) out.gender = gender;
  const blood = trim(form.bloodGroup);
  if (blood) out.bloodGroup = blood;
  return out;
}

export interface BookingFormValues {
  patientId: string; startTime: string; type: string; chiefComplaint?: string; estimatedCost?: string | number;
}

/** POST /appointments: startTime must be HH:MM (slots are listed as HH:MM:SS); empty optionals are dropped. */
export function buildBookingPayload(form: BookingFormValues, dentistId: string, date: string) {
  const out: Record<string, string | number> = {
    patientId: trim(form.patientId),
    dentistId,
    date,
    startTime: trim(form.startTime).slice(0, 5),
    type: trim(form.type),
    bookedVia: 'web',
  };
  const complaint = trim(form.chiefComplaint);
  if (complaint) out.chiefComplaint = complaint;
  const cost = typeof form.estimatedCost === 'number' ? form.estimatedCost : Number(trim(form.estimatedCost));
  if (Number.isFinite(cost) && String(form.estimatedCost ?? '').trim() !== '') out.estimatedCost = cost;
  return out;
}
