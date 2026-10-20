import { Module } from '@nestjs/common';
import { ClinicManagementController } from './clinic-management.controller';
import { ChairsService } from './chairs.service';
import { DoctorAvailabilityService } from './doctor-availability.service';
import { SchedulingService } from './scheduling.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports:     [PrismaModule],
  controllers: [ClinicManagementController],
  providers:   [ChairsService, DoctorAvailabilityService, SchedulingService],
  exports:     [ChairsService, DoctorAvailabilityService, SchedulingService],
})
export class ClinicManagementModule {}
