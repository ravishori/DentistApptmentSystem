/**
 * Real-PostgreSQL tests for scheduled WhatsApp messages: claim protocol, provider pinning, safe failover,
 * concurrency, retry and consent. Skipped unless TEST_DATABASE_URL is set.
 * Use ONLY a disposable database (schema from `prisma db push`), never dentalease_db.
 */
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import dayjs from 'dayjs';
import { RemindersService } from './reminders.service';
import { ReminderFlow } from '../whatsapp/flows/reminder.flow';
import { FollowupFlow } from '../whatsapp/flows/followup.flow';
import { BroadcastService } from '../whatsapp/broadcast/broadcast.service';
import { WhatsappProviderPolicy } from '../whatsapp/whatsapp-provider.policy';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ambiguityStore, InMemoryAmbiguityStore } from '../whatsapp/reminder-delivery';
import { claimReminder, confirmReminder, releaseReminder, LEASE_MS } from './reminder-claim';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Throwaway, correctly-shaped credentials (never real)
const TWILIO = { 'twilio.accountSid': 'AC' + 'a1b2c3d4'.repeat(4), 'twilio.authToken': 'tw_token_' + 'Zx9Qm4'.repeat(3) };
const D360 = { 'whatsapp.apiKey': 'd360_key_' + 'Lp7Vn2'.repeat(3) };
const BOTH_TWILIO_PRIMARY = { ...TWILIO, ...D360 };
const BOTH_360_PRIMARY = { ...TWILIO, ...D360, 'whatsapp.provider': '360dialog' };

type Outcome = 'ok' | { status: number } | 'timeout';
const err = (o: Exclude<Outcome, 'ok'>) =>
  o === 'timeout' ? Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' })
                  : Object.assign(new Error(`provider rejected (${o.status})`), { status: o.status, response: { status: o.status } });

