import {
  IsEnum, IsNumber, IsOptional, IsString, IsDateString, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Methods for recording manual (off-provider) payments against an invoice.
 *
 * `insurance` is intentionally EXCLUDED here. Insurance settlements are tracked
 * through the dedicated insurance-claims workflow (`/v1/billing/insurance-claims/*`),
 * not recorded as ordinary manual payments. The `insurance` value remains in the
 * Prisma `PaymentMethod` enum so historical rows and the claims workflow continue
 * to compile; this DTO guards the manual-payment write path alone.
 */
export enum ManualPaymentMethod {
  CASH       = 'cash',
  UPI        = 'upi',
  CARD       = 'card',
  NETBANKING = 'netbanking',
  CHEQUE     = 'cheque',
  OTHER      = 'other',
}

export class RecordManualPaymentDto {
  @ApiProperty({ description: 'Amount in INR' })
  @IsNumber() @Min(0.01) amount: number;

  @ApiProperty({ enum: ManualPaymentMethod })
  @IsEnum(ManualPaymentMethod) method: ManualPaymentMethod;

  @ApiPropertyOptional({ description: 'UPI transaction ID, cheque number, etc.' })
  @IsString() @IsOptional() transactionRef?: string;

  @ApiPropertyOptional()
  @IsDateString() @IsOptional() paidAt?: string;

  @ApiPropertyOptional()
  @IsString() @IsOptional() notes?: string;
}
