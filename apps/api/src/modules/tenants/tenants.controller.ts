import { Controller, Get, Put, Patch, Body, UseGuards, Version } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId, CurrentUser } from '../../common/decorators/tenant.decorator';
import { TenantsService } from './tenants.service';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller({ path: 'tenant', version: '1' })
@UseGuards(JwtAuthGuard)
export class TenantsController {
  constructor(private svc: TenantsService) {}

  @Get()
  @ApiOperation({ summary: 'Get current tenant (clinic) profile' })
  get(@TenantId() tenantId: string) {
    return this.svc.findById(tenantId);
  }

  @Put()
  @ApiOperation({ summary: 'Update clinic profile' })
  update(@TenantId() tenantId: string, @Body() dto: any) {
    return this.svc.update(tenantId, dto);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update clinic settings (working hours, slot duration, etc.)' })
  settings(@TenantId() tenantId: string, @Body() dto: any) {
    return this.svc.updateSettings(tenantId, dto);
  }
}
