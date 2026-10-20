import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { SlotsService } from './slots.service';
import { RemindersService } from './reminders.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, SlotsService, RemindersService],
  exports: [AppointmentsService, SlotsService],
})
export class AppointmentsModule {}
