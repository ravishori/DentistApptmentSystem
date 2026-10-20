import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ReportFormat {
  JSON = 'json',
  CSV  = 'csv',
}

export class ReportQueryDto {
  @ApiProperty({ example: '2026-01-01' }) @IsDateString() from: string;
  @ApiProperty({ example: '2026-01-31' }) @IsDateString() to:   string;
  @ApiPropertyOptional({ enum: ReportFormat, default: ReportFormat.JSON })
  @IsEnum(ReportFormat) @IsOptional() format?: ReportFormat = ReportFormat.JSON;
}
