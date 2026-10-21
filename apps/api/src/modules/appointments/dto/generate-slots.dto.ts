import {
  IsUUID, IsDateString, IsString, IsInt, IsOptional,
  Matches, Min, Max, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { KeepRaw } from '../../../common/validators/keep-raw';
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

/** Request body of PATCH /appointments/slots/:slotId/block (the slot id comes from the path). */
export class BlockSlotBodyDto {
  @ApiPropertyOptional({ example: 'Dentist on leave', maxLength: 200 })
  @KeepRaw()   // a JSON number/object must be rejected, not coerced to "123" / "[object Object]" and stored
  @IsString()
  @MaxLength(200)
  @IsOptional()
  reason?: string;
}
