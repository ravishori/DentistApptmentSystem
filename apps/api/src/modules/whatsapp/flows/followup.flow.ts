import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { TwilioSenderService } from '../templates/twilio-sender.service';
import { WhatsappSessionService, WaSession } from '../session/whatsapp-session.service';
import { TemplateBuilder } from '../templates/template-builder';
import dayjs from 'dayjs';
import { claimReminder, confirmReminder, releaseReminder } from '../../appointments/reminder-claim';
import { WhatsappProviderPolicy } from '../whatsapp-provider.policy';
import { WhatsappService } from '../whatsapp.service';
import { deliverWithFailover, orderFor, rememberIfAmbiguous, ambiguityKey, DeliveryError } from '../reminder-delivery';
import { errText } from '../../../common/observability/redaction';

/**
 * FOLLOW-UP FLOW
 *
 * Triggered 24h after appointment completion via cron.
 *
 * Message sequence:
 *   1. "How was your experience?" → star rating buttons (1–5)
 *   2. If rating ≤ 3 → "Tell us more?" → free-text feedback
 *   3. If rating ≥ 4 → "Would you like to book your next visit?"
 *      → Yes → kick into BookingFlow
 *      → No  → Thank you message
 *
 * Rating and feedback are stored in WhatsApp message metadata.
 */

@Injectable()
export class FollowupFlow {
  private readonly logger = new Logger(FollowupFlow.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly sender:   TwilioSenderService,
    private readonly sessions: WhatsappSessionService,
    @Optional() private readonly policy?: WhatsappProviderPolicy,
    @Optional() private readonly whatsapp?: WhatsappService,
  ) {}

  // ── Cron: dispatch follow-ups ─────────────────────────────────────────────
  // Runs every hour. Finds appointments completed 24h ago that haven't had a follow-up.

  @Cron('0 0 * * * *', { name: 'followup-dispatch' })
  async dispatch(): Promise<void> {
    // Eligibility is based on the appointment's SCHEDULED END, not on updated_at. updated_at is bumped by ANY write
    // (the schema.sql trigger fires on every UPDATE, including this flow's own claim/release), so it would silently push
    // a failed follow-up out of the 24–48h window and the retry would never happen.
    const threshold = dayjs().subtract(24, 'hour');
    const cutoff    = dayjs().subtract(48, 'hour');   // don't chase beyond 48h

    const candidates = await this.prisma.appointment.findMany({
      where: {
        status:         'completed',
        // sent_2h included: RemindersService no longer sends follow-ups, this flow owns them for every status
        reminderStatus: { in: ['sent_2h', 'sent_24h', 'pending'] },
        appointmentDate: { gte: new Date(cutoff.format('YYYY-MM-DD')), lte: new Date(threshold.format('YYYY-MM-DD')) },
        patient:        { waOptIn: true },
      },
      include: {
        patient: { select: { fullName: true, phone: true } },
        dentist: { select: { fullName: true } },
        clinic:  { select: { id: true, name: true } },
      },
    });
    const completed = candidates.filter((a) => {
      const end = dayjs(`${dayjs(a.appointmentDate).format('YYYY-MM-DD')} ${a.endTime}`);
      return !end.isBefore(cutoff) && !end.isAfter(threshold);
    });

    this.logger.log(`Follow-up batch: ${completed.length} appointments`);

    for (const appt of completed) {
      const phone = appt.patient.phone;
      if (!phone) continue;

      // Atomic claim (shared protocol): a follow-up is delivered once across schedulers / instances
      if (!(await claimReminder(this.prisma, appt.id, 'followup'))) continue;

      // Twilio: template (must succeed) → rating buttons + reply session (best effort: a failure here must not
      // cause the template to be sent again)
      const viaTwilio = async () => {
        await this.sender.sendTemplate(
          TemplateBuilder.followup({
            patientName: appt.patient.fullName,
            clinicName:  appt.clinic.name,
            dentistName: appt.dentist.fullName,
            to:          phone,
            from:        this.sender.fromNumber,
          }),
        );
        try {
          await this.sender.sendButtons(
            phone,
            TemplateBuilder.buttons(
              '⭐ Please rate your experience:\n(Reply with a number or tap a button)',
              [
                { id: 'RATE_5', title: '⭐⭐⭐⭐⭐ Excellent' },
                { id: 'RATE_4', title: '⭐⭐⭐⭐   Good'      },
                { id: 'RATE_3', title: '⭐⭐⭐     Average'   },
              ],
            ),
          );
          await this.sender.sendButtons(
            phone,
            TemplateBuilder.buttons('(continued)', [
              { id: 'RATE_2', title: '⭐⭐       Poor'      },
              { id: 'RATE_1', title: '⭐         Very Poor' },
            ]),
          );
          await this.sessions.startFlow(phone, appt.clinic.id, 'FOLLOWUP', 'AWAIT_RATING');
          await this.sessions.patchData(phone, { appointmentId: appt.id, patientName: appt.patient.fullName });
        } catch (err) {
          this.logger.warn(`Follow-up rating prompt failed after the template was delivered → appt ${appt.id}: ${errText(err)}`);
        }
      };

      // 360Dialog: template only (no rating session on this path)
      const via360 = async () => {
        const sent = await this.whatsapp!.sendFollowup(appt.clinic.id, phone, {
          patientName: appt.patient.fullName,
          dentistName: appt.dentist.fullName,
          clinicName:  appt.clinic.name,
        });
        if (sent.status === 'failed') {
          throw Object.assign(new Error(sent.failureReason ?? 'WhatsApp delivery failed'), { httpStatus: (sent as { httpStatus?: number }).httpStatus });
        }
      };

      const plan = { twilio: viaTwilio, ...(this.whatsapp ? { '360dialog': via360 } : {}) };
      const key = ambiguityKey('followup', appt.id);
      try {
        const { provider } = await deliverWithFailover(
          await orderFor(this.policy, key, plan),
          plan,
          (from, to) => this.logger.warn(`Follow-up ${from} rejected the message → failing over to ${to} (appt ${appt.id})`),
        );
        await confirmReminder(this.prisma, appt.id, 'followup');
        this.logger.log(`Follow-up sent via ${provider} → appt ${appt.id}`);
      } catch (err) {
        await rememberIfAmbiguous(key, err);   // pin retries to the provider whose outcome is unknown
        await releaseReminder(this.prisma, appt.id, 'followup');   // nothing confirmed delivered → retried next run
        const tried = err instanceof DeliveryError ? err.tried.join(',') : '?';
        this.logger.error(`Follow-up failed (tried: ${tried}) → appt ${appt.id}: ${errText(err)} — will retry`);
      }
    }
  }

