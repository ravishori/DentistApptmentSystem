import {
  IsString, IsOptional, IsUUID, IsArray, ValidateNested,
  IsNumber, Min, IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PrescriptionItemDto {
  @ApiProperty({ example: 'Amoxicillin' })
  @IsString() medicineName!: string;

  @ApiProperty({ example: '500mg' })
  @IsString() dosage!: string;

  @ApiProperty({ example: 'Twice daily' })
  @IsString() frequency!: string;

  @ApiProperty({ example: '5 days' })
  @IsString() duration!: string;

  @ApiPropertyOptional({ example: 'After meals' })
  @IsOptional() @IsString() instructions?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(1) quantity?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(0) sortOrder?: number;
}

export class CreatePrescriptionDto {
  @ApiPropertyOptional()
  @IsOptional() @IsUUID() visitId?: string;

  @ApiProperty()
  @IsUUID() dentistId!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID() templateId?: string;

  @ApiProperty({ type: [PrescriptionItemDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => PrescriptionItemDto)
  items!: PrescriptionItemDto[];

  @ApiPropertyOptional()
  @IsOptional() @IsString() notes?: string;
}

export class CreateTemplateDto {
  @ApiProperty()
  @IsString() name!: string;

  @ApiPropertyOptional({ example: 'Post-RCT standard protocol' })
  @IsOptional() @IsString() description?: string;

  @ApiProperty({ type: [PrescriptionItemDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => PrescriptionItemDto)
  items!: PrescriptionItemDto[];
}

export class GeneratePdfDto {
  @ApiPropertyOptional({ default: false, description: 'Upload to S3 and return URL' })
  @IsOptional() @IsBoolean() upload?: boolean;
}
