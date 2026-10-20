import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WebhookHandler } from './webhook/webhook.handler';
import { WhatsappProviderPolicy } from './whatsapp-provider.policy';
import { ReminderAmbiguityBinder } from './ambiguity.binder';
import { WhatsappSessionService } from './session/whatsapp-session.service';
import { TwilioSenderService } from './templates/twilio-sender.service';
import { BookingFlow } from './flows/booking.flow';
import { PublicBookingService } from './public-booking.service';
import { RescheduleFlow } from './flows/reschedule.flow';
import { ReminderFlow } from './flows/reminder.flow';
import { FollowupFlow } from './flows/followup.flow';
import { BroadcastService } from './broadcast/broadcast.service';
import { BroadcastController } from './broadcast/broadcast.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),  // required for @Cron() in ReminderFlow + FollowupFlow
  ],
  controllers: [
    WhatsappController,
    BroadcastController,
  ],
  providers: [
    // Core
    WhatsappService,
    WhatsappProviderPolicy,   // routes messages both providers could send (see file header)
    ReminderAmbiguityBinder,  // Redis-backed 'ambiguous outcome → stay on that provider' memory
    TwilioSenderService,
    WhatsappSessionService,

    // Webhook router
    WebhookHandler,

    // Conversation flows
    BookingFlow,
    PublicBookingService,
    RescheduleFlow,
    ReminderFlow,
    FollowupFlow,

    // Campaigns
    BroadcastService,
  ],
  exports: [
    WhatsappService,
    TwilioSenderService,
    ReminderFlow,
  ],
})
export class WhatsappModule {}
