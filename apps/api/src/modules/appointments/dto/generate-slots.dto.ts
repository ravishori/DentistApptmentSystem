import {
  IsUUID, IsDateString, IsString, IsInt, IsOptional,
  Matches, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateSlotsDto {
  @ApiProperty()
  @IsUUID()
  dentistId: string;

  @ApiProperty({ example: '2024-11-15' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  workStart: string;

  @ApiProperty({ example: '18:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  workEnd: string;

  @ApiProperty({ example: 30, description: 'Slot duration in minutes' })
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(120)
  slotDuration: number;

  @ApiPropertyOptional({ example: '13:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  @IsOptional()
  breakStart?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  @IsOptional()
  breakEnd?: string;
}

export class BlockSlotDto {
  @ApiProperty()
  @IsUUID()
  slotId: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  reason?: string;
}
