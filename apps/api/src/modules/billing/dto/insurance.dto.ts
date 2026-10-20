import {
  IsString, IsOptional, IsNumber, IsUUID, IsEnum, IsDateString, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum InsuranceClaimStatus {
  DRAFT       = 'draft',
  SUBMITTED   = 'submitted',
  UNDER_REVIEW = 'under_review',
  APPROVED    = 'approved',
  PARTIALLY_APPROVED = 'partially_approved',
  REJECTED    = 'rejected',
  SETTLED     = 'settled',
}

export class CreateInsuranceClaimDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiProperty() @IsString() insurerName: string;
  @ApiPropertyOptional() @IsString() @IsOptional() policyNumber?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() membershipId?: string;
  @ApiProperty() @IsNumber() @Min(0) claimAmount: number;
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;
}

export class UpdateInsuranceClaimDto {
  @ApiPropertyOptional() @IsString() @IsOptional() claimNumber?: string;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() approvedAmount?: number;
  @ApiPropertyOptional() @IsNumber() @Min(0) @IsOptional() reimbursedAmount?: number;
  @ApiPropertyOptional({ enum: InsuranceClaimStatus })
  @IsEnum(InsuranceClaimStatus) @IsOptional() status?: InsuranceClaimStatus;
  @ApiPropertyOptional() @IsDateString() @IsOptional() submittedAt?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() settledAt?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;
}
