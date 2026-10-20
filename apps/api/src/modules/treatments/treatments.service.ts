import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TreatmentPlanStatus } from './treatment-plan.entity';

@Injectable()
export class TreatmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createPlan(clinicId: string, dto: {
    patientId: string; dentistId: string; planTitle: string;
    diagnosis?: string; notes?: string;
    items?: Array<{
      description: string; toothNumber?: string; unitPrice: number;
      discountPct?: number; quantity?: number; sortOrder?: number; procedureId?: string;
    }>;
  }) {
    const { items = [], ...planData } = dto;
    const totalCost = items.reduce(
      (sum, i) => sum + Number(i.unitPrice) * (i.quantity ?? 1),
      0,
    );
    return this.prisma.treatmentPlan.create({
      data: {
        clinicId,
        patientId:  planData.patientId,
        dentistId:  planData.dentistId,
        planTitle:  planData.planTitle,
        diagnosis:  planData.diagnosis,
        notes:      planData.notes,
        totalCost,
        items: {
          create: items.map((i, idx) => ({
            description: i.description,
            toothNumber: i.toothNumber,
            unitPrice:   i.unitPrice,
            discountPct: i.discountPct ?? 0,
            quantity:    i.quantity    ?? 1,
            sortOrder:   i.sortOrder   ?? idx,
            procedureId: i.procedureId,
          })),
        },
      },
      include: { items: true },
    });
  }

  findAll(clinicId: string, patientId?: string) {
    return this.prisma.treatmentPlan.findMany({
      where:   { clinicId, ...(patientId && { patientId }) },
      include: { items: true, patient: true, dentist: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(clinicId: string, id: string) {
    const plan = await this.prisma.treatmentPlan.findFirst({
      where:   { id, clinicId },
      include: { items: { include: { procedure: true } }, patient: true, dentist: true },
    });
    if (!plan) throw new NotFoundException('Treatment plan not found');
    return plan;
  }

  async updateStatus(clinicId: string, id: string, status: TreatmentPlanStatus) {
    const plan = await this.prisma.treatmentPlan.findFirst({ where: { id, clinicId } });
    if (!plan) throw new NotFoundException();
    const extra: Record<string, any> = { status };
    if (status === TreatmentPlanStatus.ACCEPTED)   extra.acceptedAt  = new Date();
    if (status === TreatmentPlanStatus.PRESENTED)  extra.presentedAt = new Date();
    if (status === TreatmentPlanStatus.COMPLETED)  extra.completedAt = new Date();
    return this.prisma.treatmentPlan.update({ where: { id }, data: extra });
  }

  getProcedures(clinicId: string) {
    return this.prisma.procedure.findMany({
      where:   { clinicId, isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  createProcedure(clinicId: string, dto: {
    name: string; code?: string; category?: string;
    defaultPrice?: number; durationMins?: number;
  }) {
    return this.prisma.procedure.create({
      data: { clinicId, ...dto, defaultPrice: dto.defaultPrice ?? 0, durationMins: dto.durationMins ?? 30 },
    });
  }
}
