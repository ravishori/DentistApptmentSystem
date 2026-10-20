import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsController } from './notifications.controller';
import { NotificationsService, NOTIFICATION_QUEUE } from './notifications.service';
import { NotificationsProcessor } from './processors/notifications.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
  ],
  controllers: [NotificationsController],
  providers:   [NotificationsService, NotificationsProcessor],
  exports:     [NotificationsService],
})
export class NotificationsModule {}
