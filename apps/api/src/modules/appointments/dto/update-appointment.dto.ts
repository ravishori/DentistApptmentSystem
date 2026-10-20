import {
  IsEnum, IsString, IsOptional, IsUUID, IsDateString, Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus } from '@prisma/client';

export class UpdateAppointmentStatusDto {
  @ApiPropertyOptional({ enum: AppointmentStatus })
  @IsEnum(AppointmentStatus)
  status: AppointmentStatus;

  @ApiPropertyOptional({ example: 'Patient requested cancellation' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  clinicalNotes?: string;
}

export class RescheduleAppointmentDto {
  @ApiPropertyOptional({ example: '2024-11-20' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ example: '14:30' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:MM' })
  startTime: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  reason?: string;
}
