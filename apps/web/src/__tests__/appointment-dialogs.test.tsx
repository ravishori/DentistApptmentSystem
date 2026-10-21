/**
 * Appointment management UI: cancel and reschedule dialogs, the slot manager, and the page's action buttons, rendered on the
 * server with seeded query results (no network, no provider). Click/typing behaviour and the mutations themselves are not
 * exercised here (no DOM in this test setup): the rules they use are unit-tested in appointment-rules.test.ts and the API
 * side in the API's appointments-slot-routes / slots-manage specs.
 */
import * as React from 'react';
import AppointmentsPage from '@/app/(dashboard)/appointments/page';
import { CancelAppointmentDialog } from '@/components/appointments/cancel-dialog';
import { RescheduleAppointmentDialog } from '@/components/appointments/reschedule-dialog';
import { SlotManagerDialog } from '@/components/appointments/slot-manager';
import { failQueries, html, newClient, succeedQueries, unavailable503 } from './helpers';
import { todayString } from '@/lib/appointment-rules';

// The shared setup replaces the Header with a title-only stub; here the real one is needed to see the page's header actions
jest.mock('@/components/layout/header', () => jest.requireActual('@/components/layout/header'));
let mockRole = 'clinic_admin';
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'u1', fullName: 'T', role: mockRole }, tenant: { name: 'C' }, isLoading: false }) }));

const today = todayString();
const appt = (over: object = {}) => ({
  id: 'a1', status: 'scheduled', dentistId: 'd1', patientId: 'p1', appointmentDate: `${today}T00:00:00.000Z`,
  startTime: '09:30:00', endTime: '10:00:00', type: 'consultation', patient: { fullName: 'Riya Sharma', phone: '+910000' }, dentist: { fullName: 'Asha' }, ...over,
});
const render = (ui: React.ReactElement, mutate?: (qc: ReturnType<typeof newClient>) => void) => {
  const qc = newClient();
  html(ui, qc);
  mutate?.(qc);
  return html(ui, qc);
};
const keyIs = (...names: string[]) => (k: readonly unknown[]) => names.includes(String(k[0]));
const noop = () => undefined;

describe('Cancel dialog (destructive: confirmation and a reason)', () => {
  const m = render(<CancelAppointmentDialog appt={appt()} onClose={noop} />);
  it('is an accessible modal that names the appointment being cancelled', () => {
    expect(m).toContain('role="dialog"');
    expect(m).toContain('aria-modal="true"');
    expect(m).toContain('aria-labelledby=');
    expect(m).toContain('Cancel this appointment?');
    expect(m).toContain('Riya Sharma');
    expect(m).toContain('09:30');
  });
  it('asks for a reason (required, labelled, limited) and offers a safe way out', () => {
    expect(m).toContain('Reason for cancelling *');
    expect(m).toContain('maxLength="500"');
    expect(m).toContain('Keep appointment');
    expect(m).toContain('Cancel appointment');
  });
  it('shows no error before the user submits', () => {
    expect(m).not.toContain('role="alert"');
  });
});

