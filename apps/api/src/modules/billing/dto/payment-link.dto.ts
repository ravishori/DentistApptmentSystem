import {
  IsInt, IsOptional, Min, Max, IsString, IsUUID, Matches, MaxLength,
} from 'class-validator';
import { IsStrictBoolean } from '../../../common/validators/strict-boolean';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @IsStrictBoolean() @IsOptional()
  acceptPartial?: boolean = false;

  @ApiPropertyOptional({
    description: 'Send Razorpay native SMS notification (we send WA ourselves)',
    default: false,
  })
  @IsStrictBoolean() @IsOptional()
  notifySms?: boolean = false;

  @ApiPropertyOptional({
    description: 'Send Razorpay native email notification',
    default: false,
  })
  @IsStrictBoolean() @IsOptional()
  notifyEmail?: boolean = false;
}

/**
 * Body of the PUBLIC checkout-callback route. Every field needs a validator: the global
 * ValidationPipe uses `whitelist: true`, which silently strips undecorated properties (the previous
 * undecorated DTO produced an empty body, so verification could never succeed).
 */
export class VerifyOrderPaymentDto {
  @ApiProperty() @IsString() @MaxLength(64) @Matches(/^order_[A-Za-z0-9]+$/) razorpay_order_id:   string;
  @ApiProperty() @IsString() @MaxLength(64) @Matches(/^pay_[A-Za-z0-9]+$/)   razorpay_payment_id: string;
  @ApiProperty() @IsString() @MaxLength(128) @Matches(/^[0-9a-fA-F]+$/)      razorpay_signature:  string;
  @ApiProperty() @IsUUID()                                                   invoiceId:           string;
}
