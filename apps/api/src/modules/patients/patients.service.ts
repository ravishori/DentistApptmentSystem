import {
  Injectable, NotFoundException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { CreatePatientDto, UpdatePatientDto, SearchPatientsDto } from './dto/patient.dto';
import { Prisma, BloodGroup as PrismaBloodGroup } from '@prisma/client';
import { BloodGroup as DtoBloodGroup } from './dto/patient.dto';

/** DTO blood groups carry display values ('A+'); the Prisma enum is keyed (A_POS). */
function toBloodGroup(value?: string): PrismaBloodGroup | undefined {
  if (!value) return undefined;
  const key = (Object.keys(DtoBloodGroup) as (keyof typeof DtoBloodGroup)[])
    .find((k) => DtoBloodGroup[k] === value);
  return key ? PrismaBloodGroup[key] : undefined;
}

/** DTO accepts free text; the schema stores string arrays. */
function toList(value?: string): string[] | undefined {
  if (value === undefined) return undefined;
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache:  CacheService,
  ) {}

  private async nextPatientCode(clinicId: string): Promise<string> {
    const count = await this.prisma.patient.count({ where: { clinicId } });
    return `PT-${String(count + 1).padStart(5, '0')}`;
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(clinicId: string, dto: CreatePatientDto) {
    const existing = await this.prisma.patient.findFirst({
      where: { clinicId, phone: dto.phone },
    });
    if (existing) throw new ConflictException('Patient with this phone already exists');

    const patientCode = await this.nextPatientCode(clinicId);

    return this.prisma.patient.create({
      data: {
        clinicId,
        patientCode,
        fullName:         dto.fullName,
        phone:            dto.phone,
        email:            dto.email,
        dateOfBirth:      dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        gender:           dto.gender as any,
        bloodGroup:       toBloodGroup(dto.bloodGroup),
        address:          dto.address,
        city:             dto.city,
        allergies:        toList(dto.allergies),
        medicalConditions: toList(dto.medicalHistory),
        emergencyContact: dto.emergencyContact,
        waOptIn:          dto.waOptIn ?? true,
      },
    });
  }

  // ── List / search ─────────────────────────────────────────────────────────

  async findAll(clinicId: string, dto: SearchPatientsDto) {
    const { search, city, page = 1, limit = 20 } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.PatientWhereInput = {
      clinicId,
      ...(city && { city: { contains: city, mode: 'insensitive' } }),
      ...(search && {
        OR: [
          { fullName:    { contains: search, mode: 'insensitive' } },
          { phone:       { contains: search } },
          { patientCode: { contains: search } },
          { email:       { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.patient.findMany({
        where,
        select: {
          id: true, patientCode: true, fullName: true, phone: true, email: true,
          city: true, gender: true, waOptIn: true, lastVisitDate: true,
          totalVisits: true, outstandingBalance: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.patient.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  // ── Single patient ────────────────────────────────────────────────────────

  async findOne(clinicId: string, id: string) {
    const patient = await this.prisma.patient.findFirst({
      where:   { id, clinicId },
      include: {
        appointments: {
          orderBy: { appointmentDate: 'desc' },
          take:    10,
          include: { dentist: { select: { fullName: true } } },
        },
        invoices: {
          orderBy: { createdAt: 'desc' },
          take:    10,
          select:  { id: true, invoiceNumber: true, totalAmount: true, status: true, createdAt: true },
        },
        familyMemberships: {
          select: {
            groupId: true, relationship: true,
            group: {
              select: {
                headPatientId: true,
                members: {
                  select: {
                    relationship: true,
                    patient: { select: { id: true, fullName: true, phone: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(clinicId: string, id: string, dto: UpdatePatientDto) {
    const patient = await this.prisma.patient.findFirst({ where: { id, clinicId } });
    if (!patient) throw new NotFoundException('Patient not found');

    const { bloodGroup, allergies, medicalHistory, dateOfBirth, gender, ...rest } = dto;
    return this.prisma.patient.update({
      where: { id },
      data:  {
        ...rest,
        dateOfBirth:       dateOfBirth ? new Date(dateOfBirth) : undefined,
        gender:            gender as any,
        bloodGroup:        toBloodGroup(bloodGroup),
        allergies:         toList(allergies),
        medicalConditions: toList(medicalHistory),
      },
    });
  }

  // ── Family ────────────────────────────────────────────────────────────────

  async getFamily(clinicId: string, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, clinicId },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const membership = await this.prisma.patientFamilyMember.findFirst({
      where: { clinicId, patientId },
    });
    if (!membership) return [];

    const members = await this.prisma.patientFamilyMember.findMany({
      where:  { clinicId, groupId: membership.groupId },
      select: {
        relationship: true,
        group:   { select: { headPatientId: true } },
        patient: { select: { id: true, fullName: true, phone: true, dateOfBirth: true, gender: true } },
      },
    });
    return members.map((m) => ({
      ...m.patient,
      relationship: m.relationship,
      familyHeadId: m.group.headPatientId,
    }));
  }

  async linkFamily(clinicId: string, memberId: string, familyHeadId: string, relationship: string) {
    const [member, head] = await Promise.all([
      this.prisma.patient.findFirst({ where: { id: memberId, clinicId } }),
      this.prisma.patient.findFirst({ where: { id: familyHeadId, clinicId } }),
    ]);
    if (!member) throw new NotFoundException('Patient not found');
    if (!head)   throw new NotFoundException('Family head not found');
    if (memberId === familyHeadId) throw new ConflictException('A patient cannot be linked to themselves');

    return this.prisma.$transaction(async (tx) => {
      let headMembership = await tx.patientFamilyMember.findFirst({
        where: { clinicId, patientId: familyHeadId },
      });
      if (!headMembership) {
        const group = await tx.familyGroup.create({
          data: { clinicId, headPatientId: familyHeadId },
        });
        headMembership = await tx.patientFamilyMember.create({
          data: { clinicId, groupId: group.id, patientId: familyHeadId, relationship: 'self' },
        });
      }

      const existing = await tx.patientFamilyMember.findFirst({
        where: { clinicId, patientId: memberId },
      });
      if (existing && existing.groupId !== headMembership.groupId) {
        throw new ConflictException('Patient already belongs to a different family group');
      }

      const link = await tx.patientFamilyMember.upsert({
        where:  { groupId_patientId: { groupId: headMembership.groupId, patientId: memberId } },
        create: { clinicId, groupId: headMembership.groupId, patientId: memberId, relationship },
        update: { relationship },
      });
      return {
        id: member.id, fullName: member.fullName,
        familyHeadId, groupId: link.groupId, relationship: link.relationship,
      };
    });
  }

  // ── Timeline (appointment + invoice combined) ─────────────────────────────

  async getTimeline(clinicId: string, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, clinicId },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const [appointments, invoices] = await Promise.all([
      this.prisma.appointment.findMany({
        where:   { clinicId, patientId },
        orderBy: { appointmentDate: 'desc' },
        include: {
          dentist:    { select: { fullName: true } },
          treatments: { include: { procedure: { select: { name: true } } } },
        },
      }),
      this.prisma.invoice.findMany({
        where:   { clinicId, patientId },
        orderBy: { createdAt: 'desc' },
        select:  { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true, status: true, createdAt: true },
      }),
    ]);

    return { appointments, invoices };
  }
}