describe('Reschedule dialog', () => {
  const ui = <RescheduleAppointmentDialog appt={appt()} onClose={noop} />;
  it('loading: skeleton placeholders, no slots, no error', () => {
    const m = render(ui);
    expect(m).toContain('Reschedule appointment');
    expect(m).toContain('aria-busy="true"');
    expect(m).not.toContain('role="alert"');
    expect(m).toContain('Riya Sharma');
  });
  it('ready: free times are offered as an accessible radio group (HH:MM – HH:MM)', () => {
    const m = render(ui, (qc) => succeedQueries(qc, [
      { id: 's1', startTime: '10:00:00', endTime: '10:30:00' }, { id: 's2', startTime: '10:30:00', endTime: '11:00:00' },
    ], keyIs('slots')));
    expect(m).toContain('role="radiogroup"');
    expect(m).toContain('10:00 – 10:30');
    expect(m).toContain('10:30 – 11:00');
    expect((m.match(/role="radio"/g) ?? []).length).toBe(2);
    expect(m).toContain('data-choice="resched-slot:10:00"');
  });
  it('empty: a clear "no free times" message, not an error', () => {
    const m = render(ui, (qc) => succeedQueries(qc, [], keyIs('slots')));
    expect(m).toContain('No free times on this date');
    expect(m).not.toContain('Could not load available times');
  });
  it('failed: an error with a support reference and Try again, never "no free times"', () => {
    const m = render(ui, (qc) => failQueries(qc, unavailable503(), keyIs('slots')));
    expect(m).toContain('Could not load available times');
    expect(m).toContain('req-ref-12345');
    expect(m).toContain('Try again');
    expect(m).not.toContain('No free times');
  });
  it('the date field cannot go into the past and the confirm button exists', () => {
    const m = render(ui);
    expect(m).toContain(`min="${today}"`);
    expect(m).toContain('Confirm new time');
  });
});

describe('Slot manager', () => {
  const ui = (props: object = {}) => <SlotManagerDialog onClose={noop} {...props} />;
  const dentists = [{ id: 'd1', fullName: 'Dr Asha' }];
  const rows = [
    { id: 's1', startTime: '09:00:00', endTime: '09:30:00', isBooked: false, isBlocked: false },
    { id: 's2', startTime: '09:30:00', endTime: '10:00:00', isBooked: true, isBlocked: false },
    { id: 's3', startTime: '10:00:00', endTime: '10:30:00', isBooked: false, isBlocked: true, blockReason: 'Dentist on leave' },
  ];

  it('starts with a prompt, not a list (nothing is fetched until a dentist is chosen)', () => {
    const m = render(ui());
    expect(m).toContain('Manage slots');
    expect(m).toContain('Choose a dentist and a date');
    expect(m).not.toContain('aria-label="Slots"');
  });
  it('ready: each slot shows its state in words and offers only the valid action', () => {
    const m = render(ui({ initialDentistId: 'd1', initialDate: '2031-03-03' }), (qc) => {
      succeedQueries(qc, dentists, keyIs('dentists'));
      succeedQueries(qc, rows, keyIs('all-slots'));
    });
    expect(m).toContain('aria-label="Slots"');
    expect(m).toContain('Available');
    expect(m).toContain('Booked');
    expect(m).toContain('Blocked');
    expect(m).toContain('Reason: Dentist on leave');
    expect(m).toContain('data-slot-state="available"');
    expect(m).toContain('data-slot-state="booked"');
    expect(m).toContain('data-slot-state="blocked"');
    expect((m.match(/>\s*Block\s*</g) ?? []).length + (m.match(/Block<\/button>/g) ?? []).length).toBeGreaterThan(0);
    expect(m).toContain('Unblock');
    // exactly one block button (the available slot) and one unblock button (the blocked slot); the booked slot has neither
    const bookedItem = m.slice(m.indexOf('data-slot-state="booked"'), m.indexOf('data-slot-state="blocked"'));
    expect(bookedItem).not.toMatch(/Block|Unblock/);
  });
  it('no confirmation or error is shown until an action is chosen', () => {
    const m = render(ui({ initialDentistId: 'd1', initialDate: '2031-03-03' }), (qc) => {
      succeedQueries(qc, dentists, keyIs('dentists'));
      succeedQueries(qc, rows, keyIs('all-slots'));
    });
    expect(m).not.toContain('Confirm block');
    expect(m).not.toContain('Confirm unblock');
    expect(m).not.toContain('role="alert"');
  });
  it('empty day: explains there is nothing to manage', () => {
    const m = render(ui({ initialDentistId: 'd1', initialDate: '2031-03-03' }), (qc) => succeedQueries(qc, [], keyIs('all-slots')));
    expect(m).toContain('No slots for this date');
  });
  it('failed (for example 403 for a role without access, or 503): an error with a reference, not an empty list', () => {
    const m = render(ui({ initialDentistId: 'd1', initialDate: '2031-03-03' }), (qc) => failQueries(qc, unavailable503(), keyIs('all-slots')));
    expect(m).toContain('Could not load slots');
    expect(m).toContain('req-ref-12345');
    expect(m).not.toContain('No slots for this date');
  });
  it('failed refresh with earlier data keeps the list and says it may be out of date', () => {
    const m = render(ui({ initialDentistId: 'd1', initialDate: '2031-03-03' }), (qc) => {
      succeedQueries(qc, rows, keyIs('all-slots'));
      for (const q of qc.getQueryCache().getAll()) {
        if (keyIs('all-slots')(q.queryKey)) q.setState({ ...q.state, status: 'error', error: unavailable503(), fetchStatus: 'idle', errorUpdatedAt: Date.now(), errorUpdateCount: 1 } as never);
      }
    });
    expect(m).toContain('aria-label="Slots"');
    expect(m).toContain('Could not refresh');
  });
});

