import { Prisma, ReminderStatus } from '@prisma/client';

/**
 * Atomic claim → deliver → confirm/release protocol shared by BOTH reminder schedulers
 * (RemindersService in the appointments module and ReminderFlow/FollowupFlow in the WhatsApp module).
 *
 * Why: both read "pending" rows, sent, and only then updated the status. Overlapping ticks, two API
 * instances, or the two schedulers themselves could all send the same reminder; and RemindersService
 * marked a reminder as sent even when delivery failed, so it was silently lost.
 *
 * How (no schema change — it reuses the existing per-step timestamp columns as a lease):
 *   claim    UPDATE … SET <col> = now WHERE id = ? AND reminder_status IN (from) AND (<col> IS NULL OR <col> < now - lease)
 *            Exactly one caller can win (row-level atomic). Everyone else gets count = 0 and skips.
 *   confirm  after SUCCESSFUL delivery:  reminder_status = to, <col> = now           (terminal for this step)
 *   release  after FAILED delivery:      <col> = NULL while status is unchanged       (next tick retries)
 *   lease    a claim whose process died mid-send expires after LEASE_MS and can be re-claimed.
 *
 * Retries are naturally bounded by each scheduler's own selection window (the appointment date / time
 * window), so a permanently failing reminder stops being attempted once the window passes.
 */
export type ReminderStep = '24h' | '2h' | 'followup';

const STEP: Record<ReminderStep, { col: 'reminder24hAt' | 'reminder2hAt' | 'followupSentAt'; from: ReminderStatus[]; to: ReminderStatus }> = {
  '24h':      { col: 'reminder24hAt',  from: ['pending'],                to: 'sent_24h' },
  '2h':       { col: 'reminder2hAt',   from: ['sent_24h'],               to: 'sent_2h' },
  // FollowupFlow historically also followed up appointments whose reminders never advanced past sent_24h/pending
  followup:   { col: 'followupSentAt', from: ['sent_2h', 'sent_24h', 'pending'], to: 'sent_followup' },
};

/** A claim older than this is considered abandoned (process crashed mid-send) and may be taken over. */
export const LEASE_MS = 10 * 60 * 1000;

type Db = Pick<Prisma.TransactionClient, 'appointment'>;

export async function claimReminder(db: Db, appointmentId: string, step: ReminderStep, now = new Date()): Promise<boolean> {
  const { col, from } = STEP[step];
  const leaseExpiry = new Date(now.getTime() - LEASE_MS);
  const res = await db.appointment.updateMany({
    where: {
      id: appointmentId,
      reminderStatus: { in: from },
      OR: [{ [col]: null }, { [col]: { lt: leaseExpiry } }],
    },
    data: { [col]: now },
  });
  return res.count === 1;
}

export async function confirmReminder(db: Db, appointmentId: string, step: ReminderStep, now = new Date()): Promise<void> {
  const { col, from, to } = STEP[step];
  await db.appointment.updateMany({
    where: { id: appointmentId, reminderStatus: { in: from } },
    data: { reminderStatus: to, [col]: now },
  });
}

export async function releaseReminder(db: Db, appointmentId: string, step: ReminderStep): Promise<void> {
  const { col, from } = STEP[step];
  await db.appointment.updateMany({
    where: { id: appointmentId, reminderStatus: { in: from } },
    data: { [col]: null },
  });
}
