jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { WhatsappProviderPolicy } from './whatsapp-provider.policy';
import { ReminderFlow } from './flows/reminder.flow';
import { WhatsappService } from './whatsapp.service';

// Throwaway, correctly-shaped credentials (never real)
const TWILIO_SID = 'AC' + 'a1b2c3d4'.repeat(4);
const TWILIO_TOKEN = 'tw_token_' + 'Zx9Qm4'.repeat(3);
const D360_KEY = 'd360_key_' + 'Lp7Vn2'.repeat(3);

const cfg = (v: Record<string, string | undefined>): any => ({ get: (k: string) => v[k] });
const policy = (v: Record<string, string | undefined>) => new WhatsappProviderPolicy(cfg(v));

describe('WhatsappProviderPolicy', () => {
  describe('primary()', () => {
    it.each([
      [undefined, 'twilio'], ['twilio', 'twilio'], ['TWILIO', 'twilio'],
      ['360dialog', '360dialog'], ['d360', '360dialog'], ['  360DIALOG ', '360dialog'],
      ['meta', 'twilio'], ['', 'twilio'],
    ])('WHATSAPP_PROVIDER=%p → %p', (raw, expected) => {
      expect(policy({ 'whatsapp.provider': raw as any }).primary()).toBe(expected);
    });
  });

  describe('isConfigured()', () => {
    it('recognises real-shaped credentials', () => {
      expect(policy({ 'twilio.accountSid': TWILIO_SID, 'twilio.authToken': TWILIO_TOKEN }).isConfigured('twilio')).toBe(true);
      expect(policy({ 'whatsapp.apiKey': D360_KEY }).isConfigured('360dialog')).toBe(true);
    });
    it('treats .env.example placeholders and blanks as NOT configured', () => {
      expect(policy({ 'twilio.accountSid': 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'twilio.authToken': 'your_twilio_auth_token' }).isConfigured('twilio')).toBe(false);
      expect(policy({ 'twilio.accountSid': TWILIO_SID, 'twilio.authToken': '' }).isConfigured('twilio')).toBe(false);
      expect(policy({ 'whatsapp.apiKey': 'your_360dialog_api_key' }).isConfigured('360dialog')).toBe(false);
      expect(policy({}).isConfigured('twilio')).toBe(false);
      expect(policy({}).isConfigured('360dialog')).toBe(false);
    });
  });

  describe('effective() — exactly one owner, with fallback so nothing is dropped', () => {
    const both = { 'twilio.accountSid': TWILIO_SID, 'twilio.authToken': TWILIO_TOKEN, 'whatsapp.apiKey': D360_KEY };
    it('both configured: the configured primary wins', () => {
      expect(policy({ ...both, 'whatsapp.provider': 'twilio' }).effective()).toBe('twilio');
      expect(policy({ ...both, 'whatsapp.provider': '360dialog' }).effective()).toBe('360dialog');
      expect(policy({ ...both }).effective()).toBe('twilio');                    // default primary
    });
    it('primary lacks credentials but the other has them: the other sends (fallback)', () => {
      expect(policy({ 'whatsapp.provider': 'twilio', 'whatsapp.apiKey': D360_KEY }).effective()).toBe('360dialog');
      expect(policy({ 'whatsapp.provider': '360dialog', 'twilio.accountSid': TWILIO_SID, 'twilio.authToken': TWILIO_TOKEN }).effective()).toBe('twilio');
    });
    it('nothing configured: stays with the primary so the failure is visible', () => {
      expect(policy({ 'whatsapp.provider': 'twilio' }).effective()).toBe('twilio');
      expect(policy({ 'whatsapp.provider': '360dialog' }).effective()).toBe('360dialog');
    });
    it('shouldSend is true for exactly one provider', () => {
      for (const v of [both, {}, { 'whatsapp.apiKey': D360_KEY }, { 'whatsapp.provider': '360dialog' }]) {
        const p = policy(v);
        expect([p.shouldSend('twilio'), p.shouldSend('360dialog')].filter(Boolean)).toHaveLength(1);
      }
    });
  });
});

describe('a booking is confirmed by exactly ONE provider (both listeners receive appointment.booked)', () => {
  const event = {
    clinicId: 'c1',
    appointment: {
      id: 'a1', appointmentDate: new Date('2031-03-03'), startTime: '10:00:00',
      patient: { fullName: 'Asha', phone: '+919999999999', waOptIn: true },
      dentist: { fullName: 'Dr Rao' }, clinic: { name: 'Smile Clinic' },
    },
  };

  /** Fire the event at both real listeners and count what each provider actually dispatched. */
  async function fire(values: Record<string, string | undefined>, optedIn = true) {
    const p = policy(values);
    const twilioSender: any = { sendTemplate: jest.fn(async () => undefined), fromNumber: '+14155550100' };
    const reminder = new ReminderFlow({} as any, twilioSender, p);

    const wa = new WhatsappService({} as any, cfg(values), p);
    const d360Send = jest.spyOn(wa, 'sendAppointmentConfirmation').mockResolvedValue({} as any);

    const ev: any = { ...event, appointment: { ...event.appointment, patient: { ...event.appointment.patient, waOptIn: optedIn } } };
    await Promise.all([reminder.onAppointmentBooked(ev), wa.onAppointmentBooked(ev)]);
    return { viaTwilio: twilioSender.sendTemplate.mock.calls.length, via360: d360Send.mock.calls.length };
  }

  const both = { 'twilio.accountSid': TWILIO_SID, 'twilio.authToken': TWILIO_TOKEN, 'whatsapp.apiKey': D360_KEY };

  it('provider=twilio (default, both configured): only Twilio confirms', async () => {
    expect(await fire({ ...both })).toEqual({ viaTwilio: 1, via360: 0 });
  });
  it('provider=360dialog (both configured): only 360Dialog confirms', async () => {
    expect(await fire({ ...both, 'whatsapp.provider': '360dialog' })).toEqual({ viaTwilio: 0, via360: 1 });
  });
  it('only 360Dialog has credentials: it confirms (confirmation is not lost)', async () => {
    expect(await fire({ 'whatsapp.apiKey': D360_KEY })).toEqual({ viaTwilio: 0, via360: 1 });
  });
  it('only Twilio has credentials: it confirms', async () => {
    expect(await fire({ 'twilio.accountSid': TWILIO_SID, 'twilio.authToken': TWILIO_TOKEN, 'whatsapp.provider': '360dialog' })).toEqual({ viaTwilio: 1, via360: 0 });
  });
  it('never sends to a patient who has not opted in, whichever provider', async () => {
    expect(await fire({ ...both }, false)).toEqual({ viaTwilio: 0, via360: 0 });
    expect(await fire({ ...both, 'whatsapp.provider': '360dialog' }, false)).toEqual({ viaTwilio: 0, via360: 0 });
  });
  it('without the policy injected (legacy construction) behaviour is unchanged: both would send', async () => {
    const twilioSender: any = { sendTemplate: jest.fn(async () => undefined), fromNumber: '+1' };
    const reminder = new ReminderFlow({} as any, twilioSender);
    const wa = new WhatsappService({} as any, cfg({}));
    const d360Send = jest.spyOn(wa, 'sendAppointmentConfirmation').mockResolvedValue({} as any);
    await Promise.all([reminder.onAppointmentBooked(event as any), wa.onAppointmentBooked(event as any)]);
    expect(twilioSender.sendTemplate).toHaveBeenCalledTimes(1);
    expect(d360Send).toHaveBeenCalledTimes(1);
  });
});
