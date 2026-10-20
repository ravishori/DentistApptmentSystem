import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../prisma/prisma.service';
import { NOTIFICATION_QUEUE, NotificationJob } from '../notifications.service';

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
        await this.prisma.notification.create({
          data: { clinicId, userId, type, title, body, data: data ?? {}, isRead: false },
        });
      } else {
        // Broadcast to all active staff in clinic
        const staff = await this.prisma.user.findMany({
          where:  { clinicId, isActive: true },
          select: { id: true },
        });

        await this.prisma.notification.createMany({
          data: staff.map((u) => ({
            clinicId, userId: u.id, type, title, body,
            data: data ?? {}, isRead: false,
          })),
        });
      }
    } catch (err) {
      this.logger.error(`Notification job failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
