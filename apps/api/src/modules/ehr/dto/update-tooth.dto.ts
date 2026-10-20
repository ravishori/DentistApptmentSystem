import {
  IsEnum, IsOptional, IsString, IsArray, IsNumber, Min, Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ToothCondition {
  HEALTHY    = 'healthy',
  DECAYED    = 'decayed',
  FILLED     = 'filled',
  MISSING    = 'missing',
  CROWN      = 'crown',
  IMPLANT    = 'implant',
  ROOT_CANAL = 'root_canal',
  BRIDGE     = 'bridge',
  FRACTURED  = 'fractured',
  EXTRACTED  = 'extracted',
  UNERUPTED  = 'unerupted',
  IMPACTED   = 'impacted',
  WATCH      = 'watch',
  VENEER     = 'veneer',
}

export enum ToothSurface {
  MESIAL   = 'mesial',
  DISTAL   = 'distal',
  BUCCAL   = 'buccal',
  LINGUAL  = 'lingual',
  OCCLUSAL = 'occlusal',
  INCISAL  = 'incisal',
}

export class UpdateToothDto {
  @ApiProperty({ enum: ToothCondition })
  @IsEnum(ToothCondition)
  condition!: ToothCondition;

  @ApiPropertyOptional({ type: [String], enum: ToothSurface })
  @IsOptional() @IsArray() @IsEnum(ToothSurface, { each: true })
  affectedSurfaces?: ToothSurface[];

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  treatmentNote?: string;
}

export class BulkUpdateToothDto {
  @ApiProperty({ type: [Number], description: 'FDI tooth numbers 11–48' })
  @IsArray() @IsNumber({}, { each: true }) @Min(11, { each: true }) @Max(48, { each: true })
  fdiNumbers!: number[];

  @ApiProperty({ enum: ToothCondition })
  @IsEnum(ToothCondition)
  condition!: ToothCondition;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  notes?: string;
}
