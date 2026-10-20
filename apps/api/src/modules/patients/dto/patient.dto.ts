import {
  IsString, IsEmail, IsOptional, IsEnum, IsDateString,
  IsUUID, IsInt, Min, Max,
} from 'class-validator';
import { IsStrictBoolean } from '../../../common/validators/strict-boolean';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum Gender { male = 'male', female = 'female', other = 'other' }
export enum BloodGroup {
  A_POS = 'A+', A_NEG = 'A-', B_POS = 'B+', B_NEG = 'B-',
  AB_POS = 'AB+', AB_NEG = 'AB-', O_POS = 'O+', O_NEG = 'O-',
}

export class CreatePatientDto {
  @ApiProperty() @IsString() fullName: string;
  @ApiProperty() @IsString() phone: string;

  @ApiPropertyOptional() @IsEmail() @IsOptional() email?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() dateOfBirth?: string;
  @ApiPropertyOptional({ enum: Gender }) @IsEnum(Gender) @IsOptional() gender?: Gender;
  @ApiPropertyOptional({ enum: BloodGroup }) @IsEnum(BloodGroup) @IsOptional() bloodGroup?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() address?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() city?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() allergies?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() medicalHistory?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() emergencyContact?: string;
  @ApiPropertyOptional() @IsStrictBoolean() @IsOptional() waOptIn?: boolean;
}

export class UpdatePatientDto {
  @ApiPropertyOptional() @IsString() @IsOptional() fullName?: string;
  @ApiPropertyOptional() @IsEmail() @IsOptional() email?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() dateOfBirth?: string;
  @ApiPropertyOptional({ enum: Gender }) @IsEnum(Gender) @IsOptional() gender?: Gender;
  @ApiPropertyOptional({ enum: BloodGroup }) @IsEnum(BloodGroup) @IsOptional() bloodGroup?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() address?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() city?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() allergies?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() medicalHistory?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() emergencyContact?: string;
  @ApiPropertyOptional() @IsStrictBoolean() @IsOptional() waOptIn?: boolean;
}

export class SearchPatientsDto {
  @ApiPropertyOptional() @IsString() @IsOptional() search?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() city?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional()
  limit?: number = 20;
}

export class LinkFamilyDto {
  @ApiProperty() @IsUUID() familyHeadId: string;
  @ApiProperty({ example: 'spouse' }) @IsString() relationship: string;
}
