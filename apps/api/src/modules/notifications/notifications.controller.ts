import {
  Controller, Get, Patch, Body, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser, ClinicId } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request.types';
import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class MarkReadDto {
  @ApiProperty({ type: [String] }) @IsArray() @IsUUID('4', { each: true })
  ids: string[];
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get notifications for current user' })
  findAll(
    @ClinicId() clinicId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.notificationsService.findAll(clinicId, user.id, +page, +limit);
  }

  @Patch('read')
  @ApiOperation({ summary: 'Mark specific notifications as read' })
  markRead(
    @ClinicId() clinicId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MarkReadDto,
  ) {
    return this.notificationsService.markRead(clinicId, user.id, dto.ids);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(
    @ClinicId() clinicId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.markAllRead(clinicId, user.id);
  }
}
