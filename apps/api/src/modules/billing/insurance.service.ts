import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInsuranceClaimDto, UpdateInsuranceClaimDto } from './dto/insurance.dto';

@Injectable()
export class InsuranceService {
  constructor(private readonly prisma: PrismaService) {}

  async createClaim(clinicId: string, dto: CreateInsuranceClaimDto) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: dto.invoiceId, clinicId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (Number(dto.claimAmount) > Number(invoice.totalAmount)) {
      throw new BadRequestException('Claim amount cannot exceed invoice total');
    }

    return this.prisma.insuranceClaim.create({
      data: {
        clinicId,
        invoiceId:    dto.invoiceId,
        patientId:    invoice.patientId,
        insurerName:  dto.insurerName,
        policyNumber: dto.policyNumber,
        membershipId: dto.membershipId,
        claimAmount:  dto.claimAmount,
        notes:        dto.notes,
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
      },
    });
  }

  async updateClaim(clinicId: string, id: string, dto: UpdateInsuranceClaimDto) {
    const claim = await this.prisma.insuranceClaim.findFirst({ where: { id, clinicId } });
    if (!claim) throw new NotFoundException('Insurance claim not found');

    const data: Record<string, unknown> = {};
    if (dto.claimNumber)      data.claimNumber      = dto.claimNumber;
    if (dto.approvedAmount != null) data.approvedAmount = dto.approvedAmount;
    if (dto.reimbursedAmount != null) data.reimbursedAmount = dto.reimbursedAmount;
    if (dto.status)           data.status           = dto.status;
    if (dto.submittedAt)      data.submittedAt      = new Date(dto.submittedAt);
    if (dto.settledAt)        data.settledAt        = new Date(dto.settledAt);
    if (dto.notes != null)    data.notes            = dto.notes;

    if (dto.status === 'submitted' && !claim.submittedAt) {
      data.submittedAt = new Date();
    }
    if ((dto.status === 'settled' || dto.status === 'approved') && !claim.settledAt) {
      data.settledAt = new Date();
    }

    return this.prisma.insuranceClaim.update({ where: { id }, data });
  }

  async listClaims(clinicId: string, patientId?: string, status?: string) {
    return this.prisma.insuranceClaim.findMany({
      where: {
        clinicId,
        ...(patientId && { patientId }),
        ...(status    && { status: status as any }),
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getClaim(clinicId: string, id: string) {
    const claim = await this.prisma.insuranceClaim.findFirst({
      where:   { id, clinicId },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, email: true } },
        invoices: { select: { id: true, invoiceNumber: true, totalAmount: true, status: true } },
      },
    });
    if (!claim) throw new NotFoundException('Insurance claim not found');
    return claim;
  }
}