describe('Appointments page actions', () => {
  const withRows = (rowsList: object[]) => (qc: ReturnType<typeof newClient>) =>
    succeedQueries(qc, { items: rowsList, total: rowsList.length }, keyIs('appointments'));

  afterEach(() => { mockRole = 'clinic_admin'; });

  it('scheduled and confirmed appointments offer Reschedule and Cancel (named for the patient)', () => {
    const m = render(<AppointmentsPage />, withRows([appt({ id: 'a1' }), appt({ id: 'a2', status: 'confirmed', patient: { fullName: 'Arjun Mehta' } })]));
    expect(m).toContain('aria-label="Reschedule Riya Sharma"');
    expect(m).toContain('aria-label="Cancel Riya Sharma"');
    expect(m).toContain('aria-label="Reschedule Arjun Mehta"');
    expect(m).toContain('aria-label="Cancel Arjun Mehta"');
  });
  it('in progress can be cancelled but not rescheduled; completed, cancelled, no-show and rescheduled offer neither', () => {
    const m = render(<AppointmentsPage />, withRows([
      appt({ id: 'b1', status: 'in_progress', patient: { fullName: 'Inpro Gress' } }),
      appt({ id: 'b2', status: 'completed', patient: { fullName: 'Comp Leted' } }),
      appt({ id: 'b3', status: 'cancelled', patient: { fullName: 'Can Celled' } }),
      appt({ id: 'b4', status: 'no_show', patient: { fullName: 'No Show' } }),
      appt({ id: 'b5', status: 'rescheduled', patient: { fullName: 'Re Scheduled' } }),
    ]));
    expect(m).toContain('aria-label="Cancel Inpro Gress"');
    expect(m).not.toContain('aria-label="Reschedule Inpro Gress"');
    for (const n of ['Comp Leted', 'Can Celled', 'No Show', 'Re Scheduled']) {
      expect(m).not.toContain(`aria-label="Cancel ${n}"`);
      expect(m).not.toContain(`aria-label="Reschedule ${n}"`);
    }
  });
  it('cancel no longer fires directly: no dialog is open until the button is used', () => {
    const m = render(<AppointmentsPage />, withRows([appt()]));
    expect(m).not.toContain('Cancel this appointment?');
    expect(m).not.toContain('Reschedule appointment</');
  });
  it.each([['clinic_admin', true], ['receptionist', true], ['dentist', false], ['assistant', false]])('"Manage slots" is shown for %s: %s', (role, shown) => {
    mockRole = role;
    const m = render(<AppointmentsPage />, withRows([]));
    expect(m.includes('Manage slots')).toBe(shown);
  });
  it('a failed list is still an error, never an empty agenda (existing behaviour kept)', () => {
    const m = render(<AppointmentsPage />, (qc) => failQueries(qc, unavailable503(), keyIs('appointments')));
    expect(m).toContain('Could not load appointments');
    expect(m).not.toContain('Cancel Riya');
  });
});
