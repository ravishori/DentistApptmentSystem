import { Controller, Get, Post, Put, Body, Param, UseGuards, Version } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private svc: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all staff' })
  findAll(@TenantId() tenantId: string) {
    return this.svc.findAll(tenantId);
  }

  @Get('dentists')
  @ApiOperation({ summary: 'List dentists only (for appointment booking)' })
  dentists(@TenantId() tenantId: string) {
    return this.svc.getDentists(tenantId);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.svc.findOne(tenantId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Add staff member' })
  create(@TenantId() tenantId: string, @Body() dto: any) {
    return this.svc.create(tenantId, dto);
  }

  @Put(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: any) {
    return this.svc.update(tenantId, id, dto);
  }
}
