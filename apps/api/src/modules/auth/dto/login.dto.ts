import { IsEmail, IsString, IsOptional } from 'class-validator';
import { KeepRaw } from '../../../common/validators/keep-raw';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'priya@smiledental.in' })
  @IsEmail()
  email: string;

  @ApiProperty()
  @KeepRaw()
  @IsString()
  password: string;

  @ApiPropertyOptional({ description: 'Required when one email belongs to multiple clinics' })
  @IsString()
  @IsOptional()
  clinicSlug?: string;
}
