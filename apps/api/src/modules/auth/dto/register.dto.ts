import {
  IsEmail, IsString, MinLength, IsOptional, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Smile Dental Bandra' })
  @IsString()
  clinicName: string;

  @ApiProperty({ example: 'Dr. Priya Shah' })
  @IsString()
  ownerName: string;

  @ApiProperty({ example: 'priya@smiledental.in' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @Matches(/^\+?[1-9]\d{9,14}$/, { message: 'Invalid phone number' })
  phone: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsString()
  @IsOptional()
  city?: string;
}
