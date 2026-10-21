/**
 * Page-level rendering of the four states for every page that loads data: loading, FAILED, genuinely EMPTY and ready.
 * A first server render registers each page's queries; the test then puts them into the state under test (as if the
 * request had failed or returned nothing) and renders again, which is what a user would see.
 */
import * as React from 'react';
import AnalyticsPage from '@/app/(dashboard)/analytics/page';
import SettingsPage from '@/app/(dashboard)/settings/page';
import WhatsappPage from '@/app/(dashboard)/whatsapp/page';
import PatientsPage from '@/app/(dashboard)/patients/page';
import AppointmentsPage from '@/app/(dashboard)/appointments/page';
import BillingPage from '@/app/(dashboard)/billing/page';
import DashboardPage from '@/app/(dashboard)/dashboard/page';
import ClinicSchedulePage from '@/app/(dashboard)/clinic/page';
import { DoctorCalendar } from '@/components/clinic/DoctorCalendar';
import { ChairUtilization } from '@/components/clinic/ChairUtilization';
import { AvailabilitySettings } from '@/components/clinic/AvailabilitySettings';
import { ConversationsEmpty, ConversationsList, toConversationRows } from '@/components/whatsapp/conversations';
import { QueryBoundary } from '@/components/ui/query-boundary';
import { renderToStaticMarkup } from 'react-dom/server';
import { failQueries, hasAlert, html, leaky500, newClient, networkDown, succeedQueries, unavailable503 } from './helpers';

const render = (ui: React.ReactElement, mutate?: (qc: ReturnType<typeof newClient>) => void) => {
  const qc = newClient();
  html(ui, qc);                       // first pass registers the queries
  mutate?.(qc);
  return html(ui, qc);
};
const keyIs = (...names: string[]) => (k: readonly unknown[]) => names.includes(String(k[0]));

describe('Analytics', () => {
  it('loading: skeletons, no error and no "No data yet"', () => {
    const m = render(<AnalyticsPage />);
    expect(hasAlert(m)).toBe(false); expect(m).not.toContain('No data yet');
  });
  it('FAILED requests show section errors with a reference — never zeros, empty charts or "No data yet"', () => {
    const m = render(<AnalyticsPage />, (qc) => failQueries(qc, unavailable503(), keyIs('analytics-dashboard', 'analytics-trends', 'analytics-funnel', 'analytics-dentists')));
    expect(hasAlert(m)).toBe(true);
    for (const t of ['Could not load the key figures', 'Could not load the appointments chart', 'Could not load the conversion funnel', 'Could not load dentist performance']) expect([t, m.includes(t)]).toEqual([t, true]);
    expect(m).toContain('req-ref-12345');
    expect(m).not.toContain('No data yet');
    expect(m).not.toContain('Today: 0');                           // no plausible-looking sub-figure for a failed load
    expect(m).not.toMatch(/Month Revenue[\s\S]{0,200}₹0/);       // a failed KPI is "—", not ₹0
    expect(m).toContain('—');
  });
  it('a 500 with a leaky body shows nothing internal', () => {
    const m = render(<AnalyticsPage />, (qc) => failQueries(qc, leaky500(), keyIs('analytics-dashboard', 'analytics-dentists')));
    for (const leak of ['SELECT', 'Prisma', 'C:\\', 'Asha Rao']) expect(m.includes(leak)).toBe(false);
    expect(m).toContain('req-leak-12345');
  });
  it('a failure of one section does not hide the others', () => {
    const m = render(<AnalyticsPage />, (qc) => {
      succeedQueries(qc, [], keyIs('analytics-funnel'));
      failQueries(qc, networkDown(), keyIs('analytics-dentists'));
    });
    expect(m).toContain('Could not load dentist performance');
    expect(m).not.toContain('Could not load the conversion funnel');
  });
  it('genuinely EMPTY dentists is "No data yet" and NOT an error', () => {
    const m = render(<AnalyticsPage />, (qc) => succeedQueries(qc, [], keyIs('analytics-dentists')));
    expect(m).toContain('No data yet'); expect(m).not.toContain('Could not load dentist performance');
  });
});

describe('Settings', () => {
  it('loading shows skeletons, not the form or an error', () => {
    const m = render(<SettingsPage />);
    expect(hasAlert(m)).toBe(false); expect(m).not.toContain('<form');
  });
  it('FAILED profile load shows an error with retry and NO editable form (saving blanks would overwrite the profile)', () => {
    const m = render(<SettingsPage />, (qc) => failQueries(qc, unavailable503()));
    expect(m).toContain('Could not load the clinic settings'); expect(m).toContain('req-ref-12345'); expect(m).toContain('Try again');
    expect(m).not.toContain('<form');
  });
  it('a loaded profile renders the form', () => {
    const m = render(<SettingsPage />, (qc) => succeedQueries(qc, { clinicName: 'Test Clinic', settings: {} }, keyIs('clinic-profile')));
    expect(m).toContain('<form'); expect(hasAlert(m)).toBe(false);
  });
});

