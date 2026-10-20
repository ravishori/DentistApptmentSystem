import {
  IsString, IsOptional, IsUUID, IsDateString, IsArray,
  ValidateNested, IsNumber, Min, Max, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VitalSignsDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() bloodPressureSystolic?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() bloodPressureDiastolic?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() pulse?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() temperature?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() weight?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() height?: number;
}

export class DiagnosisItemDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()   toothId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(11) @Max(48) fdiNumber?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() icdCode?: string;
  @ApiProperty()          @IsString()              description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() severity?: string;
}

export class CreateVisitDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()       appointmentId?: string;
  @ApiProperty()         @IsUUID()                     dentistId!: string;
  @ApiProperty()         @IsDateString()               visitDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString()     chiefComplaint?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()     clinicalNotes?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject()
  @ValidateNested()      @Type(() => VitalSignsDto)    vitalSigns?: VitalSignsDto;
  @ApiPropertyOptional() @IsOptional() @IsArray()
  @ValidateNested({ each: true }) @Type(() => DiagnosisItemDto)
  diagnoses?: DiagnosisItemDto[];
}

export class UpdateVisitDto {
  @ApiPropertyOptional() @IsOptional() @IsString() chiefComplaint?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() clinicalNotes?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject()
  @ValidateNested()      @Type(() => VitalSignsDto) vitalSigns?: VitalSignsDto;
}
