import {
  BLOCK_REASON_MAX, REASON_MAX, buildReschedulePayload, canCancelAppointment, canManageSlots, canRescheduleAppointment,
  hasErrors, slotState, toHHMM, todayString, validateBlockReason, validateCancelReason, validateReschedule,
} from '@/lib/appointment-rules';

describe('which actions an appointment offers (mirrors the API state machine)', () => {
  it.each([
    ['scheduled', true, true], ['confirmed', true, true], ['in_progress', true, false],
    ['completed', false, false], ['cancelled', false, false], ['no_show', false, false], ['rescheduled', false, false],
  ])('%s → cancel %s, reschedule %s', (status, cancel, resched) => {
    expect(canCancelAppointment(status)).toBe(cancel);
    expect(canRescheduleAppointment(status)).toBe(resched);
  });
  it('missing status offers nothing', () => {
    expect(canCancelAppointment(undefined)).toBe(false);
    expect(canRescheduleAppointment(null)).toBe(false);
  });
});

describe('who sees slot management (same roles the API allows)', () => {
  it.each([['clinic_admin', true], ['super_admin', true], ['receptionist', true], ['dentist', false], ['assistant', false], [undefined, false], ['', false]])('%p → %s', (role, ok) => {
    expect(canManageSlots(role as any)).toBe(ok);
  });
});

describe('cancel reason', () => {
  it.each(['', '  ', 'ab', '   a  '])('rejects %p', (r) => expect(hasErrors(validateCancelReason(r))).toBe(true));
  it('accepts a normal reason and trims before judging length', () => {
    expect(hasErrors(validateCancelReason('Patient called'))).toBe(false);
    expect(hasErrors(validateCancelReason('  abc  '))).toBe(false);
  });
  it(`rejects more than ${REASON_MAX} characters`, () => {
    expect(validateCancelReason('x'.repeat(REASON_MAX + 1)).reason).toMatch(/under 500/);
    expect(hasErrors(validateCancelReason('x'.repeat(REASON_MAX)))).toBe(false);
  });
});

describe('reschedule form', () => {
  const base = { today: '2031-03-03', currentDate: '2031-03-03', currentStartTime: '09:30:00' };
  it('valid new slot passes', () => expect(hasErrors(validateReschedule({ ...base, date: '2031-03-04', startTime: '10:00' }))).toBe(false));
  it('same date, different time passes; same date and the current time is refused', () => {
    expect(hasErrors(validateReschedule({ ...base, date: '2031-03-03', startTime: '10:00' }))).toBe(false);
    expect(validateReschedule({ ...base, date: '2031-03-03', startTime: '09:30' }).startTime).toMatch(/current time/);
  });
  it.each(['', 'nope', '2031-13-40', '2031-3-4'])('rejects the date %p', (date) => {
    expect(validateReschedule({ ...base, date, startTime: '10:00' }).date).toBeDefined();
  });
  it('rejects a past date', () => expect(validateReschedule({ ...base, date: '2031-03-02', startTime: '10:00' }).date).toMatch(/future/));
  it.each(['', '9:5', '25:00', '10:60', '10:00:00'])('rejects the time %p', (startTime) => {
    expect(validateReschedule({ ...base, date: '2031-03-04', startTime }).startTime).toBeDefined();
  });
  it('rejects an over-long reason', () => {
    expect(validateReschedule({ ...base, date: '2031-03-04', startTime: '10:00', reason: 'x'.repeat(REASON_MAX + 1) }).reason).toBeDefined();
  });
  it('builds the exact body the API expects: HH:MM start time, trimmed optional reason, nothing else', () => {
    expect(buildReschedulePayload({ date: '2031-03-04', startTime: '10:00', reason: '  Asked  ' })).toEqual({ date: '2031-03-04', startTime: '10:00', reason: 'Asked' });
    expect(buildReschedulePayload({ date: '2031-03-04', startTime: '10:00', reason: '   ' })).toEqual({ date: '2031-03-04', startTime: '10:00' });
  });
  it('toHHMM normalises API times', () => {
    expect(toHHMM('09:30:00')).toBe('09:30');
    expect(toHHMM(undefined)).toBe('');
  });
  it('todayString is a local YYYY-MM-DD', () => expect(todayString(new Date(2031, 2, 3))).toBe('2031-03-03'));
});

describe('block reason and slot state', () => {
  it.each(['', 'ab', ' '])('block reason %p is refused', (r) => expect(hasErrors(validateBlockReason(r))).toBe(true));
  it(`block reason limit is ${BLOCK_REASON_MAX} (the API limit)`, () => {
    expect(hasErrors(validateBlockReason('x'.repeat(BLOCK_REASON_MAX)))).toBe(false);
    expect(hasErrors(validateBlockReason('x'.repeat(BLOCK_REASON_MAX + 1)))).toBe(true);
  });
  it('a booked slot is "booked" even if flagged blocked; otherwise blocked or available', () => {
    expect(slotState({ isBooked: true, isBlocked: true })).toBe('booked');
    expect(slotState({ isBooked: false, isBlocked: true })).toBe('blocked');
    expect(slotState({ isBooked: false, isBlocked: false })).toBe('available');
  });
});
