/**
 * EhrService
 *
 * Manages the complete clinical record for a patient:
 *  - DentalChart  — one chart per patient; 32 tooth rows on first access
 *  - Tooth        — FDI-numbered; condition, surfaces, history
 *  - Visit        — clinical encounters with diagnoses, vitals, notes
 *  - Diagnosis    — linked to visits and individual teeth
 */

import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVisitDto, UpdateVisitDto } from './dto/create-visit.dto';
import { UpdateToothDto, BulkUpdateToothDto } from './dto/update-tooth.dto';

// All valid FDI tooth numbers for permanent dentition
const ALL_FDI = [
  11,12,13,14,15,16,17,18,
  21,22,23,24,25,26,27,28,
  31,32,33,34,35,36,37,38,
  41,42,43,44,45,46,47,48,
];

@Injectable()
export class EhrService {
  private readonly logger = new Logger(EhrService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Dental Chart ──────────────────────────────────────────────────────────

  /** Returns the chart for a patient, auto-creating it (with all 32 teeth) if absent. */
  async getOrCreateChart(clinicId: string, patientId: string) {
    await this.assertPatient(clinicId, patientId);

    let chart = await this.prisma.dentalChart.findUnique({
      where:   { patientId },
      include: { teeth: { orderBy: { fdiNumber: 'asc' } } },
    });

    if (!chart) {
      chart = await this.prisma.dentalChart.create({
        data: {
          clinicId,
          patientId,
          teeth: {
            createMany: {
              data: ALL_FDI.map((n) => ({ fdiNumber: n, clinicId })),
            },
          },
        },
        include: { teeth: { orderBy: { fdiNumber: 'asc' } } },
      });
      this.logger.log(`Dental chart created for patient ${patientId}`);
    }

    return chart;
  }

  /** Update a single tooth's condition, surfaces, and notes. Records history. */
  async updateTooth(
    clinicId:  string,
    patientId: string,
    fdiNumber: number,
    dto:       UpdateToothDto,
  ) {
    if (!ALL_FDI.includes(fdiNumber)) {
      throw new BadRequestException(`FDI number ${fdiNumber} is not a valid permanent tooth`);
    }

    await this.assertPatient(clinicId, patientId);

    const chart = await this.getOrCreateChart(clinicId, patientId);

    const tooth = chart.teeth.find((t) => t.fdiNumber === fdiNumber);
    if (!tooth) throw new NotFoundException(`Tooth ${fdiNumber} not found`);

    // Append to history before overwriting
    const historyEntry = {
      condition:        tooth.condition,
      affectedSurfaces: (tooth as any).affectedSurfaces ?? [],
      notes:            tooth.notes,
      changedAt:        new Date().toISOString(),
    };

    const updatedTooth = await this.prisma.tooth.update({
      where: { id: tooth.id },
      data: {
        condition:        dto.condition,
        affectedSurfaces: dto.affectedSurfaces ?? [],
        notes:            dto.notes,
        history: {
          push: historyEntry,
        },
      },
    });

    this.logger.log(`Tooth ${fdiNumber} updated to ${dto.condition} for patient ${patientId}`);
    return updatedTooth;
  }

  /** Bulk-update multiple teeth to the same condition. */
  async bulkUpdateTeeth(clinicId: string, patientId: string, dto: BulkUpdateToothDto) {
    await this.getOrCreateChart(clinicId, patientId);
    const results = await Promise.all(
      dto.fdiNumbers.map((n) =>
        this.updateTooth(clinicId, patientId, n, {
          condition: dto.condition,
          notes:     dto.notes,
        }),
      ),
    );
    return results;
  }

  // ── Visits ────────────────────────────────────────────────────────────────

  async createVisit(clinicId: string, patientId: string, dto: CreateVisitDto) {
    await this.assertPatient(clinicId, patientId);

    // Validate appointment belongs to this patient if provided
    if (dto.appointmentId) {
      const appt = await this.prisma.appointment.findFirst({
        where: { id: dto.appointmentId, clinicId, patientId },
      });
      if (!appt) throw new NotFoundException('Appointment not found');
    }

    const visit = await this.prisma.visit.create({
      data: {
        clinicId,
        patientId,
        dentistId:     dto.dentistId,
        appointmentId: dto.appointmentId,
        visitDate:     new Date(dto.visitDate),
        chiefComplaint: dto.chiefComplaint,
        clinicalNotes:  dto.clinicalNotes,
        vitalSigns:     dto.vitalSigns as any,
        ...(dto.diagnoses?.length
          ? {
              diagnoses: {
                createMany: {
                  data: dto.diagnoses.map((d) => ({
                    clinicId,
                    patientId,
                    toothFdi:    d.fdiNumber ?? null,
                    icdCode:     d.icdCode,
                    description: d.description,
                    severity:    d.severity,
                  })),
                },
              },
            }
          : {}),
      },
      include: {
        diagnoses:    true,
        prescriptions: { include: { items: true } },
        attachments:  true,
        dentist:      { select: { id: true, fullName: true, role: true } },
      },
    });

    // Update patient last visit date
    await this.prisma.patient.update({
      where: { id: patientId },
      data:  { lastVisitDate: new Date(dto.visitDate) },
    });

    return visit;
  }

  async updateVisit(clinicId: string, visitId: string, dto: UpdateVisitDto) {
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, clinicId },
    });
    if (!visit) throw new NotFoundException('Visit not found');

    return this.prisma.visit.update({
      where: { id: visitId },
      data: {
        chiefComplaint: dto.chiefComplaint,
        clinicalNotes:  dto.clinicalNotes,
        vitalSigns:     dto.vitalSigns as any,
      },
      include: { diagnoses: true, prescriptions: { include: { items: true } }, attachments: true },
    });
  }

  async getVisit(clinicId: string, visitId: string) {
    const visit = await this.prisma.visit.findFirst({
      where:   { id: visitId, clinicId },
      include: {
        diagnoses:    true,
        prescriptions: { include: { items: { orderBy: { sortOrder: 'asc' } } } },
        attachments:  true,
        dentist:      { select: { id: true, fullName: true, specialization: true, avatarUrl: true } },
      },
    });
    if (!visit) throw new NotFoundException('Visit not found');
    return visit;
  }

  /** Patient timeline — all visits ordered newest-first, paginated. */
  async getPatientTimeline(
    clinicId:  string,
    patientId: string,
    page  = 1,
    limit = 10,
  ) {
    await this.assertPatient(clinicId, patientId);

    const skip  = (page - 1) * limit;
    const where = { clinicId, patientId };

    const [items, total] = await Promise.all([
      this.prisma.visit.findMany({
        where,
        orderBy: { visitDate: 'desc' },
        skip,
        take: limit,
        include: {
          diagnoses:    true,
          prescriptions: { include: { items: { orderBy: { sortOrder: 'asc' } } } },
          attachments:  true,
          dentist:      { select: { id: true, fullName: true, specialization: true, avatarUrl: true } },
        },
      }),
      this.prisma.visit.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /** Adds a diagnosis to an existing visit and optionally links it to a tooth. */
  async addDiagnosis(
    clinicId:  string,
    visitId:   string,
    patientId: string,
    data: {
      fdiNumber?:  number;
      icdCode?:    string;
      description: string;
      severity?:   string;
    },
  ) {
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, clinicId, patientId },
    });
    if (!visit) throw new NotFoundException('Visit not found');

    return this.prisma.diagnosis.create({
      data: {
        clinicId,
        visitId,
        patientId,
        toothFdi:    data.fdiNumber ?? null,
        icdCode:     data.icdCode,
        description: data.description,
        severity:    data.severity,
      },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async assertPatient(clinicId: string, patientId: string) {
    const p = await this.prisma.patient.findFirst({
      where: { id: patientId, clinicId },
    });
    if (!p) throw new NotFoundException('Patient not found');
  }
}
