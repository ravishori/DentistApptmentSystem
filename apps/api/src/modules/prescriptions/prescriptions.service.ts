/**
 * PrescriptionsService
 *
 * Manages prescriptions and prescription templates.
 * PDF generation is delegated to PdfService.
 */

import {
  Injectable, NotFoundException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePrescriptionDto, CreateTemplateDto,
} from './dto/create-prescription.dto';
import { PdfService } from './pdf.service';

@Injectable()
export class PrescriptionsService {
  private readonly logger = new Logger(PrescriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf:    PdfService,
  ) {}

  // ── Prescriptions ─────────────────────────────────────────────────────────

  async create(clinicId: string, patientId: string, dto: CreatePrescriptionDto) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, clinicId },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    if (dto.visitId) {
      const visit = await this.prisma.visit.findFirst({
        where: { id: dto.visitId, clinicId, patientId },
      });
      if (!visit) throw new NotFoundException('Visit not found');
    }

    const prescription = await this.prisma.prescription.create({
      data: {
        clinicId,
        patientId,
        visitId:    dto.visitId,
        dentistId:  dto.dentistId,
        templateId: dto.templateId,
        notes:      dto.notes,
        items: {
          createMany: {
            data: dto.items.map((item, i) => ({
              medicineName: item.medicineName,
              dosage:       item.dosage,
              frequency:    item.frequency,
              duration:     item.duration,
              instructions: item.instructions,
              quantity:     item.quantity,
              sortOrder:    item.sortOrder ?? i,
            })),
          },
        },
      },
      include: {
        items:   { orderBy: { sortOrder: 'asc' } },
        patient: { select: { fullName: true, phone: true, dateOfBirth: true, age: true } },
        dentist: { select: { fullName: true, specialization: true, registrationNumber: true } },
      },
    });
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where:  { id: clinicId },
      select: { name: true, address: true, phone: true },
    });

    this.logger.log(`Prescription created: ${prescription.id} for patient ${patientId}`);
    return { ...prescription, clinic };
  }

  async findAll(clinicId: string, patientId: string, page = 1, limit = 20) {
    const skip  = (page - 1) * limit;
    const where = { clinicId, patientId };

    const [items, total] = await Promise.all([
      this.prisma.prescription.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip,
        take: limit,
        include: {
          items:   { orderBy: { sortOrder: 'asc' } },
          dentist: { select: { fullName: true, specialization: true } },
        },
      }),
      this.prisma.prescription.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(clinicId: string, id: string) {
    const rx = await this.prisma.prescription.findFirst({
      where:   { id, clinicId },
      include: {
        items:   { orderBy: { sortOrder: 'asc' } },
        patient: { select: { fullName: true, phone: true, dateOfBirth: true, age: true, gender: true } },
        dentist: { select: { fullName: true, specialization: true, registrationNumber: true, qualification: true } },
      },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where:  { id: clinicId },
      select: { name: true, address: true, phone: true, email: true, gstNumber: true },
    });
    return { ...rx, clinic };
  }

  /** Generate a PDF and optionally persist the URL to the record. */
  async generatePdf(clinicId: string, rxId: string): Promise<Buffer> {
    const rx = await this.findOne(clinicId, rxId);
    const pdfBuffer = await this.pdf.generatePrescriptionPdf(rx as any);

    // Store the URL if you later upload to S3 (stub — wire up S3Service to save pdfUrl)
    this.logger.log(`PDF generated for prescription ${rxId}`);

    return pdfBuffer;
  }

  // ── Templates ─────────────────────────────────────────────────────────────

  async createTemplate(clinicId: string, dto: CreateTemplateDto) {
    return this.prisma.prescriptionTemplate.create({
      data: {
        clinicId,
        name:        dto.name,
        description: dto.description,
        items:       dto.items as any,
      },
    });
  }

  async listTemplates(clinicId: string) {
    return this.prisma.prescriptionTemplate.findMany({
      where:   { clinicId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async getTemplate(clinicId: string, id: string) {
    const t = await this.prisma.prescriptionTemplate.findFirst({
      where: { id, clinicId },
    });
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }

  async deleteTemplate(clinicId: string, id: string) {
    await this.getTemplate(clinicId, id);
    return this.prisma.prescriptionTemplate.update({
      where: { id },
      data:  { isActive: false },
    });
  }
}
