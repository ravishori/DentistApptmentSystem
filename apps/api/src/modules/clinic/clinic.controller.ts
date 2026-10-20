import {
  Controller, Get, Patch, Post, Param, Body,
  ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClinicService } from './clinic.service';
import { UpdateClinicDto } from './dto/update-clinic.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { ClinicId } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import {
  IsString, IsEmail, IsOptional, IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AddStaffDto {
  @ApiProperty() @IsString() fullName: string;
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() phone: string;
  @ApiProperty({ enum: UserRole }) @IsEnum(UserRole) role: UserRole;
  @ApiPropertyOptional() @IsString() @IsOptional() specialization?: string;
}

@ApiTags('Clinic')
@ApiBearerAuth()
@Controller({ path: 'clinic', version: '1' })
export class ClinicController {
  constructor(private readonly clinicService: ClinicService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get clinic profile (cached 5 min)' })
  getProfile(@ClinicId() clinicId: string) {
    return this.clinicService.getProfile(clinicId);
  }

  @Patch('profile')
  @Roles(UserRole.clinic_admin, UserRole.super_admin)
  @ApiOperation({ summary: 'Update clinic profile / settings' })
  update(@ClinicId() clinicId: string, @Body() dto: UpdateClinicDto) {
    return this.clinicService.update(clinicId, dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Clinic dashboard stats (patients, today appts, outstanding)' })
  getStats(@ClinicId() clinicId: string) {
    return this.clinicService.getStats(clinicId);
  }

  @Get('dentists')
  @ApiOperation({ summary: 'List active dentists in the clinic' })
  getDentists(@ClinicId() clinicId: string) {
    return this.clinicService.getDentists(clinicId);
  }

  @Post('staff')
  @Roles(UserRole.clinic_admin, UserRole.super_admin)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add staff member to clinic' })
  addStaff(@ClinicId() clinicId: string, @Body() dto: AddStaffDto) {
    return this.clinicService.addStaff(clinicId, dto);
  }

  @Patch('staff/:userId/activate')
  @Roles(UserRole.clinic_admin, UserRole.super_admin)
  @ApiOperation({ summary: 'Activate a staff member' })
  activateStaff(
    @ClinicId() clinicId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.clinicService.toggleStaff(clinicId, userId, true);
  }

  @Patch('staff/:userId/deactivate')
  @Roles(UserRole.clinic_admin, UserRole.super_admin)
  @ApiOperation({ summary: 'Deactivate a staff member' })
  deactivateStaff(
    @ClinicId() clinicId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.clinicService.toggleStaff(clinicId, userId, false);
  }
}
