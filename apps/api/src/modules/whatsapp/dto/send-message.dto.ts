import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsObject, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

/** International E.164 number, e.g. +919876543210. */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/** Templates the application itself sends; the manual route may only use these (no arbitrary template names). */
export const MANUAL_TEMPLATES = [
  'appointment_confirmation', 'appointment_reminder_24h', 'appointment_reminder_2h',
  'appointment_followup', 'invoice_payment_link', 'payment_receipt',
] as const;

// Reads the RAW value: the global ValidationPipe's implicit conversion would otherwise turn {a:1} into "[object Object]".
const trim = ({ obj, key }: { obj: any; key: string }) => (typeof obj[key] === 'string' ? obj[key].trim() : obj[key]);

export class SendTextDto {
  @ApiProperty({ example: '+919876543210' }) @Transform(trim) @IsString() @Matches(E164_PATTERN, { message: 'to must be an E.164 number' })
  to: string;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000)
  message: string;
}

export class SendTemplateDto {
  @ApiProperty({ example: '+919876543210' }) @Transform(trim) @IsString() @Matches(E164_PATTERN, { message: 'to must be an E.164 number' })
  to: string;

  @ApiProperty({ enum: MANUAL_TEMPLATES }) @IsIn(MANUAL_TEMPLATES as unknown as string[])
  templateName: string;

  @ApiProperty() @IsObject()
  params: Record<string, string>;
}

export class StartBookingDto {
  @ApiProperty({ description: 'Clinic UUID (embedded in the QR / deep link)' }) @IsUUID('4')
  clinicId: string;

  @ApiProperty({ example: '+919876543210' }) @Transform(trim) @IsString() @Matches(E164_PATTERN, { message: 'phone must be an E.164 number' })
  phone: string;
}

/** Template params: at most 10 short plain-string values. */
export function paramsAreValid(params: unknown): params is Record<string, string> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
  const v = Object.values(params as Record<string, unknown>);
  return v.length <= 10 && v.every((x) => typeof x === 'string' && x.length <= 300);
}
