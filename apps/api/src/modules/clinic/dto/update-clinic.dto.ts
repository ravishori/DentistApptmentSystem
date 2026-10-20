import {
  IsString, IsOptional, IsEmail, IsUrl, IsObject, ValidateNested,
  IsArray, IsInt, Min, Max, Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

class WorkingHoursDto {
  @ApiPropertyOptional({ example: '09:00' })
  @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) @IsOptional()
  open?: string;

  @ApiPropertyOptional({ example: '18:00' })
  @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) @IsOptional()
  close?: string;

  @ApiPropertyOptional()
  @IsArray() @IsOptional()
  offDays?: number[];
}

export class UpdateClinicDto {
  @ApiPropertyOptional()
  @IsString() @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  address?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  city?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  state?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  pincode?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsEmail() @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsUrl() @IsOptional()
  website?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional()
  timezone?: string;

  @ApiPropertyOptional()
  @IsObject() @ValidateNested() @Type(() => WorkingHoursDto) @IsOptional()
  workingHours?: WorkingHoursDto;

  @ApiPropertyOptional({ description: '360Dialog channel API key' })
  @IsString() @IsOptional()
  waApiKey?: string;

  @ApiPropertyOptional({ description: 'Default slot duration in minutes' })
  @IsInt() @Min(10) @Max(120) @IsOptional()
  defaultSlotDuration?: number;
}
