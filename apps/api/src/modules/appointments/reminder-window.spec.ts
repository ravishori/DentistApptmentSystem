import dayjs from 'dayjs';
import { appointmentStart, isInTwoHourWindow, twoHourWindow } from './reminder-window';

/** Local-time Date helper (the schedulers use the server's local clock). */
const at = (iso: string) => new Date(iso);                       // '2031-06-15T23:30:00' → local time
const inWin = (now: string, apptDate: string, startTime: string) =>
  isInTwoHourWindow(new Date(`${apptDate}T00:00:00Z`), startTime, at(now));   // appointment_date is a DATE (UTC midnight)

describe('twoHourWindow', () => {
  it('stays on one date during the day', () => {
    const w = twoHourWindow(at('2031-06-15T10:00:00'));
    expect(w.dates).toEqual(['2031-06-15']);
    expect(w.end.format('HH:mm:ss')).toBe('12:00:00');
  });
  it.each([
    ['21:59:59', ['2031-06-15']],                    // end 23:59:59 — still today
    ['22:00:00', ['2031-06-15', '2031-06-16']],      // end 00:00:00 tomorrow — crosses midnight
    ['23:30:00', ['2031-06-15', '2031-06-16']],
    ['23:59:59', ['2031-06-15', '2031-06-16']],
  ])('now=%s → dates %j', (time, dates) => {
    expect(twoHourWindow(at(`2031-06-15T${time}`)).dates).toEqual(dates);
  });
  it('crosses month and year boundaries', () => {
    expect(twoHourWindow(at('2031-06-30T23:30:00')).dates).toEqual(['2031-06-30', '2031-07-01']);
    expect(twoHourWindow(at('2031-12-31T23:30:00')).dates).toEqual(['2031-12-31', '2032-01-01']);
  });
});

describe('appointmentStart', () => {
  it('uses the DATE column\'s calendar day regardless of the server timezone', () => {
    expect(appointmentStart(new Date('2031-06-15T00:00:00Z'), '09:30:00').format('YYYY-MM-DD HH:mm:ss')).toBe('2031-06-15 09:30:00');
    expect(appointmentStart('2031-06-15', '09:30').format('HH:mm:ss')).toBe('09:30:00');   // 'HH:mm' accepted
  });
});

describe('isInTwoHourWindow — the old string-compare bug (after 22:00 the range wrapped and went EMPTY)', () => {
  describe('both sides of midnight', () => {
    it('now=23:30 — an appointment at 23:45 TODAY is in the window (was missed before)', () => expect(inWin('2031-06-15T23:30:00', '2031-06-15', '23:45:00')).toBe(true));
    it('now=23:30 — 23:59:59 TODAY is in', () => expect(inWin('2031-06-15T23:30:00', '2031-06-15', '23:59:59')).toBe(true));
    it('now=23:30 — 00:00:00 TOMORROW is in (across midnight)', () => expect(inWin('2031-06-15T23:30:00', '2031-06-16', '00:00:00')).toBe(true));
    it('now=23:30 — 00:30 TOMORROW is in', () => expect(inWin('2031-06-15T23:30:00', '2031-06-16', '00:30:00')).toBe(true));
    it('now=23:30 — 01:30 TOMORROW is in (exactly now+2h, inclusive)', () => expect(inWin('2031-06-15T23:30:00', '2031-06-16', '01:30:00')).toBe(true));
    it('now=23:30 — 01:30:01 TOMORROW is OUT', () => expect(inWin('2031-06-15T23:30:00', '2031-06-16', '01:30:01')).toBe(false));
    it('now=23:30 — 23:29:59 TODAY is OUT (already started)', () => expect(inWin('2031-06-15T23:30:00', '2031-06-15', '23:29:59')).toBe(false));
    it('now=23:30 — exactly now is IN (inclusive)', () => expect(inWin('2031-06-15T23:30:00', '2031-06-15', '23:30:00')).toBe(true));
    it('now=23:30 — 10:00 TOMORROW is OUT', () => expect(inWin('2031-06-15T23:30:00', '2031-06-16', '10:00:00')).toBe(false));
    it('now=23:30 — 01:00 TODAY (22h ago, same date, earlier time) is OUT — a time-only compare would wrongly include it', () => expect(inWin('2031-06-15T23:30:00', '2031-06-15', '01:00:00')).toBe(false));
    it('now=00:15 (just after midnight) — 02:00 same day is in; 02:16 is out; 23:00 PREVIOUS day is out', () => {
      expect(inWin('2031-06-16T00:15:00', '2031-06-16', '02:00:00')).toBe(true);
      expect(inWin('2031-06-16T00:15:00', '2031-06-16', '02:16:00')).toBe(false);
      expect(inWin('2031-06-16T00:15:00', '2031-06-15', '23:00:00')).toBe(false);
    });
  });

  describe('ordinary daytime and the 22:00 transition (the first moment the old query broke)', () => {
    it('now=10:00 → 10:00..12:00 in, 09:59:59 and 12:00:01 out', () => {
      expect(inWin('2031-06-15T10:00:00', '2031-06-15', '10:00:00')).toBe(true);
      expect(inWin('2031-06-15T10:00:00', '2031-06-15', '12:00:00')).toBe(true);
      expect(inWin('2031-06-15T10:00:00', '2031-06-15', '09:59:59')).toBe(false);
      expect(inWin('2031-06-15T10:00:00', '2031-06-15', '12:00:01')).toBe(false);
    });
    it.each([['22:00:00', '23:00:00', true], ['22:00:00', '23:59:59', true], ['22:00:00', '00:00:00+1', true], ['22:00:00', '00:00:01+1', false],
             ['22:30:00', '23:45:00', true], ['21:59:00', '23:59:00', true], ['21:59:00', '23:59:01', false]])(
      'now=%s appointment %s → %p', (now, appt, expected) => {
        const nextDay = appt.endsWith('+1');
        const time = appt.replace('+1', '');
        expect(inWin(`2031-06-15T${now}`, nextDay ? '2031-06-16' : '2031-06-15', time)).toBe(expected);
      });
  });

  it('works across a month and year end', () => {
    expect(inWin('2031-12-31T23:45:00', '2032-01-01', '00:30:00')).toBe(true);
    expect(inWin('2031-12-31T23:45:00', '2032-01-01', '02:00:00')).toBe(false);
  });

  it('agrees with a brute-force minute-by-minute oracle for every minute of a day and the next', () => {
    const now = dayjs('2031-06-15T23:30:00');
    for (let m = -300; m <= 600; m += 1) {
      const t = now.add(m, 'minute');
      const expected = m >= 0 && m <= 120;
      const got = isInTwoHourWindow(new Date(`${t.format('YYYY-MM-DD')}T00:00:00Z`), t.format('HH:mm:ss'), now.toDate());
      if (got !== expected) throw new Error(`offset ${m} min (${t.format('YYYY-MM-DD HH:mm')}) expected ${expected}, got ${got}`);
    }
  });
});
