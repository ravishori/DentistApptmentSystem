/**
 * Pure rules for the appointment-management UI (cancel, reschedule, block/unblock slots).
 * They mirror what the API enforces so the form can fail fast, but the API stays the authority:
 * every rule here is re-checked server-side (status transitions, slot availability, clinic scope, roles).
 */

/** Statuses the API lets staff cancel (FSM: scheduled, confirmed and in_progress → cancelled). */
const CANCELLABLE = ['scheduled', 'confirmed', 'in_progress'];
/** Statuses the API lets staff reschedule (`reschedule` accepts only scheduled or confirmed). */
const RESCHEDULABLE = ['scheduled', 'confirmed'];

export const canCancelAppointment = (status?: string | null) => CANCELLABLE.includes(status ?? '');
export const canRescheduleAppointment = (status?: string | null) => RESCHEDULABLE.includes(status ?? '');

/** Roles that may block/unblock slots (same list as the API's SLOT_MANAGER_ROLES). */
const SLOT_MANAGER_ROLES = ['clinic_admin', 'super_admin', 'receptionist'];
export const canManageSlots = (role?: string | null) => SLOT_MANAGER_ROLES.includes(role ?? '');

export const REASON_MAX = 500;
export const BLOCK_REASON_MAX = 200;

export interface FieldErrors { [field: string]: string | undefined }

/** Cancellation needs a short reason (kept on the appointment for the audit trail). */
export function validateCancelReason(reason: string): FieldErrors {
  const r = reason.trim();
  if (r.length < 3) return { reason: 'Enter a reason (at least 3 characters).' };
  if (r.length > REASON_MAX) return { reason: `Keep the reason under ${REASON_MAX} characters.` };
  return {};
}

export const todayString = (now: Date = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalises an API time ("09:30:00") to the "HH:MM" the reschedule endpoint expects. */
export const toHHMM = (t?: string | null) => (t ?? '').slice(0, 5);

export function validateReschedule(input: {
  date: string;
  startTime: string;
  reason?: string;
  currentDate?: string;
  currentStartTime?: string;
  today?: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  const today = input.today ?? todayString();
  if (!DATE_RE.test(input.date) || Number.isNaN(new Date(input.date).getTime())) errors.date = 'Choose a valid date.';
  else if (input.date < today) errors.date = 'Choose today or a future date.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) errors.startTime = 'Choose a time slot.';
  else if (input.date === input.currentDate && input.startTime === toHHMM(input.currentStartTime)) {
    errors.startTime = 'That is the current time. Choose a different slot.';
  }
  if ((input.reason ?? '').trim().length > REASON_MAX) errors.reason = `Keep the reason under ${REASON_MAX} characters.`;
  return errors;
}

export const hasErrors = (e: FieldErrors) => Object.values(e).some(Boolean);

/** Body for POST /appointments/:id/reschedule. */
export function buildReschedulePayload(input: { date: string; startTime: string; reason?: string }) {
  const reason = (input.reason ?? '').trim();
  return { date: input.date, startTime: input.startTime, ...(reason ? { reason } : {}) };
}

export function validateBlockReason(reason: string): FieldErrors {
  const r = reason.trim();
  if (r.length < 3) return { reason: 'Enter a reason (at least 3 characters).' };
  if (r.length > BLOCK_REASON_MAX) return { reason: `Keep the reason under ${BLOCK_REASON_MAX} characters.` };
  return {};
}

export type SlotState = 'available' | 'booked' | 'blocked';
export interface SlotRow { id: string; startTime: string; endTime: string; isBooked: boolean; isBlocked: boolean; blockReason?: string | null }

/** A slot is blocked or booked or free; "booked" wins because a booked slot can be neither blocked nor freed here. */
export const slotState = (s: Pick<SlotRow, 'isBooked' | 'isBlocked'>): SlotState =>
  s.isBooked ? 'booked' : s.isBlocked ? 'blocked' : 'available';
