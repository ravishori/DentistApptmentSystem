import {
  IsUUID, IsDateString, IsString, IsEnum, IsOptional,
  IsNumber, Min, Max, Matches, MaxLength, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentType } from '@prisma/client';

export class BookAppointmentDto {
  @ApiProperty({ description: 'Patient UUID' })
  @IsUUID()
  patientId: string;

  @ApiProperty({ description: 'Dentist user UUID' })
  @IsUUID()
  dentistId: string;

  @ApiProperty({ example: '2024-11-15' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '10:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:MM' })
  startTime: string;

  @ApiProperty({ enum: AppointmentType })
  @IsEnum(AppointmentType)
  type: AppointmentType;

  @ApiPropertyOptional({ example: 'Toothache upper right molar' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  chiefComplaint?: string;

  @ApiPropertyOptional({ example: 5000 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedCost?: number;

  @ApiPropertyOptional({ enum: ['web', 'whatsapp', 'phone', 'walkin'], default: 'web' })
  @IsIn(['web', 'whatsapp', 'phone', 'walkin'])
  @IsOptional()
  bookedVia?: string;
}
