import {
  IsEnum, IsNumber, IsOptional, IsString, IsDateString, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ManualPaymentMethod {
  CASH       = 'cash',
  UPI        = 'upi',
  CARD       = 'card',
  NETBANKING = 'netbanking',
  CHEQUE     = 'cheque',
  INSURANCE  = 'insurance',
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
