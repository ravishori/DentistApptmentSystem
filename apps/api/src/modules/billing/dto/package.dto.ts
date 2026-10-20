import {
  IsString, IsOptional, IsNumber, IsInt, IsUUID, IsEnum,
  IsArray, ValidateNested, Min, Max, IsDateString, } from 'class-validator';
import { IsStrictBoolean } from '../../../common/validators/strict-boolean';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PackageItemDto {
  @ApiProperty() @IsString() description: string;
  @ApiProperty() @IsInt() @Min(1) quantity: number;
  @ApiProperty() @IsNumber() @Min(0) unitPrice: number;
  @ApiPropertyOptional() @IsInt() @Min(0) @IsOptional() sortOrder?: number;
}

export class CreateTreatmentPackageDto {
  @ApiProperty({ example: 'RCT + Crown Bundle' })
  @IsString() name: string;

  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;

  @ApiProperty({ example: 3, description: 'Number of visits included' })
  @IsInt() @Min(1) totalVisits: number;

  @ApiProperty({ example: 15000, description: 'Total package price in INR' })
  @IsNumber() @Min(0) totalPrice: number;

  @ApiPropertyOptional({ default: 18 })
  @IsNumber() @Min(0) @Max(28) @IsOptional() taxPercent?: number;

  @ApiProperty({ type: [PackageItemDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => PackageItemDto)
  items: PackageItemDto[];
}

export class UpdateTreatmentPackageDto {
  @ApiPropertyOptional() @IsString() @IsOptional() name?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() totalPrice?: number;
  @ApiPropertyOptional() @IsStrictBoolean() @IsOptional() isActive?: boolean;
}

// ── Installment plan ──────────────────────────────────────────────────────────

export class InstallmentDto {
  @ApiProperty() @IsNumber() @Min(0) amount: number;
  @ApiProperty() @IsDateString() dueDate: string;
}

export class EnrollPatientDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiProperty() @IsUUID() packageId: string;

  @ApiPropertyOptional({ description: 'Number of equal installments; omit for single payment' })
  @IsInt() @Min(1) @Max(24) @IsOptional() installments?: number;

  @ApiPropertyOptional({ description: 'Custom installment schedule (overrides auto-split)' })
  @IsArray() @ValidateNested({ each: true }) @Type(() => InstallmentDto)
  @IsOptional() customSchedule?: InstallmentDto[];

  @ApiPropertyOptional() @IsDateString() @IsOptional() startDate?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;
}

export class MarkVisitCompletedDto {
  @ApiProperty() @IsUUID() enrollmentId: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() visitId?: string;
}