describe('Clinic schedule', () => {
  it('the page shell renders (its tabs load their own data)', () => {
    expect(render(<ClinicSchedulePage />)).toContain('Clinic Schedule');
  });
  it('Doctor calendar: loading → FAILED (error + reference, no "No availability") → EMPTY', () => {
    expect(hasAlert(render(<DoctorCalendar />))).toBe(false);
    const failed = render(<DoctorCalendar />, (qc) => failQueries(qc, unavailable503(), keyIs('clinic-week')));
    expect(failed).toContain('Could not load the weekly calendar'); expect(failed).toContain('req-ref-12345');
    expect(failed).not.toContain('No availability data for this week');
    const empty = render(<DoctorCalendar />, (qc) => succeedQueries(qc, [], keyIs('clinic-week')));
    expect(empty).toContain('No availability data for this week'); expect(hasAlert(empty)).toBe(false);
  });
  it('Doctor calendar day view fails visibly too', () => {
    const m = render(<DoctorCalendar mode="day" />, (qc) => failQueries(qc, networkDown(), keyIs('clinic-day')));
    expect(m).toContain('Could not load the day schedule'); expect(m).toContain('Cannot reach the server');
  });
  it('a failed doctor list is flagged next to the filter instead of silently showing only "All Doctors"', () => {
    const m = render(<DoctorCalendar />, (qc) => failQueries(qc, unavailable503(), keyIs('clinic-doctors')));
    expect(m).toContain('Doctor list unavailable');
  });
  it('Chair utilization: FAILED vs EMPTY are different', () => {
    const failed = render(<ChairUtilization />, (qc) => failQueries(qc, unavailable503(), keyIs('chair-utilization')));
    expect(failed).toContain('Could not load chair utilization'); expect(failed).not.toContain('No chairs configured');
    const empty = render(<ChairUtilization />, (qc) => succeedQueries(qc, [], keyIs('chair-utilization')));
    expect(empty).toContain('No chairs configured'); expect(hasAlert(empty)).toBe(false);
  });
  it('Availability settings: a failed doctor list is an error, not an empty selector', () => {
    const m = render(<AvailabilitySettings />, (qc) => failQueries(qc, unavailable503(), keyIs('clinic-doctors')));
    expect(m).toContain('Could not load the doctor list'); expect(m).toContain('req-ref-12345');
  });
  it('Availability rules errors are rendered by the same component (the rules query only runs after a doctor is selected, which needs effects a server render does not run)', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../components/clinic/AvailabilitySettings.tsx'), 'utf8');
    expect(src).toContain('Could not load the availability rules');
    expect(src).toMatch(/rulesFailed \? \(/);
  });
});

describe('WhatsApp', () => {
  it('the overview no longer claims a live "Connected" engine it does not monitor', () => {
    const m = render(<WhatsappPage />);
    expect(m).not.toContain('Connected'); expect(m).not.toContain('Automation Engine Active');
    expect(m).toContain('does not monitor live delivery');
  });
  const wrap = (q: any) => renderToStaticMarkup(
    <QueryBoundary query={q} errorTitle="Could not load conversations" compact={false} isEmpty={(d) => toConversationRows(d).length === 0} empty={<ConversationsEmpty />}>
      {(d) => <ConversationsList rows={toConversationRows(d)} />}
    </QueryBoundary>,
  );
  it('conversations: FAILED shows an error with reference, not "No conversations yet"', () => {
    const m = wrap({ isError: true, data: undefined, error: unavailable503() });
    expect(m).toContain('Could not load conversations'); expect(m).toContain('req-ref-12345'); expect(m).not.toContain('No conversations yet');
  });
  it('conversations: the API payload { items: [] } is genuinely EMPTY (it used to read .length of an object and always look empty)', () => {
    const m = wrap({ isError: false, data: { items: [], total: 0, page: 1, limit: 20 } });
    expect(m).toContain('No conversations yet'); expect(hasAlert(m)).toBe(false);
  });
  it('conversations: real API rows are shown with name, phone fallback and last message', () => {
    const rows = toConversationRows({ items: [
      { id: 'c1', patientPhone: '+910000000001', patient: { fullName: 'Test Patient' }, messages: [{ content: 'Hello' }], lastMessageAt: '2031-06-01T10:00:00Z' },
      { id: 'c2', patientPhone: '+910000000002', patient: null, messages: [], lastMessageAt: null },
    ], total: 2 });
    expect(rows.map((r) => r.title)).toEqual(['Test Patient', '+910000000002']);
    const m = wrap({ isError: false, data: { items: [{ id: 'c1', patientPhone: '+910000000001', patient: { fullName: 'Test Patient' }, messages: [{ content: 'Hello' }] }] } });
    expect(m).toContain('Test Patient'); expect(m).toContain('Hello');
  });
  it('toConversationRows tolerates odd payloads', () => {
    for (const v of [undefined, null, 'x', {}, { items: 'no' }]) expect(toConversationRows(v)).toEqual([]);
  });
});

describe('pages converted in the previous change keep their error states (now rendered, not only grepped)', () => {
  it.each([
    ['Patients', PatientsPage, 'Could not load patients', 'No patients yet'],
    ['Appointments', AppointmentsPage, 'Could not load appointments', 'No appointments'],
    ['Billing', BillingPage, 'Could not load invoices', 'No invoices'],
    ['Dashboard', DashboardPage, 'Could not load the dashboard figures', null],
  ])('%s: a failed load is an error with reference, never the empty state', (_n, Page: any, title, emptyText) => {
    const m = render(<Page />, (qc) => failQueries(qc, unavailable503()));
    expect(m).toContain(title); expect(m).toContain('req-ref-12345');
    if (emptyText) expect(m).not.toContain(emptyText);
  });
});
