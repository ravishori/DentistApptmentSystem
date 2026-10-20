import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChairDto, UpdateChairDto } from './dto/clinic-management.dto';

@Injectable()
export class ChairsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clinicId: string, dto: CreateChairDto) {
    const exists = await this.prisma.chair.findUnique({
      where: { clinicId_chairNumber: { clinicId, chairNumber: dto.chairNumber } },
    });
    if (exists) throw new ConflictException(`Chair #${dto.chairNumber} already exists`);

    return this.prisma.chair.create({
      data: { clinicId, ...dto },
    });
  }

  async findAll(clinicId: string, activeOnly = true) {
    return this.prisma.chair.findMany({
      where:   { clinicId, ...(activeOnly && { isActive: true }) },
      orderBy: { chairNumber: 'asc' },
    });
  }

  async findOne(clinicId: string, id: string) {
    const chair = await this.prisma.chair.findFirst({ where: { id, clinicId } });
    if (!chair) throw new NotFoundException('Chair not found');
    return chair;
  }

  async update(clinicId: string, id: string, dto: UpdateChairDto) {
    await this.findOne(clinicId, id);
    return this.prisma.chair.update({ where: { id }, data: dto });
  }

  async remove(clinicId: string, id: string) {
    await this.findOne(clinicId, id);
    return this.prisma.chair.update({ where: { id }, data: { isActive: false } });
  }

  async utilization(clinicId: string, date: string) {
    const d = new Date(date);
    const chairs = await this.prisma.chair.findMany({
      where:   { clinicId, isActive: true },
      orderBy: { chairNumber: 'asc' },
    });

    const appointments = await this.prisma.appointment.findMany({
      where: {
        clinicId,
        appointmentDate: d,
        status: { notIn: ['cancelled', 'no_show'] },
      },
      include: {
        patient: { select: { id: true, fullName: true } },
        dentist: { select: { id: true, fullName: true } },
      },
      orderBy: { startTime: 'asc' },
    });

    return chairs.map(chair => ({
      chair,
      appointments: appointments.filter(a => a.chairId === chair.id),
      utilization:  appointments.filter(a => a.chairId === chair.id).length,
    }));
  }

  /** Find the next free chair for a given date + time range */
  async nextFreeChair(
    clinicId: string,
    date: string,
    startTime: string,
    endTime: string,
    excludeAppointmentId?: string,
  ): Promise<string | null> {
    const chairs = await this.prisma.chair.findMany({
      where:   { clinicId, isActive: true },
      orderBy: { chairNumber: 'asc' },
    });

    for (const chair of chairs) {
      const conflict = await this.prisma.appointment.findFirst({
        where: {
          clinicId,
          chairId:         chair.id,
          appointmentDate: new Date(date),
          status:          { notIn: ['cancelled', 'no_show'] },
          id:              excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
          AND: [
            { startTime: { lt: endTime } },
            { endTime:   { gt: startTime } },
          ],
        },
      });
      if (!conflict) return chair.id;
    }
    return null;
  }
}