d('scheduled WhatsApp messages on PostgreSQL', () => {
  const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  const stamp = Date.now();
  let clinicId: string, dentistId: string, patientId: string, optedOutId: string, noPhoneId: string, apptId: string;
  const tomorrow = () => new Date(dayjs().add(1, 'day').format('YYYY-MM-DD'));
  const appt = () => prisma.appointment.findUniqueOrThrow({ where: { id: apptId } });

  beforeAll(async () => {
    clinicId = (await prisma.clinic.create({ data: { name: 'rem', slug: `rem${stamp}`, email: `rem${stamp}@r.test` } as any })).id;
    dentistId = (await prisma.user.create({ data: { clinicId, email: `d${stamp}@r.test`, passwordHash: 'x', fullName: 'Dr R', role: 'dentist' } as any })).id;
    const mk = (n: string, extra: any) => prisma.patient.create({ data: { clinicId, patientCode: `${n}-${stamp}`, fullName: `Pat ${n}`, ...extra } as any });
    patientId  = (await mk('in',  { phone: '+910000000020', waOptIn: true })).id;
    optedOutId = (await mk('out', { phone: '+910000000021', waOptIn: false })).id;
    noPhoneId  = (await mk('nop', { waOptIn: true })).id;
  });

  const mkAppt = async (over: any = {}) => (await prisma.appointment.create({ data: {
    clinicId, patientId, dentistId, appointmentDate: tomorrow(), startTime: '10:00:00', endTime: '10:30:00',
    status: 'scheduled', reminderStatus: 'pending', ...over,
  } as any })).id;

  beforeEach(async () => {
    ambiguityStore.use(new InMemoryAmbiguityStore());          // isolate the ambiguous-outcome memory per test
    await prisma.appointment.deleteMany({ where: { clinicId } });
    apptId = await mkAppt();
  });

  afterAll(async () => {
    await prisma.appointment.deleteMany({ where: { clinicId } });
    await prisma.patient.deleteMany({ where: { clinicId } });
    await prisma.user.deleteMany({ where: { clinicId } });
    await prisma.clinic.deleteMany({ where: { id: clinicId } });
    await prisma.$disconnect();
  });

  // ───────────────────────── claim protocol ─────────────────────────
  describe('claim protocol', () => {
    it('20 concurrent claims: exactly one wins', async () => {
      const wins = await Promise.all(Array.from({ length: 20 }, () => claimReminder(prisma, apptId, '24h')));
      expect(wins.filter(Boolean)).toHaveLength(1);
    });
    it('confirm advances the status and blocks every later claim', async () => {
      expect(await claimReminder(prisma, apptId, '24h')).toBe(true);
      await confirmReminder(prisma, apptId, '24h');
      expect((await appt()).reminderStatus).toBe('sent_24h');
      expect(await claimReminder(prisma, apptId, '24h')).toBe(false);
    });
    it('release (failed delivery) leaves the reminder pending and claimable again', async () => {
      expect(await claimReminder(prisma, apptId, '24h')).toBe(true);
      expect(await claimReminder(prisma, apptId, '24h')).toBe(false);
      await releaseReminder(prisma, apptId, '24h');
      const row = await appt();
      expect(row.reminderStatus).toBe('pending');
      expect(row.reminder24hAt).toBeNull();
      expect(await claimReminder(prisma, apptId, '24h')).toBe(true);
    });
    it('an abandoned claim (crashed mid-send) expires after the lease and can be taken over; a fresh one cannot', async () => {
      await prisma.appointment.update({ where: { id: apptId }, data: { reminder24hAt: new Date(Date.now() - LEASE_MS - 60_000) } });
      expect(await claimReminder(prisma, apptId, '24h')).toBe(true);
      expect(await claimReminder(prisma, apptId, '24h')).toBe(false);
    });
    it('2h and follow-up steps are claimed only from their own predecessor status', async () => {
      expect(await claimReminder(prisma, apptId, '2h')).toBe(false);
      await prisma.appointment.update({ where: { id: apptId }, data: { reminderStatus: 'sent_24h' } });
      expect((await Promise.all(Array.from({ length: 10 }, () => claimReminder(prisma, apptId, '2h')))).filter(Boolean)).toHaveLength(1);
      await prisma.appointment.update({ where: { id: apptId }, data: { reminderStatus: 'sent_2h', status: 'completed' } });
      expect((await Promise.all(Array.from({ length: 10 }, () => claimReminder(prisma, apptId, 'followup')))).filter(Boolean)).toHaveLength(1);
    });
  });

  // ───────────────────────── 24h reminder: provider pinning + failover ─────────────────────────
  describe('24h reminder — pinned to the configured provider with safe failover', () => {
    /** Build a ReminderFlow whose providers are fakes; every SUCCESSFUL delivery is appended to `log`. */
    function make(cfg: Record<string, string>, twilio: Outcome = 'ok', d360: Outcome = 'ok', delayMs = 0, log: string[] = []) {
      const sender: any = {
        fromNumber: '+14155550100',
        sendTemplate: jest.fn(async () => { if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); if (twilio !== 'ok') throw err(twilio); log.push('twilio'); }),
        sendButtons: jest.fn(async () => undefined),
      };
      const wa: any = {
        sendReminder24h: jest.fn(async () => {
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          if (d360 === 'ok') { log.push('360dialog'); return { status: 'sent' }; }
          return { status: 'failed', failureReason: 'rejected', httpStatus: d360 === 'timeout' ? undefined : d360.status };
        }),
      };
      const policy = new WhatsappProviderPolicy({ get: (k: string) => cfg[k] } as any);
      return { flow: new ReminderFlow(prisma as any, sender, policy, wa), sender, wa, log };
    }

    it('provider=twilio: only Twilio is used; 360Dialog is never called; status advances', async () => {
      const t = make(BOTH_TWILIO_PRIMARY);
      await t.flow.dispatch24h();
      expect(t.log).toEqual(['twilio']);
      expect(t.wa.sendReminder24h).not.toHaveBeenCalled();
      expect((await appt()).reminderStatus).toBe('sent_24h');
    });
    it('provider=360dialog: only 360Dialog is used; Twilio is never called', async () => {
      const t = make(BOTH_360_PRIMARY);
      await t.flow.dispatch24h();
      expect(t.log).toEqual(['360dialog']);
      expect(t.sender.sendTemplate).not.toHaveBeenCalled();
    });
    it('primary has no credentials → the other (configured) provider sends; nothing is dropped', async () => {
      const t = make({ ...D360 });
      await t.flow.dispatch24h();
      expect(t.log).toEqual(['360dialog']);
    });
    it('FAILOVER: Twilio definitively rejects (400) → 360Dialog delivers once; Twilio was tried once', async () => {
      const t = make(BOTH_TWILIO_PRIMARY, { status: 400 });
      await t.flow.dispatch24h();
      expect(t.sender.sendTemplate).toHaveBeenCalledTimes(1);
      expect(t.wa.sendReminder24h).toHaveBeenCalledTimes(1);
      expect(t.log).toEqual(['360dialog']);
      expect((await appt()).reminderStatus).toBe('sent_24h');
    });
    it('FAILOVER the other way: 360Dialog (primary) rejects (404) → Twilio delivers once', async () => {
      const t = make(BOTH_360_PRIMARY, 'ok', { status: 404 });
      await t.flow.dispatch24h();
      expect(t.log).toEqual(['twilio']);
    });
    it.each([['timeout' as Outcome], [{ status: 502 } as Outcome], [{ status: 429 } as Outcome]])(
      'AMBIGUOUS failure (%j) → NO failover (no duplicate risk); claim released; next tick retries the SAME provider', async (outcome) => {
        const log: string[] = [];
        const bad = make(BOTH_TWILIO_PRIMARY, outcome, 'ok', 0, log);
        await bad.flow.dispatch24h();
        expect(bad.wa.sendReminder24h).not.toHaveBeenCalled();                    // ← never failed over
        let row = await appt();
        expect(row.reminderStatus).toBe('pending');
        expect(row.reminder24hAt).toBeNull();                                     // claim released
        const good = make(BOTH_TWILIO_PRIMARY, 'ok', 'ok', 0, log);
        await good.flow.dispatch24h();                                            // retry
        expect(good.wa.sendReminder24h).not.toHaveBeenCalled();
        expect(log).toEqual(['twilio']);                                          // delivered exactly once overall
        row = await appt();
        expect(row.reminderStatus).toBe('sent_24h');
      });
    it('both providers definitively reject → released (pending), each tried once; a later tick succeeds', async () => {
      const log: string[] = [];
      const bad = make(BOTH_TWILIO_PRIMARY, { status: 400 }, { status: 401 }, 0, log);
      await bad.flow.dispatch24h();
      expect(bad.sender.sendTemplate).toHaveBeenCalledTimes(1);
      expect(bad.wa.sendReminder24h).toHaveBeenCalledTimes(1);
      expect((await appt()).reminderStatus).toBe('pending');
      const good = make(BOTH_TWILIO_PRIMARY, 'ok', 'ok', 0, log);
      await good.flow.dispatch24h();
      expect(log).toEqual(['twilio']);
    });
    it('definitive rejection but the other provider is NOT configured → no failover attempt; released', async () => {
      const t = make({ ...TWILIO }, { status: 400 });
      await t.flow.dispatch24h();
      expect(t.wa.sendReminder24h).not.toHaveBeenCalled();
      expect((await appt()).reminderStatus).toBe('pending');
    });
    it('Twilio template delivered but the quick-action buttons fail → still counts as delivered, never re-sent', async () => {
      const t = make(BOTH_TWILIO_PRIMARY);
      t.sender.sendButtons.mockRejectedValue(new Error('buttons down'));
      await t.flow.dispatch24h();
      await t.flow.dispatch24h();
      expect(t.sender.sendTemplate).toHaveBeenCalledTimes(1);
      expect((await appt()).reminderStatus).toBe('sent_24h');
    });

    describe('an AMBIGUOUS outcome pins the reminder to that provider (no automatic switch, ever)', () => {
      it('Twilio rejects (400) → 360Dialog is ambiguous (timeout) → the retry goes ONLY to 360Dialog, never back to Twilio', async () => {
        const log: string[] = [];
        const first = make(BOTH_TWILIO_PRIMARY, { status: 400 }, 'timeout', 0, log);
        await first.flow.dispatch24h();
        expect(first.sender.sendTemplate).toHaveBeenCalledTimes(1);                // tried Twilio (definitive reject)
        expect(first.wa.sendReminder24h).toHaveBeenCalledTimes(1);                 // then 360Dialog (ambiguous)
        expect((await appt()).reminderStatus).toBe('pending');                      // released for retry

        // Twilio is healthy again and 360Dialog recovers: a NEW instance (like a restart) must still stay on 360Dialog
        const retry = make(BOTH_TWILIO_PRIMARY, 'ok', 'ok', 0, log);
        await retry.flow.dispatch24h();
        expect(retry.sender.sendTemplate).not.toHaveBeenCalled();                   // Twilio NOT used: it could duplicate
        expect(log).toEqual(['360dialog']);                                         // exactly one delivery overall
        expect((await appt()).reminderStatus).toBe('sent_24h');
      });
      it('primary ambiguous → later the primary rejects definitively → STILL no failover (the earlier attempt may have delivered)', async () => {
        const log: string[] = [];
        await make(BOTH_TWILIO_PRIMARY, 'timeout', 'ok', 0, log).flow.dispatch24h();
        const second = make(BOTH_TWILIO_PRIMARY, { status: 400 }, 'ok', 0, log);
        await second.flow.dispatch24h();
        expect(second.wa.sendReminder24h).not.toHaveBeenCalled();
        expect(log).toEqual([]);
        expect((await appt()).reminderStatus).toBe('pending');                      // not lost: retried on the pinned provider
        const third = make(BOTH_TWILIO_PRIMARY, 'ok', 'ok', 0, log);
        await third.flow.dispatch24h();
        expect(log).toEqual(['twilio']);
        expect(third.wa.sendReminder24h).not.toHaveBeenCalled();
      });
      it('a definitive-only history does NOT pin: the next tick may start from the primary again', async () => {
        const log: string[] = [];
        await make(BOTH_TWILIO_PRIMARY, { status: 400 }, { status: 404 }, 0, log).flow.dispatch24h();   // both rejected, nothing delivered
        await make(BOTH_TWILIO_PRIMARY, 'ok', 'ok', 0, log).flow.dispatch24h();
        expect(log).toEqual(['twilio']);
      });
      it('CONCURRENCY after a pin: 4 racing instances → exactly one delivery, via the pinned provider only', async () => {
        const log: string[] = [];
        await make(BOTH_TWILIO_PRIMARY, { status: 400 }, 'timeout', 0, log).flow.dispatch24h();   // pins 360Dialog
        const flows = Array.from({ length: 4 }, () => make(BOTH_TWILIO_PRIMARY, 'ok', 'ok', 100, log));
        await Promise.all(flows.map((f) => f.flow.dispatch24h()));
        expect(log).toEqual(['360dialog']);
        expect(flows.every((f) => f.sender.sendTemplate.mock.calls.length === 0)).toBe(true);
      });
      it('pins are per appointment: #1 stays on its pinned provider, #2 follows the configured provider', async () => {
        const log: string[] = [];
        await make(BOTH_TWILIO_PRIMARY, 'timeout', 'ok', 0, log).flow.dispatch24h();        // pins appointment #1 to Twilio
        const other = await mkAppt({ startTime: '11:00:00' });
        const t = make(BOTH_360_PRIMARY, 'ok', 'ok', 0, log);                                  // configured provider is now 360Dialog
        await t.flow.dispatch24h();
        expect(t.sender.sendTemplate).toHaveBeenCalledTimes(1);                                // #1 → Twilio (pinned, despite 360 being primary)
        expect(t.wa.sendReminder24h).toHaveBeenCalledTimes(1);                                 // #2 → 360Dialog (configured)
        expect([...log].sort()).toEqual(['360dialog', 'twilio']);
        expect((await appt()).reminderStatus).toBe('sent_24h');
        expect((await prisma.appointment.findUniqueOrThrow({ where: { id: other } })).reminderStatus).toBe('sent_24h');
      });
    });

    it('CONCURRENCY: 4 scheduler instances at once → exactly ONE delivery in total (any provider)', async () => {
      const log: string[] = [];
      const flows = Array.from({ length: 4 }, () => make(BOTH_TWILIO_PRIMARY, 'ok', 'ok', 120, log).flow);
      await Promise.all(flows.map((f) => f.dispatch24h()));
      expect(log).toHaveLength(1);
      expect((await appt()).reminderStatus).toBe('sent_24h');
    });
    it('CONCURRENCY + FAILOVER: racing instances while Twilio rejects → still exactly one delivery (via 360Dialog)', async () => {
      const log: string[] = [];
      const flows = Array.from({ length: 4 }, () => make(BOTH_TWILIO_PRIMARY, { status: 400 }, 'ok', 100, log).flow);
      await Promise.all(flows.map((f) => f.dispatch24h()));
      expect(log).toEqual(['360dialog']);
    });
    it('CONCURRENCY + RETRY: an ambiguous failure in one instance while others race → exactly one eventual delivery', async () => {
      const log: string[] = [];
      const failing = make(BOTH_TWILIO_PRIMARY, 'timeout', 'ok', 80, log).flow;
      const racers = Array.from({ length: 3 }, () => make(BOTH_TWILIO_PRIMARY, 'ok', 'ok', 80, log).flow);
      await Promise.all([failing.dispatch24h(), ...racers.map((f) => f.dispatch24h())]);
      // whichever instance claimed first decided the outcome; if it was the failing one the claim was released
      if ((await appt()).reminderStatus === 'pending') await racers[0].dispatch24h();
      expect(log).toEqual(['twilio']);
      expect((await appt()).reminderStatus).toBe('sent_24h');
    });
  });

  // ───────────────────────── follow-up: same guarantees ─────────────────────────
  describe('follow-up — pinned provider, failover, concurrency', () => {
    const makeF = (cfg: Record<string, string>, twilio: Outcome = 'ok', d360: Outcome = 'ok', delayMs = 0, log: string[] = []) => {
      const sender: any = {
        fromNumber: '+14155550100',
        sendTemplate: jest.fn(async () => { if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); if (twilio !== 'ok') throw err(twilio); log.push('twilio'); }),
        sendButtons: jest.fn(async () => undefined),
      };
      const sessions: any = { startFlow: jest.fn(async () => undefined), patchData: jest.fn(async () => undefined) };
      const wa: any = {
        sendFollowup: jest.fn(async () => {
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          if (d360 === 'ok') { log.push('360dialog'); return { status: 'sent' }; }
          return { status: 'failed', failureReason: 'rejected', httpStatus: d360 === 'timeout' ? undefined : d360.status };
        }),
      };
      const policy = new WhatsappProviderPolicy({ get: (k: string) => cfg[k] } as any);
      return { flow: new FollowupFlow(prisma as any, sender, sessions, policy, wa), sender, wa, sessions, log };
    };
    // Eligible = completed, scheduled end ~30h ago (inside the 24–48h window). updatedAt is deliberately NOT touched.
    const endedAgo = (hours: number) => { const e = dayjs().subtract(hours, 'hour'); return { appointmentDate: new Date(e.format('YYYY-MM-DD')), startTime: e.subtract(30, 'minute').format('HH:mm:ss'), endTime: e.format('HH:mm:ss') }; };
    const makeEligible = (reminderStatus: string = 'sent_2h') =>
      prisma.appointment.update({ where: { id: apptId }, data: { status: 'completed', reminderStatus: reminderStatus as any, ...endedAgo(30) } });

    it('pinned: Twilio primary → Twilio only (template + rating session); a sent_2h appointment is picked up', async () => {
      await makeEligible('sent_2h');
      const t = makeF(BOTH_TWILIO_PRIMARY);
      await t.flow.dispatch();
      expect(t.log).toEqual(['twilio']);
      expect(t.wa.sendFollowup).not.toHaveBeenCalled();
      expect(t.sessions.startFlow).toHaveBeenCalledTimes(1);
      expect((await appt()).reminderStatus).toBe('sent_followup');
    });
    it('pinned: 360Dialog primary → 360Dialog only', async () => {
      await makeEligible('sent_24h');
      const t = makeF(BOTH_360_PRIMARY);
      await t.flow.dispatch();
      expect(t.log).toEqual(['360dialog']);
      expect(t.sender.sendTemplate).not.toHaveBeenCalled();
    });
    it('failover on definitive rejection (once); no failover on ambiguous failure, which is retried', async () => {
      await makeEligible();
      const fo = makeF(BOTH_TWILIO_PRIMARY, { status: 400 });
      await fo.flow.dispatch();
      expect(fo.log).toEqual(['360dialog']);

      await prisma.appointment.update({ where: { id: apptId }, data: { reminderStatus: 'sent_2h', followupSentAt: null } });
      const log: string[] = [];
      const amb = makeF(BOTH_TWILIO_PRIMARY, 'timeout', 'ok', 0, log);
      await amb.flow.dispatch();
      expect(amb.wa.sendFollowup).not.toHaveBeenCalled();
      expect((await appt()).reminderStatus).toBe('sent_2h');                       // released
      await makeF(BOTH_TWILIO_PRIMARY, 'ok', 'ok', 0, log).flow.dispatch();
      expect(log).toEqual(['twilio']);
    });
    it('Twilio template delivered but the rating prompt fails → counted as delivered, template never re-sent', async () => {
      await makeEligible();
      const t = makeF(BOTH_TWILIO_PRIMARY);
      t.sender.sendButtons.mockRejectedValue(new Error('buttons down'));
      await t.flow.dispatch();
      await t.flow.dispatch();
      expect(t.sender.sendTemplate).toHaveBeenCalledTimes(1);
      expect((await appt()).reminderStatus).toBe('sent_followup');
    });
    it('an ambiguous outcome pins the follow-up too: Twilio rejects → 360Dialog ambiguous → retry stays on 360Dialog', async () => {
      await makeEligible();
      const log: string[] = [];
      await makeF(BOTH_TWILIO_PRIMARY, { status: 400 }, 'timeout', 0, log).flow.dispatch();
      expect((await appt()).reminderStatus).toBe('sent_2h');                       // released
      const retry = makeF(BOTH_TWILIO_PRIMARY, 'ok', 'ok', 0, log);
      await retry.flow.dispatch();
      expect(retry.sender.sendTemplate).not.toHaveBeenCalled();
      expect(log).toEqual(['360dialog']);
      expect((await appt()).reminderStatus).toBe('sent_followup');
    });
    it('CONCURRENCY: 4 instances → exactly one follow-up', async () => {
      await makeEligible();
      const log: string[] = [];
      await Promise.all(Array.from({ length: 4 }, () => makeF(BOTH_TWILIO_PRIMARY, 'ok', 'ok', 120, log).flow.dispatch()));
      expect(log).toHaveLength(1);
    });
  });

  // ───────────────────────── 2h reminder (event → 360Dialog only) ─────────────────────────
  describe('RemindersService (2h reminder only)', () => {
    // The 2h window is [now, now+2h) within today. Pin the clock (Date ONLY — real timers keep Prisma working) so the
    // tests are deterministic at any hour, including the late-evening wrap that made them time-dependent.
    const it2h = it;
    const FIXED_NOW = new Date('2031-06-15T10:00:00');
    const REAL_ONLY_DATE = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] as const;
    beforeEach(() => { jest.useFakeTimers({ now: FIXED_NOW, doNotFake: [...REAL_ONLY_DATE] }); });
    afterEach(() => { jest.useRealTimers(); });
    const soon = () => dayjs(FIXED_NOW).add(20, 'minute');
    const make = () => { const emitter = new EventEmitter2(); return { emitter, svc: new RemindersService(prisma as any, emitter) }; };
    const eligible2h = (over: any = {}) => prisma.appointment.update({ where: { id: apptId }, data: {
      appointmentDate: new Date(dayjs(FIXED_NOW).format('YYYY-MM-DD')), startTime: soon().format('HH:mm:ss'), endTime: soon().add(30, 'minute').format('HH:mm:ss'),
      reminderStatus: 'sent_24h', ...over,
    } });

    it2h('delivers once and not again on the next tick', async () => {
      await eligible2h();
      const { emitter, svc } = make();
      const delivered = jest.fn();
      emitter.on('appointment.reminder_2h', async () => { delivered(); });
      await svc.dispatch(); await svc.dispatch();
      expect(delivered).toHaveBeenCalledTimes(1);
      expect((await appt()).reminderStatus).toBe('sent_2h');
    });
    it2h('a failed delivery is not lost: stays sent_24h, claim released, next tick retries to success', async () => {
      await eligible2h();
      const { emitter, svc } = make();
      let calls = 0;
      emitter.on('appointment.reminder_2h', async () => { if (++calls === 1) throw new Error('provider down'); });
      await svc.dispatch();
      expect((await appt()).reminderStatus).toBe('sent_24h');
      expect((await appt()).reminder2hAt).toBeNull();
      await svc.dispatch();
      expect(calls).toBe(2);
      expect((await appt()).reminderStatus).toBe('sent_2h');
    });
    it2h('two instances ticking together send exactly one', async () => {
      await eligible2h();
      const a = make(), b = make();
      const delivered = jest.fn();
      const slow = async () => { delivered(); await new Promise((r) => setTimeout(r, 150)); };
      a.emitter.on('appointment.reminder_2h', slow); b.emitter.on('appointment.reminder_2h', slow);
      await Promise.all([a.svc.dispatch(), b.svc.dispatch(), a.svc.dispatch()]);
      expect(delivered).toHaveBeenCalledTimes(1);
    });
    it2h('a CANCELLED / completed / no-show appointment gets no 2h reminder', async () => {
      for (const status of ['cancelled', 'completed', 'no_show']) {
        await eligible2h({ status, reminderStatus: 'sent_24h' });
        const { emitter, svc } = make();
        const delivered = jest.fn();
        emitter.on('appointment.reminder_2h', async () => { delivered(); });
        await svc.dispatch();
        expect(delivered).not.toHaveBeenCalled();
      }
    });
    it('no longer sends 24h reminders or follow-ups (owned by ReminderFlow / FollowupFlow)', async () => {
      const { emitter, svc } = make();
      const seen = jest.fn();
      emitter.on('appointment.reminder_24h', seen); emitter.on('appointment.followup', seen);
      await svc.dispatch();
      expect(seen).not.toHaveBeenCalled();
      expect((await appt()).reminderStatus).toBe('pending');
    });
  });

  // ───────────────────────── 2h reminder: midnight boundaries + real listener wiring ─────────────────────────
  describe('2h reminder window across midnight (real queries, pinned clock)', () => {
    const ONLY_DATE = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] as const;
    const clock = (iso: string) => jest.useFakeTimers({ now: new Date(iso), doNotFake: [...ONLY_DATE] });
    afterEach(() => { jest.useRealTimers(); });

    /** Create a 'sent_24h' appointment on `date` at `time` and tick the scheduler; return how many 2h events fired. */
    async function fires(nowIso: string, cases: { date: string; time: string; status?: string; patient?: string }[]) {
      await prisma.appointment.deleteMany({ where: { clinicId } });
      const ids: string[] = [];
      for (const c of cases) {
        ids.push(await mkAppt({
          appointmentDate: new Date(c.date), startTime: c.time, endTime: c.time,
          status: c.status ?? 'scheduled', reminderStatus: 'sent_24h', patientId: c.patient ?? patientId,
        }));
      }
      clock(nowIso);
      const emitter = new EventEmitter2();
      const delivered: string[] = [];
      emitter.on('appointment.reminder_2h', async ({ appointment }: any) => { delivered.push(appointment.id); });
      await new RemindersService(prisma as any, emitter).dispatch();
      return { ids, delivered };
    }
    const NOW = '2031-06-15T23:30:00';
    const D0 = '2031-06-15', D1 = '2031-06-16';

    it('now=23:30: an appointment at 23:45 TODAY is reminded (this was silently skipped by the old string compare)', async () => {
      const r = await fires(NOW, [{ date: D0, time: '23:45:00' }]);
      expect(r.delivered).toEqual(r.ids);
    });
    it('now=23:30: 00:30 TOMORROW (across midnight) is reminded', async () => {
      const r = await fires(NOW, [{ date: D1, time: '00:30:00' }]);
      expect(r.delivered).toEqual(r.ids);
    });
    it('now=23:30 boundaries: 01:30:00 tomorrow IN, 01:31:00 tomorrow OUT; 23:30:00 today IN, 23:29:00 today OUT', async () => {
      const r = await fires(NOW, [
        { date: D1, time: '01:30:00' }, { date: D1, time: '01:31:00' }, { date: D0, time: '23:30:00' }, { date: D0, time: '23:29:00' },
      ]);
      expect(r.delivered.sort()).toEqual([r.ids[0], r.ids[2]].sort());
    });
    it('now=23:30: earlier-today (01:00) and later-tomorrow (10:00) appointments are NOT reminded', async () => {
      const r = await fires(NOW, [{ date: D0, time: '01:00:00' }, { date: D1, time: '10:00:00' }]);
      expect(r.delivered).toEqual([]);
    });
    it.each(['cancelled', 'completed', 'no_show'])('a %s appointment is never reminded — before midnight (23:45) or after (00:30)', async (status) => {
      const r = await fires(NOW, [{ date: D0, time: '23:45:00', status }, { date: D1, time: '00:30:00', status }]);
      expect(r.delivered).toEqual([]);
    });
    it('a cancelled appointment does not block a scheduled one at the same instant', async () => {
      const r = await fires(NOW, [{ date: D1, time: '00:30:00', status: 'cancelled' }, { date: D1, time: '00:30:00', status: 'scheduled' }]);
      expect(r.delivered).toEqual([r.ids[1]]);
    });
    it('both sides of midnight in one tick: each appointment is delivered exactly once across repeated ticks', async () => {
      const r = await fires(NOW, [{ date: D0, time: '23:50:00' }, { date: D1, time: '00:20:00' }]);
      expect(r.delivered.sort()).toEqual([...r.ids].sort());
      const emitter = new EventEmitter2(); const again: string[] = [];
      emitter.on('appointment.reminder_2h', async ({ appointment }: any) => { again.push(appointment.id); });
      await new RemindersService(prisma as any, emitter).dispatch();
      expect(again).toEqual([]);                                    // already sent_2h
    });
    it('year boundary: now=2031-12-31 23:45 reminds an appointment at 2032-01-01 00:30', async () => {
      const r = await fires('2031-12-31T23:45:00', [{ date: '2032-01-01', time: '00:30:00' }, { date: '2032-01-01', time: '02:00:00' }]);
      expect(r.delivered).toEqual([r.ids[0]]);
    });
    it('opted-out patient is not reminded even inside the window', async () => {
      const r = await fires(NOW, [{ date: D0, time: '23:45:00', patient: optedOutId }]);
      expect(r.delivered).toEqual([]);
    });

    it('REGRESSION: the event payload carries waOptIn, so the real 360Dialog listener actually sends (it used to silently skip)', async () => {
      await prisma.appointment.deleteMany({ where: { clinicId } });
      await mkAppt({ appointmentDate: new Date(D0), startTime: '23:45:00', endTime: '23:59:00', reminderStatus: 'sent_24h' });
      clock(NOW);
      const emitter = new EventEmitter2();
      const wa = new WhatsappService({} as any, { get: () => undefined } as any);
      const send = jest.spyOn(wa, 'sendTemplate').mockResolvedValue({ status: 'sent' } as any);
      emitter.on('appointment.reminder_2h', (p: any) => wa.onReminder2h(p));
      await new RemindersService(prisma as any, emitter).dispatch();
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][1]).toBe('+910000000020');          // the opted-in patient's phone
    });
  });

  // ───────────────────────── consent (waOptIn) ─────────────────────────
  describe('consent: nothing is sent without waOptIn (real queries)', () => {
    const idle = () => {
      const sender: any = { fromNumber: '+1', sendTemplate: jest.fn(async () => undefined), sendButtons: jest.fn(async () => undefined) };
      const wa: any = { sendReminder24h: jest.fn(async () => ({ status: 'sent' })), sendFollowup: jest.fn(async () => ({ status: 'sent' })) };
      const policy = new WhatsappProviderPolicy({ get: (k: string) => (BOTH_TWILIO_PRIMARY as any)[k] } as any);
      return { sender, wa, reminder: new ReminderFlow(prisma as any, sender, policy, wa),
               followup: new FollowupFlow(prisma as any, sender, { startFlow: jest.fn(), patchData: jest.fn() } as any, policy, wa) };
    };
    const sentAnything = (t: ReturnType<typeof idle>) =>
      t.sender.sendTemplate.mock.calls.length + t.sender.sendButtons.mock.calls.length + t.wa.sendReminder24h.mock.calls.length + t.wa.sendFollowup.mock.calls.length;

    it('24h reminder: opted-out patient and patient without a phone get nothing; the opted-in control does', async () => {
      await prisma.appointment.deleteMany({ where: { clinicId } });
      await mkAppt({ patientId: optedOutId });
      await mkAppt({ patientId: noPhoneId });
      const none = idle();
      await none.reminder.dispatch24h();
      expect(sentAnything(none)).toBe(0);

      await mkAppt({ patientId });                                                   // positive control: the test CAN send
      const some = idle();
      await some.reminder.dispatch24h();
      expect(some.sender.sendTemplate).toHaveBeenCalledTimes(1);
    });
    it('follow-up: opted-out patient gets nothing; opted-in control does', async () => {
      await prisma.appointment.deleteMany({ where: { clinicId } });
      const e = dayjs().subtract(30, 'hour');
      const ended = { appointmentDate: new Date(e.format('YYYY-MM-DD')), startTime: e.subtract(30, 'minute').format('HH:mm:ss'), endTime: e.format('HH:mm:ss') };
      await mkAppt({ patientId: optedOutId, status: 'completed', reminderStatus: 'sent_2h', ...ended });
      const none = idle();
      await none.followup.dispatch();
      expect(sentAnything(none)).toBe(0);
      await mkAppt({ patientId, status: 'completed', reminderStatus: 'sent_2h', ...ended });
      const some = idle();
      await some.followup.dispatch();
      expect(some.sender.sendTemplate).toHaveBeenCalledTimes(1);
    });
    it('48h reminder: opted-out gets nothing; opted-in control does', async () => {
      await prisma.appointment.deleteMany({ where: { clinicId } });
      const start = dayjs().add(48, 'hour').add(10, 'minute');            // inside this run\'s [now+48h, now+48h+30m) window
      const when = { appointmentDate: new Date(start.format('YYYY-MM-DD')), startTime: start.format('HH:mm:ss'), endTime: start.add(30, 'minute').format('HH:mm:ss') };
      await mkAppt({ patientId: optedOutId, ...when });
      const none = idle();
      await none.reminder.dispatch48h();
      expect(sentAnything(none)).toBe(0);
      await mkAppt({ patientId, ...when });
      const some = idle();
      await some.reminder.dispatch48h();
      expect(some.sender.sendTemplate).toHaveBeenCalledTimes(1);
    });
    it('broadcast (marketing) audience excludes opted-out patients for every segment', async () => {
      const svc = new BroadcastService(prisma as any, {} as any);
      const all: any[] = await (svc as any).resolveAudience(clinicId, { targetSegment: 'all' });
      expect(all.map((p) => p.id)).toContain(patientId);
      expect(all.map((p) => p.id)).not.toContain(optedOutId);
      const custom: any[] = await (svc as any).resolveAudience(clinicId, { targetSegment: 'custom_ids', patientIds: [patientId, optedOutId] });
      expect(custom.map((p) => p.id)).toEqual([patientId]);                           // an explicit id list cannot bypass consent
      const inactive: any[] = await (svc as any).resolveAudience(clinicId, { targetSegment: 'inactive_90d' });
      expect(inactive.map((p) => p.id)).not.toContain(optedOutId);
    });
  });
});
