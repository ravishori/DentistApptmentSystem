import {
  IsUUID, IsString, IsNumber, IsOptional, IsArray,
  ValidateNested, IsEnum, IsDateString, Min, Max, IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InvoiceItemDto {
  @ApiProperty() @IsString() description: string;
  @ApiPropertyOptional() @IsString() @IsOptional() toothNumber?: string;
  @ApiProperty() @IsInt() @Min(1) quantity: number;
  @ApiProperty() @IsNumber() @Min(0) unitPrice: number;
  @ApiPropertyOptional({ default: 0 }) @IsNumber() @Min(0) @Max(100) @IsOptional() discountPercent?: number;
}

export class CreateInvoiceDto {
  @ApiProperty() @IsUUID() patientId: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() appointmentId?: string;

  @ApiProperty({ type: [InvoiceItemDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];

  @ApiPropertyOptional({ default: 0 }) @IsNumber() @Min(0) @Max(100) @IsOptional() discountPercent?: number;
  @ApiPropertyOptional({ default: 18 }) @IsNumber() @Min(0) @Max(28) @IsOptional() taxPercent?: number;
  @ApiPropertyOptional() @IsDateString() @IsOptional() dueDate?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;
}

export class VerifyPaymentDto {
  @ApiProperty() @IsString() razorpay_order_id: string;
  @ApiProperty() @IsString() razorpay_payment_id: string;
  @ApiProperty() @IsString() razorpay_signature: string;
  @ApiProperty() @IsUUID() invoiceId: string;
}

export enum InvoiceStatusFilter {
  draft = 'draft', sent = 'sent', partially_paid = 'partially_paid', paid = 'paid', cancelled = 'cancelled',
}

export class FilterInvoicesDto {
  @ApiPropertyOptional({ enum: InvoiceStatusFilter })
  @IsEnum(InvoiceStatusFilter) @IsOptional() status?: InvoiceStatusFilter;

  @ApiPropertyOptional() @IsUUID() @IsOptional() patientId?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() limit?: number = 20;
}
