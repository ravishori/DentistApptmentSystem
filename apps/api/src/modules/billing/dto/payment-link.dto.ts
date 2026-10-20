import {
  IsBoolean, IsInt, IsOptional, Min, Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreatePaymentLinkDto {
  @ApiPropertyOptional({
    description: 'Hours until the payment link expires (default 48)',
    default: 48,
  })
  @IsInt() @Min(1) @Max(720) @IsOptional()
  @Type(() => Number)
  expiryHours?: number = 48;

  @ApiPropertyOptional({
    description: 'Allow the patient to pay a partial amount (default false)',
    default: false,
  })
  @IsBoolean() @IsOptional()
  acceptPartial?: boolean = false;

  @ApiPropertyOptional({
    description: 'Send Razorpay native SMS notification (we send WA ourselves)',
    default: false,
  })
  @IsBoolean() @IsOptional()
  notifySms?: boolean = false;

  @ApiPropertyOptional({
    description: 'Send Razorpay native email notification',
    default: false,
  })
  @IsBoolean() @IsOptional()
  notifyEmail?: boolean = false;
}

export class VerifyOrderPaymentDto {
  @ApiPropertyOptional() razorpay_order_id:   string;
  @ApiPropertyOptional() razorpay_payment_id: string;
  @ApiPropertyOptional() razorpay_signature:  string;
  @ApiPropertyOptional() invoiceId:           string;
}
