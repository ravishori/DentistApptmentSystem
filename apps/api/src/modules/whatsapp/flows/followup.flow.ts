import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { TwilioSenderService } from '../templates/twilio-sender.service';
import { WhatsappSessionService, WaSession } from '../session/whatsapp-session.service';
import { TemplateBuilder } from '../templates/template-builder';
import dayjs from 'dayjs';

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
  ) {}

  // ── Cron: dispatch follow-ups ─────────────────────────────────────────────
  // Runs every hour. Finds appointments completed 24h ago that haven't had a follow-up.

  @Cron('0 0 * * * *', { name: 'followup-dispatch' })
  async dispatch(): Promise<void> {
    const threshold = dayjs().subtract(24, 'hour').toDate();
    const cutoff    = dayjs().subtract(48, 'hour').toDate(); // don't chase beyond 48h

    const completed = await this.prisma.appointment.findMany({
      where: {
        status:         'completed',
        reminderStatus: { in: ['sent_24h', 'sent_48h', 'pending'] },
        updatedAt:      { gte: cutoff, lte: threshold },
        patient:        { waOptIn: true },
      },
      include: {
        patient: { select: { fullName: true, phone: true } },
        dentist: { select: { fullName: true } },
        clinic:  { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Follow-up batch: ${completed.length} appointments`);

    for (const appt of completed) {
      if (!appt.patient.phone) continue;

      try {
        // 1. Send template message
        await this.sender.sendTemplate(
          TemplateBuilder.followup({
            patientName: appt.patient.fullName,
            clinicName:  appt.clinic.name,
            dentistName: appt.dentist.fullName,
            to:          appt.patient.phone,
            from:        this.sender.fromNumber,
          }),
        );

        // 2. Send star-rating buttons (5-star = 5 buttons, WA max 3 → use two messages)
        await this.sender.sendButtons(
          appt.patient.phone,
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
          appt.patient.phone,
          TemplateBuilder.buttons(
            '(continued)',
            [
              { id: 'RATE_2', title: '⭐⭐       Poor'      },
              { id: 'RATE_1', title: '⭐         Very Poor' },
            ],
          ),
        );

        // Start a FOLLOWUP session so inbound replies are handled
        const session = await this.sessions.startFlow(
          appt.patient.phone,
          appt.clinic.id,
          'FOLLOWUP',
          'AWAIT_RATING',
        );
        await this.sessions.patchData(appt.patient.phone, {
          appointmentId: appt.id,
          patientName:   appt.patient.fullName,
        });

        await this.prisma.appointment.update({
          where: { id: appt.id },
          data:  { reminderStatus: 'sent_followup', followupSentAt: new Date() },
        });

        this.logger.log(`Follow-up sent → appt ${appt.id}`);
      } catch (err) {
        this.logger.error(`Follow-up failed → appt ${appt.id}: ${(err as Error).message}`);
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

    // Persist rating to appointment
    await this.prisma.appointment.update({
      where: { id: session.data.appointmentId },
      data:  { patientRating: rating },
    }).catch(() => { /* field may not exist yet — non-critical */ });

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
