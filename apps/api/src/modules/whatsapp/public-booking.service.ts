import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { BookingFlow } from './flows/booking.flow';
import { errText } from '../../common/observability/redaction';

export const START_BOOKING_COOLDOWN_SECONDS = 600;
const INBOUND_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Both spellings a phone may be stored in (with and without the leading '+'). */
export function phoneVariants(e164: string): string[] {
  return [e164, e164.replace(/^\+/, '')];
}

/**
 * Public (unauthenticated) entry for `POST /whatsapp/start-booking`.
 *
 * The endpoint makes the clinic's WhatsApp number message an arbitrary phone, so a message is sent ONLY when:
 *   - the clinic exists and is active, and
 *   - nobody with that phone in THAT clinic has opted out (an explicit opt-out always wins), and
 *   - the phone belongs to an opted-in patient of this clinic, OR the phone itself messaged this clinic in the
 *     last 24 h (patient-initiated click-to-chat), and
 *   - the phone has not been started for this clinic in the last 10 minutes.
 * The HTTP answer is identical in every case so the endpoint cannot be used to discover patients or opt-out state.
 */
@Injectable()
export class PublicBookingService {
  private readonly logger = new Logger(PublicBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly bookingFlow: BookingFlow,
  ) {}

  async start(clinicId: string, phone: string): Promise<{ accepted: true }> {
    try {
      if (await this.mayStart(clinicId, phone)) await this.bookingFlow.start(phone, clinicId);
    } catch (err) {
      this.logger.warn(`start-booking failed: ${errText(err)}`);   // never leak internals to an anonymous caller
    }
    return { accepted: true };
  }

  private async mayStart(clinicId: string, phone: string): Promise<boolean> {
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId }, select: { isActive: true, subStatus: true } });
    if (!clinic?.isActive || clinic.subStatus === 'cancelled') return false;

    const variants = phoneVariants(phone);
    const patients = await this.prisma.patient.findMany({ where: { clinicId, phone: { in: variants } }, select: { waOptIn: true } });
    if (patients.some((p) => !p.waOptIn)) return false;

    if (!patients.length) {
      const inbound = await this.prisma.whatsappMessage.findFirst({
        where: {
          clinicId, direction: 'inbound', createdAt: { gte: new Date(Date.now() - INBOUND_WINDOW_MS) },
          conversation: { patientPhone: { in: variants } },
        },
        select: { id: true },
      });
      if (!inbound) return false;
    }

    const key = `wa:start-booking:${clinicId}:${phone}`;
    if (await this.cache.get(key)) return false;
    await this.cache.set(key, 1, START_BOOKING_COOLDOWN_SECONDS);
    return true;
  }
}