  // ── Step router ───────────────────────────────────────────────────────────

  async handle(session: WaSession, incomingText: string, buttonId?: string): Promise<void> {
    const input = (buttonId ?? incomingText).trim().toUpperCase();

    switch (session.step) {
      case 'AWAIT_RATING':  return this.handleRating(session, input);
      case 'AWAIT_FEEDBACK': return this.handleFeedback(session, incomingText);
      case 'AWAIT_REBOOK':  return this.handleRebook(session, input);
    }
  }

  // ── Rating handler ────────────────────────────────────────────────────────

  private async handleRating(session: WaSession, input: string): Promise<void> {
    const ratingMap: Record<string, number> = {
      'RATE_5': 5, 'RATE_4': 4, 'RATE_3': 3, 'RATE_2': 2, 'RATE_1': 1,
      '5': 5, '4': 4, '3': 3, '2': 2, '1': 1,
    };
    const rating = ratingMap[input];

    if (!rating) {
      await this.sender.sendText(session.phone, '❌ Please reply with a number 1–5 to rate your visit.');
      return;
    }

    // Appointment has no rating column yet (migration proposed). Record the event in the
    // application log only (ids, no patient data) instead of failing a write that cannot succeed.
    this.logger.log(`Patient rating ${rating}/5 for appointment ${session.data.appointmentId}`);

    if (rating <= 3) {
      // Negative experience → ask for feedback
      await this.sessions.advanceStep(session.phone, 'AWAIT_FEEDBACK', { rating });
      await this.sender.sendText(
        session.phone,
        `Thank you for the honest feedback 🙏\n\nWe're sorry your experience wasn't perfect. Please tell us what we can improve:`,
      );
    } else {
      // Positive experience → offer rebook
      await this.sessions.advanceStep(session.phone, 'AWAIT_REBOOK', { rating });
      await this.sender.sendButtons(
        session.phone,
        TemplateBuilder.buttons(
          `⭐`.repeat(rating) + ` Thank you, ${session.data.patientName}! We're glad you had a great experience 😊\n\nWould you like to schedule your next visit?`,
          [
            { id: 'REBOOK_YES', title: '📅 Book Next Visit' },
            { id: 'REBOOK_NO',  title: '✅ No Thanks'       },
          ],
        ),
      );
    }
  }

  // ── Feedback handler ──────────────────────────────────────────────────────

  private async handleFeedback(session: WaSession, text: string): Promise<void> {
    // Store the feedback text (free-form)
    const conversation = await this.prisma.whatsappConversation.findFirst({
      where:  { clinicId: session.clinicId, patientPhone: session.phone },
      select: { id: true },
    });
    if (conversation) await this.prisma.whatsappMessage.create({
      data: {
        clinicId:       session.clinicId,
        conversationId: conversation.id,
        direction:      'inbound',
        type:           'text',
        content:        text,
        status:         'read',
        templateName:   `followup_feedback_appt_${session.data.appointmentId}`,
      },
    }).catch(() => {});

    await this.sessions.advanceStep(session.phone, 'AWAIT_REBOOK');

    await this.sender.sendButtons(
      session.phone,
      TemplateBuilder.buttons(
        `Thank you for your feedback — we'll work on improving! 💪\n\nWould you like to book your next appointment?`,
        [
          { id: 'REBOOK_YES', title: '📅 Book an Appointment' },
          { id: 'REBOOK_NO',  title: '✅ No Thanks'           },
        ],
      ),
    );
  }

  // ── Rebook handler ────────────────────────────────────────────────────────

  private async handleRebook(session: WaSession, input: string): Promise<void> {
    if (['REBOOK_YES', 'YES', '1', 'Y', 'BOOK'].includes(input)) {
      // Hand off to the booking flow
      await this.sessions.end(session.phone);
      await this.sender.sendText(
        session.phone,
        `Great! Let's book your next visit 🦷\n\nReply *BOOK* to start.`,
      );
    } else {
      await this.sender.sendText(
        session.phone,
        `No problem! Take care, and we look forward to seeing you again 😊`,
      );
      await this.sessions.end(session.phone);
    }
  }
}
