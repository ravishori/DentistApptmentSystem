import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTreatmentPackageDto, UpdateTreatmentPackageDto,
  EnrollPatientDto, MarkVisitCompletedDto,
} from './dto/package.dto';

@Injectable()
export class PackagesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Packages CRUD ─────────────────────────────────────────────────────────

  async createPackage(clinicId: string, dto: CreateTreatmentPackageDto) {
    return this.prisma.treatmentPackage.create({
      data: {
        clinicId,
        name:        dto.name,
        description: dto.description,
        totalVisits: dto.totalVisits,
        totalPrice:  dto.totalPrice,
        taxPercent:  dto.taxPercent ?? 18,
        items: {
          create: dto.items.map((it, i) => ({
            description: it.description,
            quantity:    it.quantity,
            unitPrice:   it.unitPrice,
            sortOrder:   it.sortOrder ?? i,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async listPackages(clinicId: string, activeOnly = true) {
    return this.prisma.treatmentPackage.findMany({
      where:   { clinicId, ...(activeOnly && { isActive: true }) },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async getPackage(clinicId: string, id: string) {
    const pkg = await this.prisma.treatmentPackage.findFirst({
      where:   { id, clinicId },
      include: {
        items:       { orderBy: { sortOrder: 'asc' } },
        enrollments: {
          where:   { status: 'active' },
          include: { patient: { select: { id: true, fullName: true, phone: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!pkg) throw new NotFoundException('Package not found');
    return pkg;
  }

  async updatePackage(clinicId: string, id: string, dto: UpdateTreatmentPackageDto) {
    const pkg = await this.prisma.treatmentPackage.findFirst({ where: { id, clinicId } });
    if (!pkg) throw new NotFoundException('Package not found');
    return this.prisma.treatmentPackage.update({
      where: { id },
      data:  dto,
      include: { items: true },
    });
  }

  // ── Enrollment ────────────────────────────────────────────────────────────

  async enrollPatient(clinicId: string, dto: EnrollPatientDto) {
    const [patient, pkg] = await Promise.all([
      this.prisma.patient.findFirst({ where: { id: dto.patientId, clinicId } }),
      this.prisma.treatmentPackage.findFirst({ where: { id: dto.packageId, clinicId, isActive: true } }),
    ]);
    if (!patient) throw new NotFoundException('Patient not found');
    if (!pkg)     throw new NotFoundException('Package not found or inactive');

    const installmentSchedule = this.buildInstallmentSchedule(
      Number(pkg.totalPrice), dto, pkg.totalVisits,
    );

    const enrollment = await this.prisma.packageEnrollment.create({
      data: {
        clinicId,
        patientId:    dto.patientId,
        packageId:    dto.packageId,
        status:       'active',
        visitsTotal:  pkg.totalVisits,
        totalAmount:  pkg.totalPrice,
        installments: installmentSchedule as any,
        startDate:    dto.startDate ? new Date(dto.startDate) : new Date(),
        notes:        dto.notes,
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        package: { select: { id: true, name: true, totalVisits: true, totalPrice: true } },
      },
    });

    return enrollment;
  }

  private buildInstallmentSchedule(
    totalPrice: number,
    dto: EnrollPatientDto,
    totalVisits: number,
  ) {
    if (dto.customSchedule?.length) {
      return dto.customSchedule.map((s, i) => ({
        installmentNo: i + 1,
        amount:        s.amount,
        dueDate:       s.dueDate,
        paid:          false,
      }));
    }
    const count = dto.installments ?? 1;
    const perInstallment = Math.round((totalPrice / count) * 100) / 100;
    const start = dto.startDate ? new Date(dto.startDate) : new Date();

    return Array.from({ length: count }, (_, i) => {
      const due = new Date(start);
      due.setMonth(due.getMonth() + i);
      return {
        installmentNo: i + 1,
        amount:        i === count - 1
          ? Math.round((totalPrice - perInstallment * (count - 1)) * 100) / 100
          : perInstallment,
        dueDate: due.toISOString().split('T')[0],
        paid:    false,
      };
    });
  }

  async listEnrollments(clinicId: string, patientId?: string, status?: string) {
    return this.prisma.packageEnrollment.findMany({
      where: {
        clinicId,
        ...(patientId && { patientId }),
        ...(status    && { status: status as any }),
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        package: { select: { id: true, name: true, totalVisits: true, totalPrice: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getEnrollment(clinicId: string, id: string) {
    const enr = await this.prisma.packageEnrollment.findFirst({
      where:   { id, clinicId },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, email: true } },
        package: { include: { items: true } },
        invoices: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!enr) throw new NotFoundException('Enrollment not found');
    return enr;
  }

  async markVisitCompleted(clinicId: string, dto: MarkVisitCompletedDto) {
    const enr = await this.prisma.packageEnrollment.findFirst({
      where: { id: dto.enrollmentId, clinicId },
    });
    if (!enr) throw new NotFoundException('Enrollment not found');
    if (enr.status !== 'active') {
      throw new BadRequestException('Enrollment is not active');
    }
    if (enr.visitsCompleted >= enr.visitsTotal) {
      throw new BadRequestException('All visits already completed');
    }

    const newCompleted = enr.visitsCompleted + 1;
    const newStatus = newCompleted >= enr.visitsTotal ? 'completed' : 'active';

    return this.prisma.packageEnrollment.update({
      where: { id: dto.enrollmentId },
      data:  {
        visitsCompleted: newCompleted,
        status:          newStatus as any,
        ...(newStatus === 'completed' && { endDate: new Date() }),
      },
    });
  }
}
