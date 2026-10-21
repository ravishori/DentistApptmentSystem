import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TwilioSenderService } from '../templates/twilio-sender.service';
import { TemplateBuilder } from '../templates/template-builder';
import dayjs from 'dayjs';

export interface CreateBroadcastDto {
  name:           string;
  message:        string;          // plain-text body for the broadcast template {{2}}
  targetSegment:  'all' | 'inactive_90d' | 'outstanding_balance' | 'custom_ids';
  patientIds?:    string[];        // used when targetSegment = custom_ids
  scheduledAt?:   string;         // ISO date — if omitted, send immediately
}

export interface BroadcastResult {
  broadcastId:   string;
  total:         number;
  sent:          number;
  failed:        number;
  completedAt:   Date;
}

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly sender:  TwilioSenderService,
  ) {}

  // ── Create & send ─────────────────────────────────────────────────────────

  async create(clinicId: string, dto: CreateBroadcastDto): Promise<BroadcastResult> {
    const clinic = await this.prisma.clinic.findUnique({
      where:  { id: clinicId },
      select: { name: true, phone: true },
    });
    if (!clinic) throw new NotFoundException('Clinic not found');

    // Resolve target audience
    const audience = await this.resolveAudience(clinicId, dto);
    // phone is nullable in the schema; recipients without one cannot be messaged
    const patients = audience.flatMap((p) => (p.phone ? [{ ...p, phone: p.phone }] : []));

    if (!patients.length) {
      throw new BadRequestException('No opted-in patients found for this segment');
    }

    this.logger.log(`Broadcast → ${patients.length} recipients in clinic ${clinicId}`);

    // Build per-patient message payloads
    const messages = patients.map((p) =>
      TemplateBuilder.broadcast({
        patientName: p.fullName,
        message:     dto.message,
        phone:       clinic.phone ?? '',
        website:     '',   // Clinic has no website column in schema.prisma
        to:          p.phone,
        from:        this.sender.fromNumber,
      }),
    );

    // Record broadcast job in DB
    // Each message row requires a conversation; get-or-create one per recipient phone
    const conversations = await Promise.all(patients.map((p) =>
      this.prisma.whatsappConversation.upsert({
        where:  { clinicId_patientPhone: { clinicId, patientPhone: p.phone } },
        create: { clinicId, patientPhone: p.phone, patientId: p.id },
        update: {},
        select: { id: true },
      }),
    ));
    await this.prisma.whatsappMessage.createMany({
      data: patients.map((p, i) => ({
        clinicId,
        conversationId: conversations[i].id,
        direction:    'outbound' as const,
        type:         'template' as const,
        content:      dto.message,
        templateName: 'broadcast_offer',
        status:       'queued' as const,
      })),
    });

    // Send with rate limiting
    let sent   = 0;
    let failed = 0;

    const result = await this.sender.sendBulk(messages, (done, total) => {
      if (done % 50 === 0) this.logger.log(`Broadcast progress: ${done}/${total}`);
    });

    sent   = result.sent;
    failed = result.failed;

    this.logger.log(`Broadcast complete — sent: ${sent}, failed: ${failed}`);

    return {
      broadcastId:  `broadcast_${Date.now()}`,
      total:        patients.length,
      sent,
      failed,
      completedAt:  new Date(),
    };
  }

  // ── Audience resolver ─────────────────────────────────────────────────────

  private async resolveAudience(clinicId: string, dto: CreateBroadcastDto) {
    const baseWhere = { clinicId, waOptIn: true, phone: { not: null } };

    switch (dto.targetSegment) {
      case 'all':
        return this.prisma.patient.findMany({
          where:  baseWhere,
          select: { id: true, fullName: true, phone: true },
        });

      case 'inactive_90d': {
        const cutoff = dayjs().subtract(90, 'day').toDate();
        return this.prisma.patient.findMany({
          where:  {
            ...baseWhere,
            OR: [
              { lastVisitDate: { lt: cutoff } },
              { lastVisitDate: null },
            ],
          },
          select: { id: true, fullName: true, phone: true },
        });
      }

      case 'outstanding_balance':
        return this.prisma.patient.findMany({
          where:  { ...baseWhere, outstandingBalance: { gt: 0 } },
          select: { id: true, fullName: true, phone: true },
        });

      case 'custom_ids':
        if (!dto.patientIds?.length) {
          throw new BadRequestException('patientIds required for custom_ids segment');
        }
        return this.prisma.patient.findMany({
          where:  { ...baseWhere, id: { in: dto.patientIds } },
          select: { id: true, fullName: true, phone: true },
        });

      default:
        throw new BadRequestException('Unknown target segment');
    }
  }

  // ── Estimate audience size before sending ─────────────────────────────────

  async estimateAudience(clinicId: string, segment: CreateBroadcastDto['targetSegment'], patientIds?: string[]): Promise<number> {
    return this.resolveAudience(clinicId, {
      name:           'estimate',
      message:        '',
      targetSegment:  segment,
      patientIds,
    }).then((p) => p.length);
  }
}
