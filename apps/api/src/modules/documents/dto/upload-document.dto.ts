import { IsEnum, IsOptional, IsString, IsUUID, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export enum DocumentType {
  XRAY          = 'xray',
  REPORT        = 'report',
  PRESCRIPTION  = 'prescription',
  LAB_RESULT    = 'lab_result',
  CONSENT_FORM  = 'consent_form',
  PHOTO         = 'photo',
  OTHER         = 'other',
}

export class UploadDocumentDto {
  @ApiProperty({ enum: DocumentType })
  @IsEnum(DocumentType)
  type: DocumentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  visitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String], description: 'Manual tags' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return [value]; }
    }
    return value;
  })
  tags?: string[];
}
