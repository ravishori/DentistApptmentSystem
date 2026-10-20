import dayjs from 'dayjs';

/**
 * Two-hour reminder window: appointments starting in [now, now + 2h] (both ends inclusive).
 *
 * The previous implementation compared time-of-day strings on TODAY's date only
 * (`startTime >= 'HH:mm:ss' AND startTime <= (now+2h as 'HH:mm:ss')`). From 22:00 onward `now+2h` wraps past midnight
 * (e.g. 23:30 → "01:30:00"), the range becomes empty, and appointments late in the evening — or just after midnight
 * on the next date — never received their reminder. This works on real date-times, so the window may span two dates.
 */
export interface TwoHourWindow {
  start: dayjs.Dayjs;
  end:   dayjs.Dayjs;
  /** Calendar dates (YYYY-MM-DD) the window touches: one normally, two when it crosses midnight. */
  dates: string[];
}

export function twoHourWindow(now: Date = new Date()): TwoHourWindow {
  const start = dayjs(now);
  const end   = start.add(2, 'hour');
  const d0 = start.format('YYYY-MM-DD');
  const d1 = end.format('YYYY-MM-DD');
  return { start, end, dates: d0 === d1 ? [d0] : [d0, d1] };
}

/** `appointment_date` is a DATE column (UTC midnight); `startTime` is 'HH:mm' or 'HH:mm:ss'. */
export function appointmentStart(date: Date | string, startTime: string): dayjs.Dayjs {
  const day = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  const hms = startTime.length === 5 ? `${startTime}:00` : startTime;
  return dayjs(`${day}T${hms}`);
}

export function isInTwoHourWindow(date: Date | string, startTime: string, now: Date = new Date()): boolean {
  const { start, end } = twoHourWindow(now);
  const at = appointmentStart(date, startTime);
  return !at.isBefore(start) && !at.isAfter(end);
}
