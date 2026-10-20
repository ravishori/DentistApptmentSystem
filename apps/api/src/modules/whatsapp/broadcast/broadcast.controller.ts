import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import {
  IsString, IsEnum, IsOptional, IsArray, IsUUID, IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BroadcastService, CreateBroadcastDto } from './broadcast.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ClinicId } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

class CreateBroadcastDtoValidator implements CreateBroadcastDto {
  @ApiProperty({ example: 'Diwali Cleaning Offer' })
  @IsString()
  name: string;

  @ApiProperty({ example: '🎉 Special 20% off dental cleaning this Diwali! Book now.' })
  @IsString()
  message: string;

  @ApiProperty({ enum: ['all', 'inactive_90d', 'outstanding_balance', 'custom_ids'] })
  @IsEnum(['all', 'inactive_90d', 'outstanding_balance', 'custom_ids'])
  targetSegment: CreateBroadcastDto['targetSegment'];

  @ApiPropertyOptional({ type: [String], description: 'Required when targetSegment = custom_ids' })
  @IsArray() @IsUUID('4', { each: true }) @IsOptional()
  patientIds?: string[];

  @ApiPropertyOptional({ example: '2024-11-01T10:00:00Z' })
  @IsDateString() @IsOptional()
  scheduledAt?: string;
}

@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller({ path: 'whatsapp/broadcast', version: '1' })
export class BroadcastController {
  constructor(private readonly broadcastService: BroadcastService) {}

  @Post()
  @Roles(UserRole.clinic_admin, UserRole.super_admin)
  @ApiOperation({ summary: 'Send a WhatsApp broadcast campaign' })
  create(@ClinicId() clinicId: string, @Body() dto: CreateBroadcastDtoValidator) {
    return this.broadcastService.create(clinicId, dto);
  }

  @Get('estimate')
  @Roles(UserRole.clinic_admin, UserRole.super_admin)
  @ApiOperation({ summary: 'Estimate audience size before sending' })
  @ApiQuery({ name: 'segment', enum: ['all', 'inactive_90d', 'outstanding_balance', 'custom_ids'] })
  estimate(
    @ClinicId() clinicId: string,
    @Query('segment') segment: CreateBroadcastDto['targetSegment'],
  ) {
    return this.broadcastService.estimateAudience(clinicId, segment);
  }
}
