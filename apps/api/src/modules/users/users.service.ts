import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from './user.entity';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(clinicId: string) {
    return this.prisma.user.findMany({
      where:   { clinicId, isActive: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async findOne(clinicId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, clinicId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(clinicId: string, dto: {
    fullName: string; email: string; password: string; role: UserRole;
    phone?: string; specialization?: string;
  }) {
    const existing = await this.prisma.user.findFirst({ where: { clinicId, email: dto.email } });
    if (existing) throw new ConflictException('User already exists with this email');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    return this.prisma.user.create({
      data: { clinicId, fullName: dto.fullName, email: dto.email, passwordHash, role: dto.role as any,
              phone: dto.phone, specialization: dto.specialization },
    });
  }

  async update(clinicId: string, id: string, dto: Record<string, any>) {
    const user = await this.prisma.user.findFirst({ where: { id, clinicId } });
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash: _, password: __, ...safe } = dto;
    return this.prisma.user.update({ where: { id }, data: safe });
  }

  getDentists(clinicId: string) {
    return this.prisma.user.findMany({
      where:   { clinicId, role: { in: ['dentist', 'clinic_admin'] as any[] }, isActive: true },
      orderBy: { fullName: 'asc' },
    });
  }
}
