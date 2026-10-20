import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.clinic.findUnique({ where: { id } });
  }

  findBySlug(slug: string) {
    return this.prisma.clinic.findUnique({ where: { slug } });
  }

  async update(id: string, dto: Record<string, any>) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id } });
    if (!clinic) throw new NotFoundException('Tenant not found');
    return this.prisma.clinic.update({ where: { id }, data: dto });
  }

  async updateSettings(id: string, settings: Record<string, any>) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id } });
    if (!clinic) throw new NotFoundException('Tenant not found');
    const merged = { ...(clinic.settings as Record<string, any> ?? {}), ...settings };
    return this.prisma.clinic.update({ where: { id }, data: { settings: merged } });
  }
}
