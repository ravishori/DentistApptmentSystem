import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NOTIFICATION_QUEUE, NotificationJob } from '../notifications.service';
import { errText } from '../../../common/observability/redaction';

@Processor(NOTIFICATION_QUEUE)
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  @Process()
  async handle(job: Job<NotificationJob>) {
    const { clinicId, userId, type, title, body, data } = job.data;
    this.logger.debug(`Processing notification: ${type} → ${userId ?? 'clinic-wide'}`);

    try {
      if (userId) {
        // Targeted notification
        // In-app staff notifications use the 'push' channel of the Notification model
        await this.prisma.notification.create({
          data: {
            clinicId, userId, type, subject: title, body, params: data ?? {},
            channel: NotificationChannel.push, status: NotificationStatus.sent, sentAt: new Date(),
          },
        });
      } else {
        // Broadcast to all active staff in clinic
        const staff = await this.prisma.user.findMany({
          where:  { clinicId, isActive: true },
          select: { id: true },
        });

        await this.prisma.notification.createMany({
          data: staff.map((u) => ({
            clinicId, userId: u.id, type, subject: title, body, params: data ?? {},
            channel: NotificationChannel.push, status: NotificationStatus.sent, sentAt: new Date(),
          })),
        });
      }
    } catch (err) {
      this.logger.error(`Notification job failed: ${errText(err)}`);
      throw err;
    }
  }
}
