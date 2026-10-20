import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Version } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { TreatmentsService } from './treatments.service';
import { TreatmentPlanStatus } from './treatment-plan.entity';

@ApiTags('treatments')
@ApiBearerAuth()
@Controller({ path: 'treatments', version: '1' })
@UseGuards(JwtAuthGuard)
export class TreatmentsController {
  constructor(private svc: TreatmentsService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query('patientId') patientId?: string) {
    return this.svc.findAll(tenantId, patientId);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.svc.findOne(tenantId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create treatment plan with items' })
  create(@TenantId() tenantId: string, @Body() dto: any) {
    return this.svc.createPlan(tenantId, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('status') status: TreatmentPlanStatus,
  ) {
    return this.svc.updateStatus(tenantId, id, status);
  }

  @Get('procedures/catalog')
  @ApiOperation({ summary: 'Get procedure catalog' })
  procedures(@TenantId() tenantId: string) {
    return this.svc.getProcedures(tenantId);
  }

  @Post('procedures')
  createProcedure(@TenantId() tenantId: string, @Body() dto: any) {
    return this.svc.createProcedure(tenantId, dto);
  }
}
