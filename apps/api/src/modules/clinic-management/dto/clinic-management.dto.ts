import {
  IsString, IsOptional, IsInt, IsBoolean, IsEnum,
  IsUUID, IsDateString, Min, Max, Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Chair ─────────────────────────────────────────────────────────────────────

export class CreateChairDto {
  @ApiProperty({ example: 'Chair 1' })
  @IsString() name: string;

  @ApiProperty({ example: 1 })
  @IsInt() @Min(1) @Max(99) @Type(() => Number) chairNumber: number;

  @ApiPropertyOptional()
  @IsString() @IsOptional() description?: string;

  @ApiPropertyOptional({ example: '#3B82F6' })
  @IsString() @IsOptional() color?: string;
}

export class UpdateChairDto {
  @ApiPropertyOptional() @IsString() @IsOptional() name?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() color?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isActive?: boolean;
}

// ── DoctorAvailability ────────────────────────────────────────────────────────

export enum DayOfWeek {
  SUNDAY    = 'sunday',
  MONDAY    = 'monday',
  TUESDAY   = 'tuesday',
  WEDNESDAY = 'wednesday',
  THURSDAY  = 'thursday',
  FRIDAY    = 'friday',
  SATURDAY  = 'saturday',
}

export class CreateAvailabilityDto {
  @ApiProperty() @IsUUID() dentistId: string;

  @ApiProperty({ enum: DayOfWeek })
  @IsEnum(DayOfWeek) dayOfWeek: DayOfWeek;

  @ApiProperty({ example: '09:00' })
  @IsString() @Matches(/^\d{2}:\d{2}$/) startTime: string;

  @ApiProperty({ example: '17:00' })
  @IsString() @Matches(/^\d{2}:\d{2}$/) endTime: string;

  @ApiPropertyOptional({ default: 30, description: 'Slot duration in minutes' })
  @IsInt() @Min(10) @Max(120) @IsOptional() @Type(() => Number) slotMins?: number;

  @ApiPropertyOptional()
  @IsDateString() @IsOptional() validFrom?: string;

  @ApiPropertyOptional()
  @IsDateString() @IsOptional() validUntil?: string;
}

export class UpdateAvailabilityDto {
  @ApiPropertyOptional() @IsString() @IsOptional() startTime?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() endTime?: string;
  @ApiPropertyOptional() @IsInt() @Min(10) @Max(120) @IsOptional() slotMins?: number;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isActive?: boolean;
  @ApiPropertyOptional() @IsDateString() @IsOptional() validFrom?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() validUntil?: string;
}

// ── DoctorSchedule (override) ─────────────────────────────────────────────────

export enum ScheduleOverrideType {
  WORKING   = 'working',
  LEAVE     = 'leave',
  HOLIDAY   = 'holiday',
  EMERGENCY = 'emergency',
}

export class CreateScheduleOverrideDto {
  @ApiProperty() @IsUUID() dentistId: string;

  @ApiProperty({ example: '2026-05-10' })
  @IsDateString() date: string;

  @ApiProperty({ enum: ScheduleOverrideType })
  @IsEnum(ScheduleOverrideType) type: ScheduleOverrideType;

  @ApiPropertyOptional() @IsString() @IsOptional() startTime?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() endTime?: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() chairId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() reason?: string;
}

// ── Availability query ────────────────────────────────────────────────────────

export class AvailabilityQueryDto {
  @ApiPropertyOptional() @IsUUID() @IsOptional() dentistId?: string;

  @ApiProperty({ example: '2026-05-06' })
  @IsDateString() from: string;

  @ApiProperty({ example: '2026-05-12' })
  @IsDateString() to: string;
}

// ── Slot generation ───────────────────────────────────────────────────────────

export class GenerateSlotsDto {
  @ApiProperty() @IsUUID() dentistId: string;

  @ApiProperty({ example: '2026-05-06' })
  @IsDateString() from: string;

  @ApiProperty({ example: '2026-05-12' })
  @IsDateString() to: string;

  @ApiPropertyOptional({ description: 'Auto-assign chairs to generated slots' })
  @IsBoolean() @IsOptional() autoAssignChair?: boolean;
}

// ── Book Appointment ──────────────────────────────────────────────────────────

export class BookAppointmentDto {
  @ApiProperty() @IsUUID() dentistId: string;
  @ApiProperty() @IsUUID() patientId: string;

  @ApiProperty({ example: '2026-05-06' })
  @IsDateString() date: string;

  @ApiProperty({ example: '10:00' })
  @IsString() @Matches(/^\d{2}:\d{2}$/) startTime: string;

  @ApiProperty({ example: '10:30' })
  @IsString() @Matches(/^\d{2}:\d{2}$/) endTime: string;

  @ApiPropertyOptional()
  @IsUUID() @IsOptional() chairId?: string;

  @ApiPropertyOptional()
  @IsUUID() @IsOptional() slotId?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional() type?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional() notes?: string;
}
