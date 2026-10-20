import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { UpdateClinicDto } from './dto/update-clinic.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ClinicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getProfile(clinicId: string) {
    return this.cache.wrap(
      CacheService.keys.clinicProfile(clinicId),
      () =>
        this.prisma.clinic.findUnique({
          where: { id: clinicId },
          include: {
            users: {
              where:  { isActive: true },
              select: { id: true, fullName: true, role: true, specialization: true },
            },
          },
        }),
      300,
    );
  }

  async update(clinicId: string, dto: UpdateClinicDto) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId } });
    if (!clinic) throw new NotFoundException('Clinic not found');

    const data: Prisma.ClinicUpdateInput = { ...dto };

    const updated = await this.prisma.clinic.update({
      where: { id: clinicId },
      data,
    });

    await this.cache.del(CacheService.keys.clinicProfile(clinicId));
    return updated;
  }

  async getStats(clinicId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalPatients, todayAppts, pendingInvoices, activeStaff] = await Promise.all([
      this.prisma.patient.count({ where: { clinicId } }),
      this.prisma.appointment.count({
        where: { clinicId, appointmentDate: today, status: { notIn: ['cancelled'] } },
      }),
      this.prisma.invoice.aggregate({
        where:  { clinicId, status: { in: ['draft', 'sent', 'partially_paid'] } },
        _sum:   { balanceAmount: true },
        _count: true,
      }),
      this.prisma.user.count({ where: { clinicId, isActive: true } }),
    ]);

    return {
      totalPatients,
      todayAppointments: todayAppts,
      pendingInvoicesCount:  pendingInvoices._count,
      outstandingBalance:    pendingInvoices._sum.balanceAmount ?? 0,
      activeStaff,
    };
  }

  async getDentists(clinicId: string) {
    return this.prisma.user.findMany({
      where:  { clinicId, isActive: true, role: { in: ['dentist', 'clinic_admin'] } },
      select: { id: true, fullName: true, role: true, specialization: true, phone: true, email: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async addStaff(clinicId: string, data: {
    fullName: string; email: string; phone: string;
    role: string; specialization?: string;
  }) {
    return this.prisma.user.create({
      data: {
        clinicId,
        fullName:       data.fullName,
        email:          data.email,
        phone:          data.phone,
        role:           data.role as any,
        specialization: data.specialization,
        passwordHash:   '',
        isActive:       true,
      },
      select: { id: true, fullName: true, role: true, email: true, specialization: true },
    });
  }

  async toggleStaff(clinicId: string, userId: string, isActive: boolean) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, clinicId } });
    if (!user) throw new NotFoundException('Staff member not found');

    return this.prisma.user.update({
      where:  { id: userId },
      data:   { isActive },
      select: { id: true, fullName: true, isActive: true },
    });
  }
}
